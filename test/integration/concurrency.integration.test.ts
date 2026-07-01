/**
 * The real proof of the concurrency design: fire many moves into the SAME lane
 * and the SAME gap simultaneously against a real PostgreSQL, and assert the
 * board stays valid — no duplicate ranks, no lost moves, strictly-ordered keys.
 *
 * This is what in-memory fakes cannot demonstrate: it relies on genuine
 * SERIALIZABLE isolation, FOR UPDATE neighbour locks, the DEFERRABLE unique
 * constraint, and the transaction retry loop all working together.
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

test('N concurrent moves into the front of one lane: no collisions, all applied', async () => {
  const board = await env.service.listBoard();
  const movers = board.filter((c) => c.status === 'backlog').slice(0, 8);
  assert.ok(movers.length >= 5, 'need several backlog cards to contend');

  const startComplete = board.filter((c) => c.status === 'complete').length;

  // All target 'complete' slot 1 at once -> maximum contention on one gap.
  const results = await Promise.allSettled(
    movers.map((c) =>
      env.service.moveCard({
        clientId: c.id,
        toStatus: 'complete',
        toPriority: 1,
        expectedVersion: c.version,
        actor: 'load',
        requestId: `cc-${c.id}`,
      }),
    ),
  );

  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(
    rejected.length,
    0,
    `all distinct-card moves should succeed; got ${rejected.length} failures: ` +
      JSON.stringify(rejected.map((r) => (r as PromiseRejectedResult).reason?.message)),
  );

  const after = await env.service.listBoard();
  const complete = after.filter((c) => c.status === 'complete');

  // 1. Count grew by exactly the number of movers (no lost or duplicated moves).
  assert.equal(complete.length, startComplete + movers.length);

  // 2. Ranks are unique (the DB unique constraint + retries held under the race).
  const ranks = complete.map((c) => c.rank);
  assert.equal(new Set(ranks).size, ranks.length, 'duplicate ranks under concurrency!');

  // 3. listBoard returns lane ordered by rank -> must be strictly increasing.
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i - 1]! < ranks[i]!, 'ranks not strictly increasing');
  }

  // 4. Every mover landed in 'complete'.
  const completeIds = new Set(complete.map((c) => c.id));
  for (const m of movers) assert.ok(completeIds.has(m.id), `card ${m.id} missing`);
});

test('concurrent moves of the SAME card: exactly one wins, others 409', async () => {
  const board = await env.service.listBoard();
  const card = board.find((c) => c.status === 'backlog') ?? board[0];
  assert.ok(card);

  // 5 racers all use the same starting version -> OCC permits exactly one.
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      env.service.moveCard({
        clientId: card.id,
        toPriority: 1,
        expectedVersion: card.version,
        actor: `racer-${i}`,
        requestId: `same-${i}`,
      }),
    ),
  );

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  assert.equal(ok, 1, 'exactly one move should win the OCC race');

  const reread = await env.service.getCard(card.id);
  assert.equal(reread.version, card.version + 1, 'version advanced exactly once');
});
