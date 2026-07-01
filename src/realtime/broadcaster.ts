import type { Redis } from 'ioredis';
import type { Logger } from '../logger/logger.ts';
import type { Metrics } from '../observability/metrics.ts';

export interface SseClient { readonly id: string; readonly write: (frame: string) => void; }

export class BoardBroadcaster {
  private readonly clients = new Map<string, SseClient>();
  constructor(
    private readonly subscriber: Redis,
    private readonly channel: string,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
  ) {}
  async start(): Promise<void> {
    await this.subscriber.subscribe(this.channel);
    this.subscriber.on('message', (_channel, message) => this.fanout(message));
  }
  add(client: SseClient): void { this.clients.set(client.id, client); this.metrics.sseConnections.set(this.clients.size); }
  remove(id: string): void { this.clients.delete(id); this.metrics.sseConnections.set(this.clients.size); }
  get size(): number { return this.clients.size; }
  private fanout(message: string): void {
    let type = 'message';
    let id = '';
    try { const p = JSON.parse(message) as { type?: string; eventId?: string }; type = p.type ?? 'message'; id = p.eventId ?? ''; } catch { /* raw */ }
    const frame = `id: ${id}\nevent: ${type}\ndata: ${message}\n\n`;
    for (const client of this.clients.values()) {
      try { client.write(frame); } catch (err) { this.logger.warn({ err }, 'dropping SSE client'); this.remove(client.id); }
    }
  }
  async stop(): Promise<void> {
    try { await this.subscriber.unsubscribe(this.channel); } catch { /* ignore */ }
    this.clients.clear();
    this.metrics.sseConnections.set(0);
  }
}
