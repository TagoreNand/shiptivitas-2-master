/**
 * Records request latency into the Prometheus histogram, labelled by method,
 * matched route template (not raw path, to keep cardinality bounded), and
 * status code.
 */

import type { NextFunction, Request, Response } from 'express';
import type { Metrics } from '../../observability/metrics.ts';

export function httpMetrics(metrics: Metrics) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const stop = metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ?? req.baseUrl ?? req.path;
      stop({ method: req.method, route: String(route), status: String(res.statusCode) });
    });
    next();
  };
}
