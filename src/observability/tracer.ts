export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, SpanAttributeValue | undefined>;

export interface Tracer {
  startSpan<T>(name: string, attributes: SpanAttributes, fn: () => Promise<T>): Promise<T>;
  traceCarrier(): Record<string, string>;
}

export const noopTracer: Tracer = {
  async startSpan<T>(_name: string, _attributes: SpanAttributes, fn: () => Promise<T>): Promise<T> {
    return fn();
  },
  traceCarrier(): Record<string, string> {
    return {};
  },
};
