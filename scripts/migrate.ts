/**
 * Minimal forward-only migration runner. Applies every migrations/*.sql file in
 * lexical order exactly once, tracking applied files in a `schema_migrations`
 * table. Each file runs inside its own transaction.
 *
 *   npm run migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://shiptivity:shiptivity@localhost:5432/shiptivity';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const applied = new Set(
      (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
        (r) => r.filename,
      ),
    );

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`= skip ${file}`);
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`+ applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
    console.log('migrations up to date');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
