/**
 * Prometheus metrics registry + domain counters/histograms.
 * Scraped at GET /metrics. Default process metrics (event-loop lag, heap, GC)
 * are collected automatically alongside the custom Kanban metrics below.
 */

import client from 'prom-client';

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const cardMoves = new client.Counter({
    name: 'kanban_card_moves_total',
    help: 'Total successfully committed card moves',
    labelNames: ['from', 'to'] as const,
    registers: [registry],
  });

  const versionConflicts = new client.Counter({
    name: 'kanban_version_conflicts_total',
    help: 'Total optimistic-concurrency conflicts (HTTP 409)',
    registers: [registry],
  });

  const txRetries = new client.Counter({
    name: 'db_tx_retries_total',
    help: 'Total serializable-transaction retries due to serialization/deadlock failures',
    registers: [registry],
  });

  const outboxLag = new client.Gauge({
    name: 'outbox_pending_events',
    help: 'Number of outbox events awaiting publication',
    registers: [registry],
  });

  const sseConnections = new client.Gauge({
    name: 'sse_active_connections',
    help: 'Number of currently-connected real-time (SSE) board clients',
    registers: [registry],
  });

  return {
    registry,
    httpDuration,
    cardMoves,
    versionConflicts,
    txRetries,
    outboxLag,
    sseConnections,
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
