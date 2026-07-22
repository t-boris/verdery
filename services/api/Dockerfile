# syntax=docker/dockerfile:1.7

# Builds a minimal, production-only image for the API service.
#
# Uses `pnpm deploy` rather than hand-copying node_modules: it resolves the
# workspace-protocol dependencies (@verdery/api-contracts,
# @verdery/geometry-contracts) into a self-contained directory containing only
# production dependencies, following each package's own `files` allowlist —
# so this Dockerfile does not need to know what those packages export.
#
# Build from the repository root:
#   docker build -f services/api/Dockerfile -t verdery-api .
#
# Source: implementation-plan.md work package P1-PLAT-03.

FROM node:24-slim AS base
RUN corepack enable

FROM base AS workspace
WORKDIR /workspace

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/api-contracts/package.json packages/api-contracts/package.json
COPY packages/geometry-contracts/package.json packages/geometry-contracts/package.json
COPY packages/test-fixtures/package.json packages/test-fixtures/package.json
COPY apps/web/package.json apps/web/package.json
COPY services/api/package.json services/api/package.json
COPY services/workers/package.json services/workers/package.json
RUN pnpm install --frozen-lockfile

COPY packages/api-contracts packages/api-contracts
COPY packages/geometry-contracts packages/geometry-contracts
COPY services/api services/api

RUN pnpm --filter @verdery/api-contracts build
RUN pnpm --filter @verdery/geometry-contracts build
RUN pnpm --filter @verdery/api build

# --legacy: pnpm 10 defaults to requiring `inject-workspace-packages=true` in
# .npmrc for `pnpm deploy`, which hard-links workspace packages instead of
# resolving them from the store. --legacy keeps the simpler pre-v10 behavior,
# which is sufficient here since this Dockerfile does not otherwise use
# injected workspace packages.
RUN pnpm --filter @verdery/api deploy --prod --legacy /prod/api

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=workspace /prod/api ./

USER node
EXPOSE 8080
CMD ["node", "--import", "./dist/telemetry-bootstrap.js", "dist/main.js"]
