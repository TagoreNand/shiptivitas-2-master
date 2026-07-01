/**
 * Service-level tests for the rank-based moveCard: neighbour resolution,
 * single-row updates, optimistic concurrency, no-op handling, cross-lane moves,
 * and audit/outbox side effects. In-memory fakes -> runs with zero infra.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ClientsService } from '../src/services/clients.service.ts';
import { VersionConflictError, NotFoundError, ValidationError } from '../src/domain/errors.ts';
import { generateNKeysBetween } from '../src/domain/rank.ts';
import type {
  AdjacentDirection,
  ClientsRepository,
  LaneEnd,
} from '../src/repositories/clients.repository.ts';
import type { AuditEntry, AuditRepository } from '../src/repositories/audit.repository.ts';
import type { OutboxRepository, OutboxRow } from '../src/repositories/outbox.repository.ts';
import type { DomainEvent } from '../src/events/eventTypes.ts';
import type { TxClient, TxPool } from '../src/db/transaction.ts';
import type { Client, Status } from '../src/domain/client.ts';
import type { Metrics } from '../src/observability/metrics.ts';
import type { Logger } from '../src/logger/logger.ts';

function seed(): Client[] {
  const now = new Date().toISOString();
  const rows: Client[] = [];
  const make = (ids: number[], status: Status) => {
    const keys = generateNKeysBetween(null, null, ids.length);
    ids.forEach((id, i) =>
      rows.push({ id, name: 'card-' + id, description: null, status, rank: keys[i]!, version: 0, createdAt: now, updatedAt: now }),
    );
  };
  make([1, 2, 3], 'backlog');
  make([10, 11], 'in-progress');
  return rows;
}

class FakeClientsRepo implements ClientsRepository {
  constructor(public rows: Client[]) {}
  private lane(status: Status, excludeId: number): Client[] {
    return this.rows
      .filter((r) => r.status === status && r.id !== excludeId)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  }
  async findAll(): Promise<Client[]> {
    return [...this.rows].sort((a, b) =>
      a.status === b.status ? (a.rank < b.rank ? -1 : 1) : a.status.localeCompare(b.status),
    );
  }
  async findById(id: number): Promise<Client | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async lockById(id: number): Promise<Client | null> {
    return this.findById(id);
  }
  async lockAdjacent(status: Status, rank: string, dir: AdjacentDirection, excludeId: number): Promise<Client | null> {
    const lane = this.lane(status, excludeId);
    if (dir === 'next') return lane.find((c) => c.rank > rank) ?? null;
    return [...lane].reverse().find((c) => c.rank < rank) ?? null;
  }
  async lockExtreme(status: Status, end: LaneEnd, excludeId: number): Promise<Client | null> {
    const lane = this.lane(status, excludeId);
    return (end === 'first' ? lane[0] : lane[lane.length - 1]) ?? null;
  }
  async lockAtOffset(status: Status, offset: number, excludeId: number): Promise<Client | null> {
    return this.lane(status, excludeId)[offset] ?? null;
  }
  async laneSize(status: Status, excludeId: number): Promise<number> {
    return this.lane(status, excludeId).length;
  }
  async updatePosition(id: number, status: Status, rank: string): Promise<void> {
    const i = this.rows.findIndex((r) => r.id === id);
    if (i >= 0) this.rows[i] = { ...this.rows[i]!, status, rank, version: this.rows[i]!.version + 1 };
  }
}

class FakeAuditRepo implements AuditRepository {
  entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeOutboxRepo implements OutboxRepository {
  events: DomainEvent[] = [];
  async enqueue(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
  async fetchUnpublished(): Promise<OutboxRow[]> {
    return [];
  }
  async markPublished(): Promise<void> {}
  async countPending(): Promise<number> {
    return 0;
  }
}

const fakePool: TxPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async (): Promise<TxClient> => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => {} }),
};

const counter = () => ({ inc: () => {}, labels: () => ({ inc: () => {} }) });
const fakeMetrics = { versionConflicts: counter(), cardMoves: counter(), txRetries: counter() } as unknown as Metrics;
const fakeLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} } as unknown as Logger;

function makeService(rows: Client[]) {
  const clients = new FakeClientsRepo(rows);
  const audit = new FakeAuditRepo();
  const outbox = new FakeOutboxRepo();
  const service = new ClientsService({ pool: fakePool, clients, audit, outbox, logger: fakeLogger, metrics: fakeMetrics, maxRetries: 3 });
  const orderOf = (status: Status) =>
    clients.rows.filter((r) => r.status === status).sort((a, b) => (a.rank < b.rank ? -1 : 1)).map((r) => r.id);
  return { service, clients, audit, outbox, orderOf };
}

test('afterId places a card directly after the reference and bumps version', async () => {
  const { service, clients, orderOf, audit, outbox } = makeService(seed());
  await service.moveCard({ clientId: 1, afterId: 2, expectedVersion: 0, actor: 'u', requestId: 'r1' });
  assert.deepEqual(orderOf('backlog'), [2, 1, 3]);
  assert.equal(clients.rows.find((r) => r.id === 1)?.version, 1);
  assert.equal(audit.entries.length, 1);
  assert.equal(outbox.events[0]?.type, 'card.moved');
});

test('beforeId places a card directly before the reference', async () => {
  const { service, orderOf } = makeService(seed());
  await service.moveCard({ clientId: 3, beforeId: 1, expectedVersion: 0, actor: 'u', requestId: 'r' });
  assert.deepEqual(orderOf('backlog'), [3, 1, 2]);
});

test('cross-lane move sets status, emits card.completed, old lane just loses the card', async () => {
  const { service, clients, orderOf, outbox } = makeService(seed());
  await service.moveCard({ clientId: 2, toStatus: 'complete', expectedVersion: 0, actor: 'u', requestId: 'r' });
  assert.equal(clients.rows.find((r) => r.id === 2)?.status, 'complete');
  assert.deepEqual(orderOf('backlog'), [1, 3]);
  assert.equal(outbox.events[0]?.type, 'card.completed');
});

test('legacy priority slot is translated (priority:1 => front)', async () => {
  const { service, orderOf } = makeService(seed());
  await service.moveCard({ clientId: 3, toPriority: 1, expectedVersion: 0, actor: 'u', requestId: 'r' });
  assert.deepEqual(orderOf('backlog'), [3, 1, 2]);
});

test('append (status only) puts the card last in the target lane', async () => {
  const { service, orderOf } = makeService(seed());
  await service.moveCard({ clientId: 1, toStatus: 'in-progress', expectedVersion: 0, actor: 'u', requestId: 'r' });
  assert.deepEqual(orderOf('in-progress'), [10, 11, 1]);
});

test('stale version is rejected with 409 and writes nothing', async () => {
  const { service, clients, audit, outbox } = makeService(seed());
  await assert.rejects(
    service.moveCard({ clientId: 1, afterId: 2, expectedVersion: 99, actor: 'u', requestId: 'r' }),
    (err) => err instanceof VersionConflictError && err.statusCode === 409,
  );
  assert.equal(audit.entries.length, 0);
  assert.equal(outbox.events.length, 0);
  assert.equal(clients.rows.find((r) => r.id === 1)?.version, 0);
});

test('two concurrent moves: second (now stale) is rejected', async () => {
  const { service, clients } = makeService(seed());
  await service.moveCard({ clientId: 1, afterId: 2, expectedVersion: 0, actor: 'a', requestId: 'r1' });
  await assert.rejects(
    service.moveCard({ clientId: 1, afterId: 3, expectedVersion: 0, actor: 'b', requestId: 'r2' }),
    VersionConflictError,
  );
  assert.equal(clients.rows.find((r) => r.id === 1)?.version, 1);
});

test('no-op move (already in place) writes nothing', async () => {
  const { service, audit, outbox } = makeService(seed());
  await service.moveCard({ clientId: 2, afterId: 1, expectedVersion: 0, actor: 'u', requestId: 'r' });
  assert.equal(audit.entries.length, 0);
  assert.equal(outbox.events.length, 0);
});

test('positioning relative to itself is a validation error', async () => {
  const { service } = makeService(seed());
  await assert.rejects(
    service.moveCard({ clientId: 1, afterId: 1, expectedVersion: 0, actor: 'u', requestId: 'r' }),
    ValidationError,
  );
});

test('moving a non-existent card throws NotFound', async () => {
  const { service } = makeService(seed());
  await assert.rejects(
    service.moveCard({ clientId: 999, afterId: 1, expectedVersion: 0, actor: 'u', requestId: 'r' }),
    NotFoundError,
  );
});
