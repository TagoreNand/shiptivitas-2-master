/**
 * Concrete Postgres connection pool. The ONLY module that imports `pg`, which
 * keeps the rest of the codebase driver-agnostic and unit-testable.
 */

import pg from 'pg';
import type { TxPool } from './transaction.ts';

export type AppPool = TxPool & {
  end(): Promise<void>;
  query: TxPool['query'];
};

export function createPool(databaseUrl: string, max: number): AppPool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    application_name: 'shiptivity-api',
    // Fail fast rather than hang forever if Postgres is unreachable.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // pg.Pool / pg.PoolClient are structurally compatible with our minimal
  // TxPool/TxClient abstraction; the cast localises that coupling here.
  return pool as unknown as AppPool;
}
