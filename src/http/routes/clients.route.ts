import { Router } from 'express';
import type { ClientsController } from '../controllers/clients.controller.ts';
import type { Auth } from '../middleware/auth.ts';
import { validate } from '../middleware/validate.ts';
import { clientIdParam, moveCardBody } from '../../schemas/client.schema.ts';

export function clientsRouter(controller: ClientsController, auth: Auth): Router {
  const router = Router();

  router.get('/', controller.list);
  router.get('/:id', validate({ params: clientIdParam }), controller.getOne);

  // Moves are write operations: require the `board:write` scope (enforced when
  // AUTH_REQUIRED=true). Validation runs after authorization.
  router.put(
    '/:id',
    auth.requireScope('board:write'),
    validate({ params: clientIdParam, body: moveCardBody }),
    controller.move,
  );

  return router;
}
