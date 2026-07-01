/**
 * Process entrypoint. Boots the container, starts the HTTP server and the
 * outbox relay, and wires graceful shutdown on SIGTERM/SIGINT so in-flight
 * requests drain and connections close cleanly (critical under rolling deploys).
 */

import { buildContainer } from './container/container.ts';
import { createApp } from './http/app.ts';

function main(): void {
  const container = buildContainer();
  const { config, logger, outboxRelay, broadcaster } = container;
  const app = createApp(container);

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'shiptivity-api listening');
  });

  outboxRelay.start();
  broadcaster.start().catch((err: unknown) => logger.error({ err }, 'broadcaster failed to start'));

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Force-exit guard in case a connection refuses to close.
    const force = setTimeout(() => {
      logger.error('forced exit after timeout');
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close(() => {
      container
        .shutdown()
        .then(() => {
          logger.info('shutdown complete');
          process.exit(0);
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'error during shutdown');
          process.exit(1);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });
}

main();
