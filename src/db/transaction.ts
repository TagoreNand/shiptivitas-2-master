/**
 * Transaction orchestration — deliberately dependency-free (no `pg` import).
 *
 * This is what makes the service layer unit-testable without a database: the
 * service depends only on these minimal structural interfaces, and tests inject
 * an in-memory fake. The concrete pg pool (see ./pool.ts) satisfies `TxPool`.
 *
 * `withTransaction` wraps work in a SERIALIZABLE transaction and transparently
 * retries on serialization failures (40001) and deadlocks (40P01) with bounded,
 * jittered exponential backoff — the standard pattern for correctness-critical
 * concurrent writes.
 */

import { ConcurrencyRetryExhaustedError } from '../domain/errors.ts';

export interface QueryResultLike<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}

export interface Queryable {
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResultLike<R>>;
}

export interface TxClient extends Queryable {
  release(): void;
}

export interface TxPool extends Queryable {
  connect(): Promise<TxClient>;
}

interface MiniLogger {
  warn(obj: unknown, msg?: string): void;
}

export type IsolationLevel = 'SERIALIZABLE' | 'REPEATABLE READ' | 'READ COMMITTED';

export interface TxOptions {
  isolationLevel?: IsolationLevel;
  maxRetries?: number;
  onRetry?: (attempt: number, code: string) => void;
  logger?: MiniLogger;
}

/** Postgres SQLSTATEs that are safe to retry verbatim. */
const RETRYABLE = new Set(['40001', '40P01']);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const backoffMs = (attempt: number): number =>
  Math.min(500, 20 * 2 ** attempt) + Math.floor(Math.random() * 25);

export async function withTransaction<T>(
  pool: TxPool,
  work: (tx: TxClient) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  const isolation = opts.isolationLevel ?? 'SERIALIZABLE';
  const maxRetries = opts.maxRetries ?? 5;
  let attempt = 0;

  for (;;) {
    const tx = await pool.connect();
    try {
      await tx.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await tx.query('ROLLBACK');
      } catch {
        /* connection may already be broken; ignore */
      }
      const code = (err as { code?: string }).code ?? '';
      if (RETRYABLE.has(code)) {
        if (attempt < maxRetries) {
          attempt += 1;
          opts.onRetry?.(attempt, code);
          opts.logger?.warn({ attempt, code }, 'retrying serializable transaction');
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ConcurrencyRetryExhaustedError('Transaction exceeded its retry budget', {
          code,
          attempts: attempt,
        });
      }
      throw err;
    } finally {
      tx.release();
    }
  }
}
