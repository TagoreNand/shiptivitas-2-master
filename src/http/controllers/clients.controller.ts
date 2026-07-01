/**
 * HTTP controller: translates validated requests into service commands and
 * shapes responses. No business logic lives here — it is a thin adapter.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ClientsService } from '../../services/clients.service.ts';
import type { ClientIdParam, MoveCardBody } from '../../schemas/client.schema.ts';

export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  list = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await this.service.listBoard());
    } catch (err) {
      next(err);
    }
  };

  getOne = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = res.locals.params as ClientIdParam;
      res.status(200).json(await this.service.getCard(id));
    } catch (err) {
      next(err);
    }
  };

  /** PUT /api/v1/clients/:id — move/reorder a card. */
  move = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = res.locals.params as ClientIdParam;
      const body = res.locals.body as MoveCardBody;
      const board = await this.service.moveCard({
        clientId: id,
        toStatus: body.status,
        afterId: body.afterId,
        beforeId: body.beforeId,
        toPriority: body.priority,
        expectedVersion: body.version,
        actor: res.locals.actor as string,
        requestId: res.locals.requestId as string,
      });
      res.status(200).json(board);
    } catch (err) {
      next(err);
    }
  };
}
