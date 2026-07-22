# Verdery Workers

Independently deployed workers for media verification, derivatives, and scheduled processing.

Phase 1 delivers the deployment unit only: an entry point, validated configuration, structured
logging, and tests. No jobs are registered yet.

A worker has its own composition root, service identity, configuration, health behavior, and
deployment. It shares versioned contract packages with the API but never imports the running API
application. See
[backend-modular-monolith.md](../../docs/architecture/backend-modular-monolith.md), section
"19. Worker Boundary".

## Environment

| Variable              | Required | Default             | Meaning                                    |
| --------------------- | -------- | ------------------- | ------------------------------------------ |
| `VERDERY_ENVIRONMENT` | yes      | —                   | `development`, `staging`, or `production`  |
| `SERVICE_VERSION`     | no       | `0.0.0-development` | Build version reported in every log record |
| `LOG_LEVEL`           | no       | `info`              | pino level                                 |

## Commands

```sh
pnpm --filter @verdery/workers build
pnpm --filter @verdery/workers test
```
