import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppError, ForbiddenError, UnauthorizedError } from '../../domain/errors.ts';
import { currentContext } from '../../logger/logger.ts';
import type { AppConfig } from '../../config/index.ts';

export interface Principal {
  readonly subject: string;
  readonly scopes: readonly string[];
  readonly claims: JWTPayload;
}

export interface Auth {
  authenticate(): RequestHandler;
  requireScope(scope: string): RequestHandler;
}

const ANONYMOUS: Principal = { subject: 'anonymous', scopes: [], claims: {} };

function extractScopes(payload: JWTPayload): string[] {
  const out = new Set<string>();
  const add = (v: unknown): void => {
    if (typeof v === 'string') v.split(/\s+/).forEach((s) => s && out.add(s));
    else if (Array.isArray(v)) v.forEach((s) => typeof s === 'string' && out.add(s));
  };
  add(payload['scope']);
  add(payload['scp']);
  add(payload['permissions']);
  return [...out];
}

export function createAuth(config: AppConfig): Auth {
  const jwks: JWTVerifyGetKey | null = config.JWKS_URI
    ? createRemoteJWKSet(new URL(config.JWKS_URI))
    : null;
  const secret = new TextEncoder().encode(config.JWT_SECRET);
  const verifyOptions = {
    issuer: config.JWT_ISSUER || undefined,
    audience: config.JWT_AUDIENCE || undefined,
  };

  async function verify(token: string): Promise<Principal> {
    const { payload } = jwks
      ? await jwtVerify(token, jwks, verifyOptions)
      : await jwtVerify(token, secret, verifyOptions);
    return { subject: String(payload.sub ?? 'unknown'), scopes: extractScopes(payload), claims: payload };
  }

  function setPrincipal(res: Response, principal: Principal): void {
    res.locals.principal = principal;
    res.locals.actor = principal.subject;
    const ctx = currentContext();
    if (ctx) ctx.actor = principal.subject;
  }

  return {
    authenticate(): RequestHandler {
      return (req: Request, res: Response, next: NextFunction): void => {
        const header = req.header('authorization') ?? '';
        const [scheme, headerToken] = header.split(' ');
        // EventSource can't set headers, so SSE clients may pass ?access_token=.
        const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : undefined;
        const token = scheme?.toLowerCase() === 'bearer' && headerToken ? headerToken : queryToken;
        if (!token) {
          if (config.AUTH_REQUIRED) return next(new UnauthorizedError('Missing bearer token'));
          setPrincipal(res, ANONYMOUS);
          return next();
        }
        verify(token)
          .then((principal) => {
            setPrincipal(res, principal);
            next();
          })
          .catch((err: unknown) => {
            next(err instanceof AppError ? err : new UnauthorizedError('Invalid or expired token'));
          });
      };
    },
    requireScope(scope: string): RequestHandler {
      return (_req: Request, res: Response, next: NextFunction): void => {
        if (!config.AUTH_REQUIRED) return next();
        const principal = res.locals.principal as Principal | undefined;
        if (!principal || principal === ANONYMOUS) {
          return next(new UnauthorizedError('Authentication required'));
        }
        if (!principal.scopes.includes(scope)) {
          return next(new ForbiddenError(`Missing required scope: ${scope}`));
        }
        next();
      };
    },
  };
}
