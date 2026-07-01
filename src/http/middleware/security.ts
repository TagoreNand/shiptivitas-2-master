/**
 * Baseline API hardening: secure headers (helmet), an explicit CORS allow-list,
 * and a rate limiter. Body-size limits live in app.ts; field-level
 * sanitization of free text (card descriptions) is enforced by Zod + the
 * frontend escaping, and parameterized SQL eliminates injection at the DAL.
 */

import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { AppConfig } from '../../config/index.ts';

export function securityMiddleware(config: AppConfig): RequestHandler[] {
  const allowList = config.corsOrigins;
  const corsOptions = allowList.includes('*')
    ? { origin: true }
    : { origin: [...allowList] };

  return [
    helmet(),
    cors(corsOptions),
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    }),
  ];
}
