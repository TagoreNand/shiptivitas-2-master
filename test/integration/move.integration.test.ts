/**
 * Integration tests against a real PostgreSQL (Testcontainers): verifies the
 * actual SQL, version bumping, audit, and outbox writes for a single move.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;

before(async () => {
  env = await startTestEnv();
});
after(async () => {
  await env.stop();
});

test('cross-lane move to front persists, bumps version, writes audit + outbox', async () => {
  const board = await env.service.listBoard();
  const card = board.find((c) => c.status === 'backlog');
  assert.ok(card, 'expected a backlog card from seed');

  await env.service.moveCard({
    clientId: card.id,
    toStatus: 'in-progress',
    toPriority: 1,
    expectedVersion: card.version,
    actor: 'user:test',
    requestId: 'it-1',
  });

  const after = await env.service.listBoard();
  const inProgress = after.filter((c) => c.status === 'in-progress');
  assert.equal(inProgress[0]?.id, card.id, 'moved card should be first in-progress');
  assert.equal(after.find((c) => c.id === card.id)?.version, card.version + 1);

  const audit = await env.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_log WHERE client_id = $1',
    [card.id],
  );
  assert.ok((audit.rows[0]?.n ?? 0) >= 1, 'audit row written');

  const outbox = await env.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM outbox');
  assert.ok((outbox.rows[0]?.n ?? 0) >= 1, 'outbox event written');
});

test('stale version is rejected with 409 and persists nothing', async () => {
  const board = await env.service.listBoard();
  const card = board[0];
  assert.ok(card);
  const before = card.version;

  await assert.rejects(
    env.service.moveCard({
      clientId: card.id,
      toPriority: 1,
      expectedVersion: before + 999,
      actor: 'user:test',
      requestId: 'it-2',
    }),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 409,
  );

  const reread = await env.service.getCard(card.id);
  assert.equal(reread.version, before, 'version unchanged after rejected move');
});

test('every lane keeps unique, strictly-increasing ranks (DB invariant)', async () => {
  const board = await env.service.listBoard();
  for (const status of ['backlog', 'in-progress', 'complete'] as const) {
    const ranks = board.filter((c) => c.status === status).map((c) => c.rank);
    assert.equal(new Set(ranks).size, ranks.length, `duplicate ranks in ${status}`);
    for (let i = 1; i < ranks.length; i++) {
      assert.ok(ranks[i - 1]! < ranks[i]!, `ranks not increasing in ${status}`);
    }
  }
});
