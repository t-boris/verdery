# Lessons

Patterns extracted from owner feedback, so the same mistake is not repeated.

## 2026-07-25 — "выглядит очень примитивно" (deployed web app)

**What happened**: Seven phases shipped web features with bare-bones styling and no
deliberate design pass. The first time the owner opened the deployed product, the
functional depth was invisible behind a primitive-looking surface.

**Rules for next time**:

- Function-complete is not ship-complete. Schedule an explicit visual design pass
  before anything is presented as "deployed and visible" — the first impression of a
  deployed URL is visual, not architectural.
- Build the design system (tokens, component states, chrome, empty/loading states)
  alongside the first UI work package, not after phase seven. Retrofitting is cheap
  only if components already draw every value from tokens.
- When restyling an existing suite-covered UI: keep roles, accessible names, and
  visible copy stable; restructure markup freely underneath. This pass changed the
  entire look, moved navigation into the shell, and required zero test-assertion
  changes because every selector was role/label/text-based — preserve that property
  in future tests too (no class-based selectors).
- Navigation chrome must never use list markup (`<ul>/<li>`): end-to-end assertions
  count `listitem` roles on pages, and chrome must not leak into content queries.

## 2026-08-01 — invented a work-package identifier (self-caught, post-push)

**What happened**: The candidate-photo feature was written with `Source:
implementation-plan.md work package P11-CAND-PHOTO-01` in 13 places, including two
operation descriptions in the OpenAPI contract. No such work package exists —
it was invented to label the increment. Caught only during the docs-sync check
after the commit was already pushed, requiring a second corrective commit.

**Rules for next time**:

- This repository's comments carry `Source: implementation-plan.md work package X`
  as a load-bearing convention. Never write one of those lines without first
  confirming `X` is a real row: `grep -c "| X " docs/implementation-plan.md`.
- New work usually belongs to an EXISTING package whose stated scope already
  covers it — read the package's scope text before concluding otherwise. Here the
  scope was already covered by P11-API-01 ("candidate ... media-association ...
  APIs") and P11-WEB-01 ("catalog/add/unknown flows").
- Adding a row to the plan of record is a bigger, owner-facing decision than
  labelling work under a package that already covers it. Prefer the latter; raise
  the former rather than doing it silently.
- Run the docs-sync obligation (repository rule: keep `docs/` accurate and
  synchronized in the SAME task) BEFORE committing, not after pushing.

## 2026-08-01 — ran a narrower check than CI runs

**What happened**: The Kern design pass added `shared/ui/fonts/NOTICE.md`. Local
verification ran `prettier --check "apps/web/**/*.{ts,tsx,css}"` — a glob chosen to
match the files being edited — while CI runs `pnpm format:check`, which is
`prettier --check .` across every extension. The markdown file was never checked
locally and failed CI on column padding alone.

**Rules for next time**:

- Verify with the SCRIPT CI runs, never a hand-written approximation of it. Read
  `.github/workflows/ci.yml`, then run those exact package scripts:
  `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `node scripts/check-file-size.mjs`.
- A hand-rolled glob encodes an assumption about which file types a change
  touched. Adding one file of a new type silently escapes it.
- When untracked tooling directories make a repo-wide check noisy, filter to
  tracked files (`git ls-files`) rather than narrowing the file types — the
  extension list is the part that must stay complete.

## Re-run the size gate after editing, not before

`check-file-size.mjs` was run before adding a comment to `services/api/src/app.ts`
and not after. The comment took the file from 596 to 610 lines and CI failed.

This is the same shape as the earlier Prettier lesson: a gate was run against
the wrong moment rather than the wrong file set. Running a gate before the edit
proves nothing about the edit.

**Rule:** run every CI gate as the last step before `git commit`, after all edits
are final — never mid-task. For this repo that is `pnpm typecheck`, `pnpm lint`,
`prettier --check` over tracked files, and `node scripts/check-file-size.mjs`.

**Second rule, from the same failure:** a file already within ~20 lines of the
600 limit is over the limit the repo actually states, which is "split before
exceeding". Split it instead of shrinking a comment to fit — shrinking hides
that the file needed splitting and guarantees the next edit fails the same way.

## A wrong option name can type-check and do nothing

`GoogleApiSweepTrigger` posted with no body, so every internal sweep failed
with 400 and had never once succeeded. The fix set `body: {}`; it deployed and
changed nothing. The client is gaxios, which serializes `data` — but its
options extend fetch's `RequestInit`, where `body` exists, so the wrong name
passed typecheck and was ignored at runtime.

Typecheck, lint and the full unit suite passed on the broken version, because
nothing reaches that class: it constructs its own `GoogleAuth`, so the single
request it makes is unreachable from a test. The only signal that told the two
versions apart was the deployed status code.

**Rule:** when a fix changes what goes over the wire, "types compile and tests
pass" is not evidence it works. Name the observable that would differ — a
status code, a log line, a row — and go look at it after deploying.

**Rule:** before adopting an unfamiliar option on a third-party client, read
that client's own type for the field. `RequestInit` inheritance in particular
makes plausible-but-inert options type-check.

**Second-order:** three separate faults this session shipped through a code
path no test could reach. A class that news up its own transport or auth
client is not merely hard to test; it is where this kind of bug survives.

## The 600-line rule was enforced only where the script could see it

The owner asked why `openapi.yaml` was fourteen thousand lines. The file-size
gate reads a fixed list of source extensions — `.ts`, `.tsx`, `.swift`, and a
few more — so the contract, the single most-read and most-edited artefact in
the repository, was exempt by accident rather than by decision. Nobody chose
that; it simply never came up, and the file grew a phase at a time.

**Rule:** a limit that exists to keep changes reviewable applies to whatever is
actually reviewed, not to whatever the linter happens to parse. When a
hand-edited file is exempt from a rule, say so on purpose or fix it.

## A constraint the UI does not know about becomes a 500

The measurement field shipped in this same session let a reader add two
measurements of one kind. `observation_measurement` has
`UNIQUE (observation_id, kind)`, so the insert reached that constraint inside
the transaction, `runIdempotentCommand` caught the unique violation, found no
idempotency replay, and rethrew — a client mistake reported as a server fault.
That handler's own comment asserted the idempotency key was the only unique
constraint reachable from it; true when written, false since the migration
that added this one.

**Rule:** after adding a UNIQUE constraint, name every request shape that can
now violate it and refuse those at the transport boundary. A database
constraint is a last line, not an error message.

**Rule:** a comment that enumerates "the only X that can happen here" is a
claim with an expiry date. When adding an X, grep for comments that said there
were none.

## A local Swift test run can pass against a module CI will not compile

CI's Swift job failed on `FakeCandidatePlantGateway`, which stopped conforming
to `PlantGateway` when the previous session added `filters:` to
`searchPlants`. Locally `swift test` reported 1036 passing tests immediately
before the push. SwiftPM had not recompiled `FeatureCandidatesTests` — that
target's own sources had not changed, and the incremental build did not react
to the protocol change in a module it depends on. The same staleness showed up
twice earlier in the session as undefined-symbol link errors, each time after
adding a defaulted parameter, and each time cleared by deleting one target's
build directory.

**Rule:** before pushing Swift changes that alter a protocol, a public
initializer, or anything else a test target implements, run `swift package
clean` and build once from scratch. An incremental green run is not evidence
that CI will compile the same code.

**Rule:** when a link error names a symbol whose signature you just changed,
the build is stale — do not go looking for a second definition.

## Thirty rollback tests encode a migration count, in three different shapes

Adding one migration turned seventeen migration suites red in CI. Each
rollback test unwinds "every migration newer than mine, then mine", and each
hardcodes that depth. I found four of them by grepping `migrate('down', N)`,
bumped those, and shipped — the other twenty-six use
`migrate(databaseUrl, 'down', N)` or a bare `count: N` inside a `runner({...})`
call, and none of them was in that grep's output.

**Rule:** when a repository fact is duplicated across dozens of files, one
grep pattern matching some of them is not evidence you found them all. Count
the hits against the number of files that should have one.

**Fixed:** the depth is derivable — it is the number of migration files at or
after the one under test. `tests/support/migration-rollback-depth.ts` computes
it, and all thirty tests now call `rollbackDepthTo('<migration-slug>')`. Adding
a migration no longer touches a single test file. Do not reintroduce a literal
depth.

## A test that counts microtasks fails on someone else's machine

`media-upload-controller.recovery.test.ts` flushed a fixed number of zero-delay
timer advances and then asserted the upload had started. Adding a checksum
computation put one more `await` between the pick and the upload; I added one
more flush, it passed locally, and CI failed anyway — the digest resolved a
tick later there.

**Rule:** wait for the state the test is about, not for a number of ticks. A
bounded loop that stops as soon as the condition holds passes on any machine
and still fails fast when the condition never arrives.

**Rule:** a comment admitting a test depends on an implementation detail
("the count tracks how many awaits stand between…") is a defect report against
that test. Fix it then, not after CI does.

## A new column breaks the migration test that enumerates its table

Adding `media_record.perceptual_hash` turned CI red on
`media-lifecycle-and-quotas.test.ts`, which asserts the table's ENTIRE column
list. I had run the new migration's own test, the media module, and the HTTP
suite — none of which enumerate columns — and concluded the change was
verified.

The enumerating assertion is not an obstacle; it is the point. It exists so a
column cannot arrive unnoticed, and it did its job.

**Rule:** after adding a column, run the test suite for the migration that
CREATED that table, not only the one for the migration that added the column.
`grep -rln "<table_name>" services/api/tests/migrations` finds it in one step.

**Rule:** the same applies to formatting. I ran `prettier --write` over the
globs I remembered touching, and missed a file edited early in the session.
`pnpm format:check` takes seconds and covers the repository — run it before
pushing, not the per-directory globs.

