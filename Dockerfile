# syntax=docker/dockerfile:1
#
# korovan backend — Fly.io single-stage build
#
# Build context: repo root.
# Fly.io injects PORT (matches fly.toml internal_port=8080).
# Set secrets before first deploy:
#   fly secrets set DB_PATH=/data/korovan.db
#   fly secrets set DEEPSEEK_API_KEY=...
#   fly secrets set SESSION_SECRET=$(openssl rand -hex 32)

FROM node:20-alpine

WORKDIR /app

# Build tools required by better-sqlite3 native bindings
RUN apk add --no-cache python3 make g++

# Install pnpm (lockfileVersion 9 → pnpm 9.x)
RUN npm install -g pnpm@9

# Install workspace dependencies (leverages layer cache when these don't change)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/

RUN pnpm install --frozen-lockfile

# Compile TypeScript → server/dist/
COPY server/src/ server/src/
COPY server/tsconfig.json server/

RUN pnpm --filter server build

# Migrations are read at runtime by server/src/db.ts — not compiled into dist/
COPY server/migrations/ server/migrations/

ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
