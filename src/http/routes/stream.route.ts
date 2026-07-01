import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { BoardBroadcaster } from '../../realtime/broadcaster.ts';
import type { Auth } from '../middleware/auth.ts';

export function streamRouter(broadcaster: BoardBroadcaster, auth: Auth): Router {
  const router = Router();
  router.get('/', auth.requireScope('board:read'), (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const id = randomUUID();
    res.write(`: connected ${id}\n\n`);
    broadcaster.add({ id, write: (frame) => res.write(frame) });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(heartbeat); broadcaster.remove(id); });
  });
  return router;
}
