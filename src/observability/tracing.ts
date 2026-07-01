import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';
import type { AppConfig } from '../config/index.ts';
import { noopTracer, type SpanAttributes, type Tracer } from './tracer.ts';

class OtelTracer implements Tracer {
  private readonly tracer = trace.getTracer('shiptivity-api');
  async startSpan<T>(name: string, attributes: SpanAttributes, fn: () => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) span.setAttribute(key, value);
      }
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  }
  traceCarrier(): Record<string, string> {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier;
  }
}

export interface Tracing { tracer: Tracer; shutdown: () => Promise<void>; }

export function startTracing(config: AppConfig): Tracing {
  if (!config.TRACING_ENABLED) return { tracer: noopTracer, shutdown: async () => {} };
  const sdk = new NodeSDK({
    serviceName: config.OTEL_SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({ url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
  });
  sdk.start();
  return { tracer: new OtelTracer(), shutdown: () => sdk.shutdown() };
}
