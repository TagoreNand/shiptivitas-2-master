/**
 * Structured JSON logging (Pino) with per-request correlation.
 *
 * An AsyncLocalStorage store carries the requestId + actor through the async
 * call chain, so every log line emitted while handling a request is
 * automatically tagged — no manual threading of a logger through call stacks.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger } from 'pino';

export interface RequestContext {
  readonly requestId: string;
  /** Mutable: set to 'anonymous' at request start, updated by auth middleware. */
  actor: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: { service: 'shiptivity-api' },
    // Auto-attach correlation fields to every line when inside a request.
    mixin() {
      const ctx = storage.getStore();
      return ctx ? { requestId: ctx.requestId, actor: ctx.actor } : {};
    },
    redact: {
      paths: ['req.headers.authorization', 'password', '*.password', 'token', '*.token'],
      remove: true,
    },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}

export type { Logger };
