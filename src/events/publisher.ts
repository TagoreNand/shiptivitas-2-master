/**
 * Redis Pub/Sub publisher. Kept behind an interface so the broker can be
 * swapped for Kafka/NATS without touching the relay or service layers.
 */

import { Redis } from 'ioredis';
import type { Logger } from '../logger/logger.ts';

export interface EventPublisher {
  publish(channel: string, message: string): Promise<void>;
  close(): Promise<void>;
}

export class RedisPublisher implements EventPublisher {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async publish(channel: string, message: string): Promise<void> {
    const receivers = await this.redis.publish(channel, message);
    this.logger.debug({ channel, receivers }, 'event published');
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: true });
}
