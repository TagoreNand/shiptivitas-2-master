/**
 * Dev helper: mint an HS256 JWT for local testing / the agent.
 *
 *   node --experimental-transform-types scripts/mint-token.ts [subject] [scopes]
 *   node --experimental-transform-types scripts/mint-token.ts agent:triage-bot "board:write"
 *
 * Uses the same JWT_SECRET/ISSUER/AUDIENCE the API verifies with. NEVER use the
 * default secret outside local development.
 */
import { SignJWT } from 'jose';

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const ISSUER = process.env.JWT_ISSUER ?? 'shiptivity';
const AUDIENCE = process.env.JWT_AUDIENCE ?? 'shiptivity-api';

const subject = process.argv[2] ?? 'user:dev';
const scope = process.argv[3] ?? 'board:read board:write';

const token = await new SignJWT({ scope })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(subject)
  .setIssuer(ISSUER)
  .setAudience(AUDIENCE)
  .setIssuedAt()
  .setExpirationTime('12h')
  .sign(new TextEncoder().encode(SECRET));

console.log(token);
