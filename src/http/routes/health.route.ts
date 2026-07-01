import { Router } from 'express';
import type { TxPool } from '../../db/transaction.ts';
import type { Metrics } from '../../observability/metrics.ts';

/** Kubernetes-style liveness/readiness probes + Prometheus scrape endpoint. */
export function healthRouter(pool: TxPool, metrics: Metrics): Router {
  const router = Router();

  // Liveness: the process is running.
  router.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Readiness: critical dependencies are reachable.
  router.get('/readyz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  router.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  });

  return router;
}
