# Verdery Web Application

Next.js App Router shell for the Verdery web client. This package currently delivers the
foundation described by work package `P1-WEB-01`: application shell, localization framework,
design-system foundation, route and error boundaries, and the typed API gateway. Product features
arrive from Phase 2 onwards.

## Local Setup

1. Use the Node.js version pinned in `.nvmrc` (see `docs/architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md`).
2. Install workspace dependencies from the repository root with `pnpm install`.
3. Copy `.env.example` to `.env.local` and point `NEXT_PUBLIC_API_ORIGIN` at a running API.
4. Start the development server with `pnpm --filter @verdery/web dev`.

Open `/status` to confirm the shell reaches the API: the page calls `/v1/health/live` and
`/v1/health/ready` through the typed gateway and renders both healthy and unreachable outcomes.

## Commands

| Command                                | Purpose                                        |
| -------------------------------------- | ---------------------------------------------- |
| `pnpm --filter @verdery/web dev`       | Development server                             |
| `pnpm --filter @verdery/web build`     | Production build                               |
| `pnpm --filter @verdery/web typecheck` | TypeScript, strict, no emit                    |
| `pnpm --filter @verdery/web test`      | Vitest unit and Testing Library component runs |

## Structure

| Directory              | Contents                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| `app/`                 | Routes, layouts, and route-local components                                |
| `core/api/`            | Hand-written gateways over the generated contract types                    |
| `shared/localization/` | Locale negotiation, typed message catalogues, and the translation provider |
| `shared/ui/`           | Design tokens and domain-neutral primitives                                |

Feature folders (`features/gardens`, `features/map-editor`, and the rest) are introduced by the
phase that first needs them, following `docs/architecture/web-application-design.md` section 5.

## Rules That Apply Here

- Generated API clients are wrapped by hand-written gateways and never edited or called directly.
- Components never construct endpoint URLs or transport payloads.
- Shared UI stays domain neutral and does not import product features.
- Server-only modules (`shared/localization/server.ts`) are never imported by a client component.
- Expected API errors are typed feature state; error boundaries are for unexpected defects only.
