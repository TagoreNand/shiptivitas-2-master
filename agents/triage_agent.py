"""
Illustrative Python triage agent — the AI/ML side of the ecosystem.

It subscribes to the Redis `board.events` channel that the API's outbox relay
publishes to. For every card that lands in `backlog`, it asks an LLM to triage
the task from its text description and, if confident, calls back into the API to
re-prioritise it. The callback uses the SAME optimistic-concurrency token
(`version`) as a human client, so the agent is just another well-behaved actor:
it cannot corrupt the board, and a stale decision is safely rejected with 409.

This file documents the integration contract; wire in your own LLM provider.

    pip install -r requirements.txt
    python triage_agent.py
"""

from __future__ import annotations

import json
import os
import logging
from typing import Any

import redis  # type: ignore
import requests  # type: ignore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("triage-agent")

API_BASE = os.environ.get("API_BASE", "http://localhost:3001/api/v1")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
EVENTS_CHANNEL = os.environ.get("EVENTS_CHANNEL", "board.events")
AGENT_ID = "agent:triage-bot"
# Service JWT (subject agent:triage-bot, scope board:write). Required when the
# API runs with AUTH_REQUIRED=true. Mint one with: npm run mint-token.
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "")


def _headers(
    extra: dict[str, str] | None = None,
    trace: dict[str, str] | None = None,
) -> dict[str, str]:
    headers = {"x-actor-id": AGENT_ID}
    if AGENT_TOKEN:
        headers["authorization"] = f"Bearer {AGENT_TOKEN}"
    # Continue the distributed trace that produced the event we're reacting to.
    if trace:
        for key in ("traceparent", "tracestate"):
            if key in trace:
                headers[key] = trace[key]
    if extra:
        headers.update(extra)
    return headers

# Dedup set: at-least-once delivery means we may see an eventId more than once.
_seen: set[str] = set()


def classify_priority(name: str, description: str) -> int:
    """Return a target 1-based slot for the card.

    Replace this stub with a real LLM call, e.g. an Anthropic/OpenAI request that
    returns an urgency score, or a fine-tuned classifier over the description.
    Urgent-sounding work bubbles toward the top of the backlog.
    """
    text = f"{name} {description}".lower()
    urgent = any(k in text for k in ("urgent", "critical", "security", "outage", "p0", "incident"))
    return 1 if urgent else 5


def fetch_card(client_id: int, trace: dict[str, str] | None = None) -> dict[str, Any] | None:
    resp = requests.get(f"{API_BASE}/clients/{client_id}", timeout=5, headers=_headers(trace=trace))
    if resp.status_code == 200:
        return resp.json()
    return None


def reprioritise(
    card: dict[str, Any], target_priority: int, trace: dict[str, str] | None = None
) -> None:
    """Call the same PUT endpoint a human uses, carrying the OCC version token."""
    resp = requests.put(
        f"{API_BASE}/clients/{card['id']}",
        headers=_headers({"content-type": "application/json"}, trace=trace),
        data=json.dumps({"priority": target_priority, "version": card["version"]}),
        timeout=5,
    )
    if resp.status_code == 409:
        # Board moved under us; drop this decision — a fresh event will arrive.
        log.info("skip card %s: version conflict (stale)", card["id"])
    elif resp.ok:
        log.info("re-prioritised card %s -> slot %s", card["id"], target_priority)
    else:
        log.warning("card %s update failed: %s %s", card["id"], resp.status_code, resp.text)


def handle_event(event: dict[str, Any]) -> None:
    event_id = event.get("eventId", "")
    if event_id in _seen:
        return
    _seen.add(event_id)

    # Only triage cards that have just entered (or remain in) the backlog.
    to_status = event.get("data", {}).get("to", {}).get("status")
    if event.get("type") not in ("card.moved", "card.created") or to_status != "backlog":
        return

    trace = event.get("trace") or {}
    card = fetch_card(int(event["aggregateId"]), trace)
    if not card:
        return
    target = classify_priority(card["name"], card.get("description") or "")
    # Urgent tasks bubble to the top of the backlog; the API no-ops if already there.
    if target == 1:
        reprioritise(card, 1, trace)


def main() -> None:
    client = redis.from_url(REDIS_URL)
    pubsub = client.pubsub()
    pubsub.subscribe(EVENTS_CHANNEL)
    log.info("subscribed to %s on %s", EVENTS_CHANNEL, REDIS_URL)
    for message in pubsub.listen():
        if message.get("type") != "message":
            continue
        try:
            handle_event(json.loads(message["data"]))
        except Exception:  # noqa: BLE001 — keep the consumer loop alive
            log.exception("failed to handle event")


if __name__ == "__main__":
    main()
