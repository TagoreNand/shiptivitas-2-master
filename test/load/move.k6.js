/**
 * k6 HTTP load test: hammer the move endpoint with concurrent virtual users.
 * Under contention a fraction of moves will legitimately get 409 (stale
 * version) — that is correct OCC behaviour, so both 200 and 409 pass the check.
 *
 *   API_BASE=http://localhost:3001/api/v1 TOKEN=$(npm run -s mint-token) \
 *     k6 run test/load/move.k6.js
 */
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 25,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

const BASE = __ENV.API_BASE || 'http://localhost:3001/api/v1';
const TOKEN = __ENV.TOKEN || '';
const authHeaders = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

export default function () {
  const list = http.get(`${BASE}/clients`, { headers: authHeaders });
  check(list, { 'list 200': (r) => r.status === 200 });
  if (list.status !== 200) return;

  const board = list.json();
  const backlog = board.filter((c) => c.status === 'backlog');
  if (backlog.length === 0) return;

  const card = backlog[Math.floor(Math.random() * backlog.length)];
  const move = http.put(
    `${BASE}/clients/${card.id}`,
    JSON.stringify({ status: 'in-progress', priority: 1, version: card.version }),
    { headers: { 'Content-Type': 'application/json', ...authHeaders } },
  );
  // 200 = applied, 409 = lost the OCC race (expected under load).
  check(move, { 'move 200 or 409': (r) => r.status === 200 || r.status === 409 });
}
