# Load harness

k6 scenarios for P8-LOAD-01. **The documentation for this directory is
[../../docs/development/load-testing.md](../../docs/development/load-testing.md)** — tool choice,
scenario derivations, how to obtain credentials, pass/fail thresholds, and what is blocked. This
file is only a map.

```
lib/config.mjs      target URL, load profile, small helpers
lib/auth.mjs        Firebase ID token pool (supplied from outside, never minted here)
lib/slo.mjs         thresholds, one constant per PROPOSED target in service-levels.md
scenarios/*.mjs     one file per named scenario
run.sh              wrapper: checks k6 is installed, refuses non-smoke runs against a remote target
```

| Scenario               | Work-package scenario | Safe against `verdery-dev`?               |
| ---------------------- | --------------------- | ----------------------------------------- |
| `smoke`                | harness self-test     | **Yes** — unauthenticated, read-only      |
| `interactive`          | interactive           | Smoke profile only                        |
| `sync-backlog`         | sync backlog          | Smoke profile only; writes                |
| `upload-burst`         | upload burst          | Smoke profile only; writes and stores     |
| `recommendation-batch` | recommendation batch  | Smoke profile only; writes; needs opt-in  |
| `provider-slowdown`    | provider slowdown     | Smoke profile only                        |
| `failover`             | failover              | Yes, but the disruption is the operator's |
| `cost`                 | cost                  | Smoke profile only; spends money          |

```bash
VERDERY_BASE_URL=https://verdery-api-dev-t6amsr5o6a-uc.a.run.app tests/load/run.sh smoke
```

Why this directory and not a workspace package: `pnpm-workspace.yaml` globs `apps/web`,
`services/*`, and `packages/*`, so `tests/` cannot be picked up by `pnpm -r build/test/typecheck`
— which is correct, because k6 scripts are executed by the k6 binary and are not TypeScript. The
scripts use the `.mjs` extension so the repository's ESLint configuration applies its existing
"outside the TypeScript projects" rules to them rather than failing to resolve them against a
tsconfig they are not in.
