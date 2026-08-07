# Verdery Web Application

Next.js App Router product surface for Verdery. Its Professional Field Console design provides a
persistent portfolio/workspace chassis, grouped garden navigation, dense bounded work panels,
full-height map tooling, responsive mobile navigation, localization, typed API gateways, and the
complete set of garden, plant, candidate, observation, task, planning, organization, publication,
and client-portal workflows.

The authenticated header reads the exact package version from this file's `package.json`. Every
application change bumps that patch version so a deployed build can be identified in the UI.

## Local Setup

1. Use the Node.js version pinned in `.nvmrc` (see `docs/architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md`).
2. Install workspace dependencies from the repository root with `pnpm install`.
3. Copy `.env.example` to `.env.local` and point `NEXT_PUBLIC_API_ORIGIN` at a running API.
4. Start the development server with `pnpm --filter @verdery/web dev`.

Open `/status` to confirm the shell reaches the API: the page calls `/v1/health/live` and
`/v1/health/ready` through the typed gateway and renders both healthy and unreachable outcomes.

## Commands

| Command                                | Purpose                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm --filter @verdery/web dev`       | Development server                                                                       |
| `pnpm --filter @verdery/web build`     | Production build                                                                         |
| `pnpm --filter @verdery/web typecheck` | TypeScript, strict, no emit                                                              |
| `pnpm --filter @verdery/web test`      | Vitest unit and Testing Library component runs                                           |
| `pnpm --filter @verdery/web test:e2e`  | Playwright specs in `e2e/` (needs a running API, web app, and Auth emulator — see below) |

## End-to-End Tests (Playwright)

`e2e/` holds the browser E2E suite for work package `P2-QA-01`: register via email magic link,
create the first garden, sign back in as the same user and see it again, sign out, Google sign-in
through the Firebase Auth emulator's fake IDP, and provider-outage behavior. Scope matches
`docs/architecture/testing-strategy.md` section 20, "Register and create first garden".

Real Google/Apple OAuth popups cannot be scripted in CI, so these specs run against the
[Firebase Local Emulator Suite's Auth emulator](https://firebase.google.com/docs/emulator-suite)
instead of real Firebase — see `core/auth/firebase-app.ts#getFirebaseAuth` for the
`NEXT_PUBLIC_USE_FIREBASE_EMULATOR` gate that points the client SDK at it, and
`services/api/src/main.ts` / `FIREBASE_AUTH_EMULATOR_HOST` for the same on the API side. Sign in
with Apple is out of scope: it is not implemented on any client yet.

Run the whole suite, including standing up a throwaway Postgres, the Auth emulator, the API, and
the web app, and tearing all four down again afterward:

```sh
apps/web/e2e/run-e2e.sh
```

See that script's header comment for exactly what it starts, on which ports, and why. It requires
Docker (for Postgres) and the Firebase CLI (`firebase --version`) on `PATH`.

If those four are already running yourself (for example while iterating on a spec), point
Playwright at them directly:

```sh
E2E_WEB_BASE_URL=http://localhost:3100 pnpm --filter @verdery/web test:e2e
```

**Known limitation:** the Google sign-in spec (`e2e/google-sign-in.spec.ts`) drives the Auth
emulator's own fake-IDP popup, which is third-party HTML this repository does not own. It is
therefore a smoke test only — it asserts that the button reaches a working session, not every
detail of that popup — and is the one spec most likely to need attention if the emulator's popup
markup changes in a future `firebase-tools` release.

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
