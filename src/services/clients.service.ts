import { randomUUID } from 'node:crypto';
import type { Client, Status } from '../domain/client.ts';
import { isStatus } from '../domain/client.ts';
import { NotFoundError, ValidationError, VersionConflictError } from '../domain/errors.ts';
import { generateKeyBetween } from '../domain/rank.ts';
import { withTransaction, type TxClient, type TxPool } from '../db/transaction.ts';
import type { ClientsRepository } from '../repositories/clients.repository.ts';
import type { AuditRepository } from '../repositories/audit.repository.ts';
import type { OutboxRepository } from '../repositories/outbox.repository.ts';
import type { CardMovedData, DomainEvent } from '../events/eventTypes.ts';
import type { Logger } from '../logger/logger.ts';
import type { Metrics } from '../observability/metrics.ts';
import { noopTracer, type Tracer } from '../observability/tracer.ts';

export interface MoveCardCommand {
  readonly clientId: number;
  readonly toStatus?: Status;
  readonly afterId?: number;
  readonly beforeId?: number;
  readonly toPriority?: number;
  readonly expectedVersion: number;
  readonly actor: string;
  readonly requestId: string;
}

export interface ClientsServiceDeps {
  readonly pool: TxPool;
  readonly clients: ClientsRepository;
  readonly audit: AuditRepository;
  readonly outbox: OutboxRepository;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly maxRetries: number;
  readonly tracer?: Tracer;
}

export class ClientsService {
  constructor(private readonly deps: ClientsServiceDeps) {}

  async listBoard(): Promise<Client[]> {
    return this.deps.clients.findAll(this.deps.pool);
  }

  async getCard(id: number): Promise<Client> {
    const card = await this.deps.clients.findById(id, this.deps.pool);
    if (!card) throw new NotFoundError(`Client ${id} not found`);
    return card;
  }

  async moveCard(cmd: MoveCardCommand): Promise<Client[]> {
    if (cmd.toStatus !== undefined && !isStatus(cmd.toStatus)) {
      throw new ValidationError(`Invalid status '${String(cmd.toStatus)}'`);
    }
    const { pool, clients, audit, outbox, logger, metrics, maxRetries } = this.deps;
    const tracer = this.deps.tracer ?? noopTracer;

    return tracer.startSpan(
      'kanban.move_card',
      { 'kanban.client_id': cmd.clientId, 'enduser.id': cmd.actor },
      () =>
        withTransaction(
          pool,
          async (tx): Promise<Client[]> => {
            const card = await clients.lockById(cmd.clientId, tx);
            if (!card) throw new NotFoundError(`Client ${cmd.clientId} not found`);

            if (card.version !== cmd.expectedVersion) {
              metrics.versionConflicts.inc();
              throw new VersionConflictError('Client was modified by another request', {
                clientId: card.id,
                expectedVersion: cmd.expectedVersion,
                actualVersion: card.version,
              });
            }

            const toStatus: Status = cmd.toStatus ?? card.status;
            const { prev, next } = await this.resolveNeighbours(cmd, card, toStatus, tx);

            if (
              toStatus === card.status &&
              (prev === null || prev.rank < card.rank) &&
              (next === null || card.rank < next.rank)
            ) {
              logger.info({ clientId: card.id }, 'move resulted in no change; nothing persisted');
              return clients.findAll(tx);
            }

            const newRank = generateKeyBetween(prev?.rank ?? null, next?.rank ?? null);
            await clients.updatePosition(card.id, toStatus, newRank, tx);

            await audit.record(
              {
                clientId: card.id,
                actor: cmd.actor,
                action: 'card.moved',
                fromStatus: card.status,
                toStatus,
                fromRank: card.rank,
                toRank: newRank,
                versionBefore: card.version,
                versionAfter: card.version + 1,
                requestId: cmd.requestId,
                metadata: { prevId: prev?.id ?? null, nextId: next?.id ?? null },
              },
              tx,
            );

            const event: DomainEvent<CardMovedData> = {
              eventId: randomUUID(),
              type: toStatus === 'complete' ? 'card.completed' : 'card.moved',
              occurredAt: new Date().toISOString(),
              aggregateId: card.id,
              actor: cmd.actor,
              requestId: cmd.requestId,
              trace: tracer.traceCarrier(),
              data: {
                from: { status: card.status, rank: card.rank },
                to: { status: toStatus, rank: newRank },
                versionBefore: card.version,
                versionAfter: card.version + 1,
                prevId: prev?.id ?? null,
                nextId: next?.id ?? null,
              },
            };
            await outbox.enqueue(event, tx);

            metrics.cardMoves.labels(card.status, toStatus).inc();
            logger.info(
              { clientId: card.id, from: card.status, to: toStatus, rank: newRank },
              'card moved',
            );

            return clients.findAll(tx);
          },
          {
            isolationLevel: 'SERIALIZABLE',
            maxRetries,
            logger,
            onRetry: () => metrics.txRetries.inc(),
          },
        ),
    );
  }

  private async resolveNeighbours(
    cmd: MoveCardCommand,
    card: Client,
    toStatus: Status,
    tx: TxClient,
  ): Promise<{ prev: Client | null; next: Client | null }> {
    const { clients } = this.deps;

    if (cmd.afterId !== undefined) {
      if (cmd.afterId === card.id) {
        throw new ValidationError('Cannot position a card relative to itself');
      }
      const ref = await clients.lockById(cmd.afterId, tx);
      if (!ref || ref.status !== toStatus) {
        throw new ValidationError(`afterId ${cmd.afterId} is not a card in the target lane`);
      }
      return { prev: ref, next: await clients.lockAdjacent(toStatus, ref.rank, 'next', card.id, tx) };
    }

    if (cmd.beforeId !== undefined) {
      if (cmd.beforeId === card.id) {
        throw new ValidationError('Cannot position a card relative to itself');
      }
      const ref = await clients.lockById(cmd.beforeId, tx);
      if (!ref || ref.status !== toStatus) {
        throw new ValidationError(`beforeId ${cmd.beforeId} is not a card in the target lane`);
      }
      return { prev: await clients.lockAdjacent(toStatus, ref.rank, 'prev', card.id, tx), next: ref };
    }

    if (cmd.toPriority !== undefined) {
      const size = await clients.laneSize(toStatus, card.id, tx);
      const slot = Math.max(1, Math.min(cmd.toPriority, size + 1));
      if (slot === 1) {
        return { prev: null, next: await clients.lockExtreme(toStatus, 'first', card.id, tx) };
      }
      const prev = await clients.lockAtOffset(toStatus, slot - 2, card.id, tx);
      const next = prev ? await clients.lockAdjacent(toStatus, prev.rank, 'next', card.id, tx) : null;
      return { prev, next };
    }

    return { prev: await clients.lockExtreme(toStatus, 'last', card.id, tx), next: null };
  }
}
