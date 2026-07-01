/**
 * Outbox relay worker. Polls the outbox, publishes pending events to Redis, and
 * marks them published — all inside a transaction using FOR UPDATE SKIP LOCKED,
 * so multiple instances can run concurrently for HA without double-delivery.
 *
 * Delivery is at-least-once: if a crash happens after publish but before the
 * COMMIT of markPublished, the event re-publishes on the next tick. Consumers
 * MUST dedupe on `eventId`.
 */

import { withTransaction, type TxPool } from '../db/transaction.ts';
import type { OutboxRepository } from '../repositories/outbox.repository.ts';
import type { EventPublisher } from './publisher.ts';
import type { Logger } from '../logger/logger.ts';
import type { Metrics } from '../observability/metrics.ts';

export interface OutboxRelayDeps {
  pool: TxPool;
  outbox: OutboxRepository;
  publisher: EventPublisher;
  channel: string;
  pollMs: number;
  batchSize: number;
  logger: Logger;
  metrics: Metrics;
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private stopped = false;

  constructor(private readonly deps: OutboxRelayDeps) {}

  start(): void {
    if (this.timer) return;
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.drainOnce();
      } catch (err) {
        this.deps.logger.error({ err }, 'outbox relay tick failed');
      }
      if (!this.stopped) this.timer = setTimeout(() => void tick(), this.deps.pollMs);
    };
    this.timer = setTimeout(() => void tick(), this.deps.pollMs);
    this.deps.logger.info(
      { channel: this.deps.channel, pollMs: this.deps.pollMs },
      'outbox relay started',
    );
  }

  /** Publishes one batch; returns the number of events relayed. */
  async drainOnce(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      return await withTransaction(
        this.deps.pool,
        async (tx) => {
          const rows = await this.deps.outbox.fetchUnpublished(this.deps.batchSize, tx);
          if (rows.length === 0) {
            this.deps.metrics.outboxLag.set(await this.deps.outbox.countPending(tx));
            return 0;
          }
          for (const row of rows) {
            const message = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
            await this.deps.publisher.publish(this.deps.channel, message);
          }
          await this.deps.outbox.markPublished(
            rows.map((r) => r.id),
            tx,
          );
          return rows.length;
        },
        { isolationLevel: 'READ COMMITTED', maxRetries: 3, logger: this.deps.logger },
      );
    } finally {
      this.draining = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
