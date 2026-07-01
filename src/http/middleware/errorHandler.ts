/**
 * Central error handling. Operational AppErrors map to their status + stable
 * code; everything else becomes an opaque 500 (internal details never leak to
 * the client, but are logged in full with the correlation id).
 */

import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../domain/errors.ts';
import type { Logger } from '../../logger/logger.ts';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(logger: Logger) {
  // Four args required for Express to treat this as an error handler.
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const requestId = res.locals.requestId as string | undefined;

    if (err instanceof AppError) {
      if (err.statusCode >= 500) logger.error({ err, code: err.code }, err.message);
      else logger.warn({ code: err.code, details: err.details }, err.message);
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, details: err.details ?? undefined, requestId },
      });
      return;
    }

    logger.error({ err }, 'unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
    });
  };
}
