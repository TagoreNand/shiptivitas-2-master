/**
 * Express application assembly. Middleware order is deliberate:
 * security -> body parsing -> correlation -> metrics -> routes -> 404 -> errors.
 */

import express, { type Express } from 'express';
import type { Container } from '../container/container.ts';
import { requestContext } from './middleware/requestContext.ts';
import { securityMiddleware } from './middleware/security.ts';
import { httpMetrics } from './middleware/httpMetrics.ts';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { createAuth } from './middleware/auth.ts';
import { httpTracing } from './middleware/tracing.ts';
import { clientsRouter } from './routes/clients.route.ts';
import { healthRouter } from './routes/health.route.ts';
import { streamRouter } from './routes/stream.route.ts';

export function createApp(c: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(...securityMiddleware(c.config));
  app.use(express.json({ limit: '64kb' }));
  app.use(requestContext);
  app.use(httpTracing());
  app.use(httpMetrics(c.metrics));

  // Health/metrics stay public (orchestrator probes + Prometheus scraping).
  app.use('/', healthRouter(c.pool, c.metrics));

  // Everything below requires an authenticated principal (anonymous in dev).
  const auth = createAuth(c.config);
  app.use(auth.authenticate());
  app.use('/api/v1/clients', clientsRouter(c.clientsController, auth));
  app.use('/api/v1/stream', streamRouter(c.broadcaster, auth)); // live board (SSE)

  app.use(notFoundHandler);
  app.use(errorHandler(c.logger));

  return app;
}
