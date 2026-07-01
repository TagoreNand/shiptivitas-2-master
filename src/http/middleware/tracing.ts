import { context, propagation, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

export function httpTracing() {
  const tracer = trace.getTracer('shiptivity-http');
  return (req: Request, res: Response, next: NextFunction): void => {
    const parentCtx = propagation.extract(context.active(), req.headers);
    const span = tracer.startSpan(
      `${req.method} ${req.path}`,
      { kind: SpanKind.SERVER, attributes: { 'http.request.method': req.method, 'url.path': req.path } },
      parentCtx,
    );
    const activeCtx = trace.setSpan(parentCtx, span);
    res.on('finish', () => {
      span.setAttribute('http.response.status_code', res.statusCode);
      if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    });
    context.with(activeCtx, () => next());
  };
}
