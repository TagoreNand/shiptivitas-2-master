/**
 * Establishes per-request correlation: a requestId (propagated or generated)
 * carried through the async chain via AsyncLocalStorage. The `actor` starts as
 * 'anonymous' and is set by the auth middleware once a principal is resolved;
 * because the context object is mutable, log lines pick up the real actor.
 *
 * Note: we deliberately do NOT trust an `x-actor-id` header for identity —
 * identity comes only from a verified token (see middleware/auth.ts).
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext, type RequestContext } from '../../logger/logger.ts';

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.header('x-request-id') ?? randomUUID();
  res.setHeader('x-request-id', requestId);

  const ctx: RequestContext = { requestId, actor: 'anonymous' };
  res.locals.requestId = requestId;
  res.locals.actor = ctx.actor;

  runWithContext(ctx, () => next());
}
