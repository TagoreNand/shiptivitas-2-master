/**
 * Data-access for the `clients` (cards) table.
 *
 * The reorder hot-path no longer rewrites a whole lane: it resolves the two
 * neighbour rows around the drop point (locking only those), then updates a
 * SINGLE row's rank. Every neighbour query is bounded (LIMIT 1) and uses the
 * (status, rank) index, so the lock footprint is O(1) regardless of lane size.
 *
 * All `rank` comparisons rely on the column's `COLLATE "C"` (binary) ordering,
 * which matches the byte ordering of the rank-key generator.
 */

import type { Client, Status } from '../domain/client.ts';
import type { Queryable } from '../db/transaction.ts';

interface ClientRow {
  id: number;
  name: string;
  description: string | null;
  status: Status;
  rank: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const toClient = (r: ClientRow): Client => ({
  id: r.id,
  name: r.name,
  description: r.description,
  status: r.status,
  rank: r.rank,
  version: r.version,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});

export type AdjacentDirection = 'next' | 'prev';
export type LaneEnd = 'first' | 'last';

export interface ClientsRepository {
  findAll(db: Queryable): Promise<Client[]>;
  findById(id: number, db: Queryable): Promise<Client | null>;
  /** Locks a single card FOR UPDATE within the caller's transaction. */
  lockById(id: number, db: Queryable): Promise<Client | null>;
  /** Locks the card immediately next/prev to `rank` in a lane (excluding `excludeId`). */
  lockAdjacent(
    status: Status,
    rank: string,
    dir: AdjacentDirection,
    excludeId: number,
    db: Queryable,
  ): Promise<Client | null>;
  /** Locks the first/last card in a lane (excluding `excludeId`). */
  lockExtreme(status: Status, end: LaneEnd, excludeId: number, db: Queryable): Promise<Client | null>;
  /** Locks the card at a 0-based offset by rank (excluding `excludeId`) — legacy slot path. */
  lockAtOffset(status: Status, offset: number, excludeId: number, db: Queryable): Promise<Client | null>;
  /** Number of cards in a lane, excluding `excludeId`. */
  laneSize(status: Status, excludeId: number, db: Queryable): Promise<number>;
  /** Single-row reposition: sets status + rank, bumps version. */
  updatePosition(id: number, status: Status, rank: string, db: Queryable): Promise<void>;
}

export class PostgresClientsRepository implements ClientsRepository {
  async findAll(db: Queryable): Promise<Client[]> {
    const { rows } = await db.query<ClientRow>('SELECT * FROM clients ORDER BY status, rank');
    return rows.map(toClient);
  }

  async findById(id: number, db: Queryable): Promise<Client | null> {
    const { rows } = await db.query<ClientRow>('SELECT * FROM clients WHERE id = $1', [id]);
    return rows[0] ? toClient(rows[0]) : null;
  }

  async lockById(id: number, db: Queryable): Promise<Client | null> {
    const { rows } = await db.query<ClientRow>('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] ? toClient(rows[0]) : null;
  }

  async lockAdjacent(
    status: Status,
    rank: string,
    dir: AdjacentDirection,
    excludeId: number,
    db: Queryable,
  ): Promise<Client | null> {
    const cmp = dir === 'next' ? '>' : '<';
    const order = dir === 'next' ? 'ASC' : 'DESC';
    const { rows } = await db.query<ClientRow>(
      `SELECT * FROM clients
        WHERE status = $1 AND id <> $2 AND rank ${cmp} $3
        ORDER BY rank ${order}
        LIMIT 1 FOR UPDATE`,
      [status, excludeId, rank],
    );
    return rows[0] ? toClient(rows[0]) : null;
  }

  async lockExtreme(
    status: Status,
    end: LaneEnd,
    excludeId: number,
    db: Queryable,
  ): Promise<Client | null> {
    const order = end === 'first' ? 'ASC' : 'DESC';
    const { rows } = await db.query<ClientRow>(
      `SELECT * FROM clients
        WHERE status = $1 AND id <> $2
        ORDER BY rank ${order}
        LIMIT 1 FOR UPDATE`,
      [status, excludeId],
    );
    return rows[0] ? toClient(rows[0]) : null;
  }

  async lockAtOffset(
    status: Status,
    offset: number,
    excludeId: number,
    db: Queryable,
  ): Promise<Client | null> {
    const { rows } = await db.query<ClientRow>(
      `SELECT * FROM clients
        WHERE status = $1 AND id <> $2
        ORDER BY rank ASC
        LIMIT 1 OFFSET $3 FOR UPDATE`,
      [status, excludeId, offset],
    );
    return rows[0] ? toClient(rows[0]) : null;
  }

  async laneSize(status: Status, excludeId: number, db: Queryable): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM clients WHERE status = $1 AND id <> $2',
      [status, excludeId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async updatePosition(id: number, status: Status, rank: string, db: Queryable): Promise<void> {
    await db.query(
      `UPDATE clients
          SET status = $2, rank = $3, version = version + 1, updated_at = now()
        WHERE id = $1`,
      [id, status, rank],
    );
  }
}
