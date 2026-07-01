# syntax=docker/dockerfile:1

# ---- builder: install all deps + compile TypeScript -> dist ----------------
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
# Use `npm ci` once a committed package-lock.json exists; `npm install`
# regenerates the lock on first build.
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
RUN npm run build

# ---- deps: production-only node_modules ------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime: minimal, non-root --------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY package.json ./

# Run as the built-in unprivileged user.
USER node
EXPOSE 3001

# Liveness probe target for orchestrators.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
