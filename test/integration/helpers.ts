/**
 * Integration-test harness: spins up a real PostgreSQL via Testcontainers, runs
 * the migrations, and wires the actual repositories + service against it. This
 * exercises the genuine SQL, locks, and SERIALIZABLE transaction behaviour —
 * the things in-memory fakes can't prove.
 *
 * Requires Docker. Run with:  npm run test:integration
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { PostgresClientsRepository } from '../../src/repositories/clients.repository.ts';
import { PostgresAuditRepository } from '../../src/repositories/audit.repository.ts';
import { PostgresOutboxRepository } from '../../src/repositories/outbox.repository.ts';
import { ClientsService } from '../../src/services/clients.service.ts';
import { createMetrics } from '../../src/observability/metrics.ts';
import { createLogger } from '../../src/logger/logger.ts';
import type { AppPool } from '../../src/db/pool.ts';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

export interface TestEnv {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  service: ClientsService;
  stop: () => Promise<void>;
}

export async function startTestEnv(): Promise<TestEnv> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });

  for (const file of ['0001_init.sql', '0002_seed.sql']) {
    await pool.query(await readFile(path.join(migrationsDir, file), 'utf8'));
  }

  const service = new ClientsService({
    pool: pool as unknown as AppPool,
    clients: new PostgresClientsRepository(),
    audit: new PostgresAuditRepository(),
    outbox: new PostgresOutboxRepository(),
    logger: createLogger('error', false),
    metrics: createMetrics(),
    maxRetries: 10,
  });

  const stop = async (): Promise<void> => {
    await pool.end();
    await container.stop();
  };

  return { container, pool, service, stop };
}
