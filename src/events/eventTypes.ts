/**
 * Domain event contracts — the public, versioned schema external services
 * (Python LLM agents, data-science triage, analytics) consume off Redis.
 * Additive changes only.
 */

import type { Status } from '../domain/client.ts';

export type EventType = 'card.moved' | 'card.completed' | 'card.created';

export interface DomainEvent<T = unknown> {
  /** Stable unique id; consumers MUST dedupe on this (at-least-once delivery). */
  readonly eventId: string;
  readonly type: EventType;
  readonly occurredAt: string;
  readonly aggregateId: number;
  readonly actor: string;
  readonly requestId: string;
  /** W3C trace context (traceparent/tracestate) captured when the event was
   *  produced, so async consumers (agents) continue the same distributed trace. */
  readonly trace?: Record<string, string>;
  readonly data: T;
}

export interface CardMovedData {
  readonly from: { status: Status; rank: string };
  readonly to: { status: Status; rank: string };
  readonly versionBefore: number;
  readonly versionAfter: number;
  /** Neighbour ids the card was placed between (null = lane edge). */
  readonly prevId: number | null;
  readonly nextId: number | null;
}
