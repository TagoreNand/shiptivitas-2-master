/**
 * Composition root (manual dependency injection). Every concrete dependency is
 * constructed once here and wired via constructor injection; the rest of the
 * codebase depends only on interfaces.
 */

import { loadConfig, type AppConfig } from '../config/index.ts';
import { createLogger, type Logger } from '../logger/logger.ts';
import { createMetrics, type Metrics } from '../observability/metrics.ts';
import { startTracing, type Tracing } from '../observability/tracing.ts';
import { createPool, type AppPool } from '../db/pool.ts';
import { createRedis, RedisPublisher } from '../events/publisher.ts';
import { PostgresClientsRepository } from '../repositories/clients.repository.ts';
import { PostgresAuditRepository } from '../repositories/audit.repository.ts';
import { PostgresOutboxRepository } from '../repositories/outbox.repository.ts';
import { ClientsService } from '../services/clients.service.ts';
import { ClientsController } from '../http/controllers/clients.controller.ts';
import { OutboxRelay } from '../events/outboxRelay.ts';
import { BoardBroadcaster } from '../realtime/broadcaster.ts';

export interface Container {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  pool: AppPool;
  clientsService: ClientsService;
  clientsController: ClientsController;
  outboxRelay: OutboxRelay;
  broadcaster: BoardBroadcaster;
  shutdown: () => Promise<void>;
}

export function buildContainer(env: NodeJS.ProcessEnv = process.env): Container {
  const config = loadConfig(env);
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV !== 'production');
  const metrics = createMetrics();
  const tracing: Tracing = startTracing(config);
  const pool = createPool(config.DATABASE_URL, config.DB_POOL_MAX);

  const clientsRepo = new PostgresClientsRepository();
  const auditRepo = new PostgresAuditRepository();
  const outboxRepo = new PostgresOutboxRepository();

  const clientsService = new ClientsService({
    pool,
    clients: clientsRepo,
    audit: auditRepo,
    outbox: outboxRepo,
    logger,
    metrics,
    maxRetries: config.TX_MAX_RETRIES,
    tracer: tracing.tracer,
  });
  const clientsController = new ClientsController(clientsService);

  // Publisher (relay -> Redis) and a SEPARATE subscriber connection for the
  // real-time broadcaster (ioredis requires a dedicated connection to subscribe).
  const redis = createRedis(config.REDIS_URL);
  const publisher = new RedisPublisher(redis, logger);
  const outboxRelay = new OutboxRelay({
    pool,
    outbox: outboxRepo,
    publisher,
    channel: config.EVENTS_CHANNEL,
    pollMs: config.OUTBOX_POLL_MS,
    batchSize: config.OUTBOX_BATCH_SIZE,
    logger,
    metrics,
  });

  const redisSub = createRedis(config.REDIS_URL);
  const broadcaster = new BoardBroadcaster(redisSub, config.EVENTS_CHANNEL, logger, metrics);

  const shutdown = async (): Promise<void> => {
    await outboxRelay.stop();
    await broadcaster.stop();
    await publisher.close();
    await redisSub.quit();
    await pool.end();
    await tracing.shutdown();
  };

  return {
    config,
    logger,
    metrics,
    pool,
    clientsService,
    clientsController,
    outboxRelay,
    broadcaster,
    shutdown,
  };
}
