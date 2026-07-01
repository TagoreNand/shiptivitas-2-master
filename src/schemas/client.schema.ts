/**
 * Zod request schemas. Single source of truth for input validation; inferred
 * types flow into the controller so HTTP input is typed end-to-end.
 *
 * Position is expressed RELATIVE TO NEIGHBOURS (`afterId` / `beforeId`) — the
 * robust, race-friendly model used by Trello/Linear: neighbour ids are stable
 * references, unlike absolute slot indexes that shift under concurrency. A
 * legacy 1-based `priority` is still accepted and translated, for backward
 * compatibility with the original prototype's frontend.
 */

import { z } from 'zod';
import { STATUSES } from '../domain/client.ts';

export const clientIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const moveCardBody = z
  .object({
    /** Target lane. Omit to keep the card in its current lane. */
    status: z.enum(STATUSES).optional(),
    /** Place immediately AFTER this card (in the target lane). */
    afterId: z.coerce.number().int().positive().optional(),
    /** Place immediately BEFORE this card (in the target lane). */
    beforeId: z.coerce.number().int().positive().optional(),
    /** DEPRECATED: legacy 1-based slot index; translated to neighbours. */
    priority: z.coerce.number().int().positive().optional(),
    /** OCC token: the `version` the client last read for this card. Required. */
    version: z.coerce.number().int().nonnegative(),
  })
  .refine(
    (b) =>
      b.status !== undefined ||
      b.afterId !== undefined ||
      b.beforeId !== undefined ||
      b.priority !== undefined,
    { message: 'Provide `status` and/or a position (`afterId`, `beforeId`, or `priority`).' },
  )
  .refine((b) => !(b.afterId !== undefined && b.beforeId !== undefined), {
    message: 'Provide at most one of `afterId` or `beforeId`.',
  });

export type ClientIdParam = z.infer<typeof clientIdParam>;
export type MoveCardBody = z.infer<typeof moveCardBody>;
