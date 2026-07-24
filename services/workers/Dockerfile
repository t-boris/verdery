# syntax=docker/dockerfile:1.7

# Builds the independently deployable relay and media-validation worker.
# Build from the repository root:
#   docker build -f services/workers/Dockerfile -t verdery-workers .

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
COPY services/workers services/workers

RUN pnpm --filter @verdery/api-contracts build
RUN pnpm --filter @verdery/geometry-contracts build
RUN pnpm --filter @verdery/workers build
RUN pnpm --filter @verdery/workers deploy --prod --legacy /prod/workers

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=workspace /prod/workers ./

USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
