# The API contract and generated clients

The contract source is the tree under `packages/api-contracts/openapi/`. Everything else —
`openapi.yaml`, TypeScript types, Swift types, request validation, documentation — is derived from
it. This document covers how to change it and how to keep the derived artefacts honest.

## The one rule

**Generated files are never edited by hand.** `packages/api-contracts/src/generated/schema.ts` and
`packages/api-contracts/openapi.yaml` are output, not source. Editing either produces something that
disagrees with the contract clients were built against, and CI rejects the result.

Source: [../architecture/api-design.md](../architecture/api-design.md), section
"3. Contract Ownership".

## Package layout

| Path                                     | Role                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `openapi/`                               | The contract. Hand-written and reviewed; see the next section for its shape.                              |
| `openapi.yaml`                           | The bundle built from `openapi/`. Committed, never edited.                                                |
| `redocly.yaml`                           | Lint rules applied to the contract.                                                                       |
| `src/generated/schema.ts`                | Generated types. Committed, never edited.                                                                 |
| `src/index.ts`                           | The package's public surface: stable type aliases, header constants, and the shared error-code catalogue. |
| `scripts/bundle-contract.mjs`            | Builds the bundle, and (with `--check`) the drift gate that keeps it honest.                              |
| `scripts/check-generated-is-current.mjs` | The drift gate for the generated client.                                                                  |

## The contract source tree

One 14,000-line YAML file made every change hard to review and hard to place. The same contract now
lives as:

| Path                                | Holds                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `openapi/root.yaml`                 | The document head — `info`, `servers`, `tags`, `security` — and an index of everything below. |
| `openapi/paths/<tag>/<path>.yaml`   | One path item per file, in a directory named for its tag.                                     |
| `openapi/components/schemas/*.yaml` | Schemas grouped by domain, in the order the contract already laid them out.                   |
| `openapi/components/*.yaml`         | Parameters, responses, headers, and security schemes.                                         |

`root.yaml` names every schema and every path explicitly, the same way `src/index.ts` re-exports
every type by name rather than star-exporting. Adding a schema therefore means two edits: the schema
in its group file, and one line in the index. That is deliberate — it keeps the bundle deterministic
and makes the contract's whole surface readable in one file. A schema defined in a group file but
missing from the index would silently not exist; `contract.test.ts` fails when that happens.

Comments explaining a schema live beside the schema, in the tree. The bundler cannot carry them into
`openapi.yaml`, which is one more reason that file is not where you read or edit the contract.

`src/index.ts` exists because OpenAPI cannot express everything a client needs. Error codes,
`API_BASE_PATH`, `IDEMPOTENCY_KEY_HEADER`, and `IF_MATCH_HEADER` are hand-written there and are the
names the rest of the repository imports — consumers import from `@verdery/api-contracts`, never
from `@verdery/api-contracts/src/generated/...`.

## Changing the contract

```bash
# 1. Edit the contract source, and its index when adding or removing a name.
$EDITOR packages/api-contracts/openapi/components/schemas/plants.yaml
$EDITOR packages/api-contracts/openapi/root.yaml

# 2. Rebundle and regenerate the client. `generate` bundles first.
pnpm --filter @verdery/api-contracts generate

# 3. Lint the contract.
pnpm --filter @verdery/api-contracts lint:contract

# 4. Confirm the committed bundle and client now match their sources.
pnpm --filter @verdery/api-contracts bundle:check
pnpm --filter @verdery/api-contracts generate:check

# 5. Rebuild consumers, because their types just changed.
pnpm build && pnpm typecheck && pnpm test
```

Commit the source tree, the rebundled `openapi.yaml`, and the regenerated `src/generated/schema.ts`
in the same change. A commit that contains one without the others fails a drift gate.

## Conventions the contract already fixes

These are established and should not be re-litigated per endpoint:

- Paths are plural lowercase nouns; JSON fields are `camelCase`.
- The base path is `/v1`. A breaking change needs a new major path, not a new field meaning.
- Identifiers are opaque UUIDv7 strings generated by the client.
- Timestamps are RFC 3339 in UTC.
- Measurements are SI, with explicit unit metadata wherever a value would otherwise be ambiguous.
- Errors use one envelope, and shared codes come from `SharedErrorCode`. Module-specific codes live
  with their module.
- Geometry always travels inside an envelope that names its coordinate space, because GeoJSON alone
  cannot say whether coordinates are local metres or longitude and latitude.
- Retryable mutations carry `Idempotency-Key`; revision-sensitive operations carry `If-Match`.

Source: [../architecture/api-design.md](../architecture/api-design.md);
[ADR-0005](../architecture/decisions/ADR-0005-dual-space-geospatial-model.md).

## The lint rules, and the two that are disabled

`redocly.yaml` extends the `recommended` ruleset and raises operation identifiers, summaries,
security definitions, tag descriptions, and licence information to errors. Two rules are switched
off on purpose, each with the reason recorded in the file:

- `no-unused-components` — the contract intentionally defines shared pagination and geometry
  components before later map and collection operations consume every component.
- `operation-4xx-response` — every 4xx is described once in `components.responses` and referenced,
  rather than re-enumerated inline on every path.

If you re-enable either rule, remove the comment that explains why it was off.

## How the drift gates work

There are two, and they run in order.

`bundle:check` re-bundles the source tree into a temporary file and compares it byte-for-byte with
the committed `openapi.yaml`. A difference means the tree changed and nobody rebundled, or somebody
edited the bundle by hand.

`generate:check` regenerates the client into a temporary directory from the committed
`openapi.yaml` and compares it byte-for-byte with `src/generated/schema.ts`. A difference means the
contract changed and nobody regenerated, so clients are being built against a stale shape — or
somebody edited the generated file directly.

Both failure messages name the command that fixes them.

The bundle check runs first because the client check reads the committed bundle: a stale bundle
would otherwise be verified against itself and pass. Both run in their own CI job, before anything
builds the contract package — `pnpm --filter @verdery/api-contracts build` runs `generate` as its
first step and would silently repair the drift the gates are supposed to catch.

## Swift and other runtimes

The Apple client consumes the same contract. Cross-runtime agreement on values rather than types is
proven by the shared fixtures in `packages/test-fixtures/fixtures`, which are language-neutral JSON
read by both the TypeScript and Swift suites — that is why a change to those fixtures triggers the
macOS CI job.

Source: [../architecture/testing-strategy.md](../architecture/testing-strategy.md), section
"4. Shared Test Assets"; [../implementation-plan.md](../implementation-plan.md), section 10.2, work
package `P1-CONTRACT-02`, "Fixtures consumed by at least two runtimes".
