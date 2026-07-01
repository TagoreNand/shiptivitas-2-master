/**
 * Generic Zod validation middleware. Validated, typed output is written to
 * res.locals (never mutating req.* in place), keeping the contract explicit.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../../domain/errors.ts';

export interface Schemas {
  params?: ZodType;
  body?: ZodType;
  query?: ZodType;
}

export function validate(schemas: Schemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) res.locals.params = schemas.params.parse(req.params);
      if (schemas.body) res.locals.body = schemas.body.parse(req.body);
      if (schemas.query) res.locals.query = schemas.query.parse(req.query);
      next();
    } catch (err) {
      next(toValidationError(err));
    }
  };
}

function toValidationError(err: unknown): ValidationError {
  const issues = (err as { issues?: Array<{ path: Array<string | number>; message: string }> }).issues;
  if (Array.isArray(issues)) {
    return new ValidationError(
      'Request validation failed',
      issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  return new ValidationError('Request validation failed');
}
