# syntax=docker/dockerfile:1.7

# Builds the web client as a self-contained Next.js standalone server.
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t verdery-web \
#     --build-arg NEXT_PUBLIC_API_ORIGIN=... \
#     --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=... (etc.) .
#
# Every NEXT_PUBLIC_* value is BAKED INTO THE BUNDLE at build time — that is
# what the prefix means — so they arrive as build args, not runtime env vars.
# None of them are secrets (see apps/web/.env.example's own reasoning); a
# rebuilt image is the only way to change them, which deploy-web.sh makes a
# one-command operation.

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
COPY apps/web apps/web

ARG NEXT_PUBLIC_API_ORIGIN
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY

RUN pnpm --filter @verdery/api-contracts build
RUN pnpm --filter @verdery/geometry-contracts build
RUN pnpm --filter @verdery/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The standalone output keeps the monorepo shape: server.js lives under
# apps/web inside the traced bundle.
COPY --from=workspace /workspace/apps/web/.next/standalone ./
COPY --from=workspace /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=workspace /workspace/apps/web/public ./apps/web/public

USER node
EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
