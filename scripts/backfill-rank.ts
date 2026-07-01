/**
 * Production migration helper: backfill `rank` for an EXISTING board that still
 * uses the old integer `priority` column.
 *
 * Our fresh schema (0001/0002) already ships with `rank`, so this is only for
 * upgrading a previously-deployed integer-priority database. The recommended
 * online sequence is:
 *
 *   1. ALTER TABLE clients ADD COLUMN rank TEXT COLLATE "C";   -- nullable
 *   2. node --experimental-transform-types scripts/backfill-rank.ts
 *   3. ALTER TABLE clients ALTER COLUMN rank SET NOT NULL,
 *        ADD CONSTRAINT clients_status_rank_uniq UNIQUE (status, rank)
 *        DEFERRABLE INITIALLY DEFERRED;
 *   4. (later, after deploying code that reads `rank`) ALTER TABLE clients DROP COLUMN priority;
 *
 * Run inside a maintenance window or behind a feature flag.
 */
import pg from 'pg';
import { generateNKeysBetween } from '../src/domain/rank.ts';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://shiptivity:shiptivity@localhost:5432/shiptivity';

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    const { rows: lanes } = await pool.query<{ status: string }>(
      'SELECT DISTINCT status FROM clients',
    );
    for (const { status } of lanes) {
      const { rows } = await pool.query<{ id: number }>(
        'SELECT id FROM clients WHERE status = $1 ORDER BY priority ASC, id ASC',
        [status],
      );
      const keys = generateNKeysBetween(null, null, rows.length);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < rows.length; i++) {
          await client.query('UPDATE clients SET rank = $1 WHERE id = $2', [keys[i], rows[i]!.id]);
        }
        await client.query('COMMIT');
        console.log(`backfilled ${rows.length} ranks for lane '${status}'`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    console.log('rank backfill complete');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
