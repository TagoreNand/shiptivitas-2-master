/**
 * Append-only audit trail. Every state change writes one immutable row inside
 * the same transaction as the change, so the ledger can never drift from
 * reality. In production, REVOKE UPDATE/DELETE on this table from the app role.
 */

import type { Status } from '../domain/client.ts';
import type { Queryable } from '../db/transaction.ts';

export interface AuditEntry {
  clientId: number;
  actor: string;
  action: string;
  fromStatus: Status;
  toStatus: Status;
  fromRank: string;
  toRank: string;
  versionBefore: number;
  versionAfter: number;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface AuditRepository {
  record(entry: AuditEntry, db: Queryable): Promise<void>;
}

export class PostgresAuditRepository implements AuditRepository {
  async record(e: AuditEntry, db: Queryable): Promise<void> {
    await db.query(
      `INSERT INTO audit_log
         (client_id, actor, action, from_status, to_status,
          from_rank, to_rank, version_before, version_after,
          request_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        e.clientId,
        e.actor,
        e.action,
        e.fromStatus,
        e.toStatus,
        e.fromRank,
        e.toRank,
        e.versionBefore,
        e.versionAfter,
        e.requestId,
        JSON.stringify(e.metadata ?? {}),
      ],
    );
  }
}
