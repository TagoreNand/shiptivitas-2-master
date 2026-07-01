/**
 * Core domain types for the Kanban board.
 *
 * A "client" is a card on the board. Two fields define its position:
 *   - `status` -> which swimlane it lives in (backlog | in-progress | complete)
 *   - `rank`   -> a LexoRank/fractional-index key giving its order WITHIN the
 *                 lane. Cards are sorted by `rank` ascending; a move computes a
 *                 single new key between two neighbours (see domain/rank.ts).
 *
 * `rank` replaces the old contiguous integer `priority`: a move is now an O(1)
 * single-row update instead of an O(N) whole-lane rewrite.
 */

export const STATUSES = ['backlog', 'in-progress', 'complete'] as const;
export type Status = (typeof STATUSES)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** A card as persisted. `version` is the optimistic-concurrency token. */
export interface Client {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly status: Status;
  /** Lexicographically-sortable order key within the lane (COLLATE "C"). */
  readonly rank: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
