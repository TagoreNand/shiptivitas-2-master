/**
 * Transactional outbox data-access.
 *
 * `enqueue` is called inside the business transaction, so the event and the
 * state change commit atomically — there is no window where the board changes
 * but the event is lost (or vice versa). A separate relay (see
 * ../events/outboxRelay.ts) drains the table and publishes to Redis.
 */

import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/transaction.ts';
import type { DomainEvent } from '../events/eventTypes.ts';

export interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
}

export interface OutboxRepository {
  enqueue(event: DomainEvent, db: Queryable): Promise<void>;
  fetchUnpublished(limit: number, db: Queryable): Promise<OutboxRow[]>;
  markPublished(ids: string[], db: Queryable): Promise<void>;
  countPending(db: Queryable): Promise<number>;
}

export class PostgresOutboxRepository implements OutboxRepository {
  async enqueue(event: DomainEvent, db: Queryable): Promise<void> {
    await db.query(
      `INSERT INTO outbox (id, aggregate_id, type, payload) VALUES ($1,$2,$3,$4)`,
      [event.eventId || randomUUID(), String(event.aggregateId), event.type, JSON.stringify(event)],
    );
  }

  async fetchUnpublished(limit: number, db: Queryable): Promise<OutboxRow[]> {
    // FOR UPDATE SKIP LOCKED lets N relay workers scale horizontally without
    // ever publishing the same event twice within a batch window.
    const { rows } = await db.query<OutboxRow>(
      `SELECT id, type, payload
         FROM outbox
        WHERE published_at IS NULL
        ORDER BY created_at
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows;
  }

  async markPublished(ids: string[], db: Queryable): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      `UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async countPending(db: Queryable): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM outbox WHERE published_at IS NULL',
    );
    return Number(rows[0]?.count ?? 0);
  }
}
