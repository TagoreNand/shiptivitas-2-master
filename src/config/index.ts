/**
 * Strongly-typed, fail-fast application configuration.
 *
 * Environment variables are the ONLY source of config. They are parsed and
 * validated once at boot via Zod; if anything is missing or malformed the
 * process refuses to start (never boot a financial-grade service with an
 * ambiguous configuration).
 */

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1).default('postgres://shiptivity:shiptivity@localhost:5432/shiptivity'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  EVENTS_CHANNEL: z.string().min(1).default('board.events'),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(100),

  TX_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),

  CORS_ORIGINS: z.string().default('*'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // --- Auth (JWT). HS256 by default; set JWKS_URI to verify RS256/OIDC. ---
  // AUTH_REQUIRED toggles enforcement: false (dev) accepts anonymous and skips
  // scope checks; true (prod) demands a valid token with the required scope.
  AUTH_REQUIRED: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  JWT_SECRET: z.string().min(1).default('dev-secret-change-me'),
  JWT_ISSUER: z.string().default('shiptivity'),
  JWT_AUDIENCE: z.string().default('shiptivity-api'),
  JWKS_URI: z.string().default(''),

  // --- OpenTelemetry tracing -------------------------------------------------
  TRACING_ENABLED: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  OTEL_SERVICE_NAME: z.string().default('shiptivity-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
});

export type AppConfig = Readonly<z.infer<typeof EnvSchema>> & {
  readonly corsOrigins: readonly string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const corsOrigins = parsed.data.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Object.freeze({ ...parsed.data, corsOrigins });
}
