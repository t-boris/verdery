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

## An ADR saying "none yet" is a snapshot, not the schema

I wrote a migration creating `integrations.plant_media_asset` because ADR-0016
section 3 lists it as "none yet — new table". The table already existed,
created three migrations earlier by `plant-taxon-knowledge-profile.sql`, and
the first run of the new migration test said so in one line: `relation
"plant_media_asset" already exists`.

The existing table is also better than the one I wrote. It stores EVERY
licence a source claims, including the unusable ones, with an
`ingestion_state` of `discovered`/`rejected`/`ingested` — and its header
explains the reasoning I had missed: presentation eligibility is an
application-layer decision that should evolve without a migration each time a
licence category's standing changes. My version had baked the allowlist into
a CHECK constraint, which would have made every future policy change a schema
change, and would have thrown away the fact that a rejected image exists.

**Rule:** before writing a migration that creates a table, grep the migrations
directory for the table name. An ADR's disposition column records what was
true when it was written.

**Rule:** the same applies to the rule the code is meant to enforce. The
commercial-media allowlist I was about to invent is already stated verbatim in
`architecture/plant-intelligence-and-visual-journal.md` section 7, including
the CC-BY-SA carve-out I would have missed. Search the design docs for the
policy before designing it.

## I wrote a second home for a rule that already had one — twice in one hour

After the `plant_media_asset` TABLE turned out to already exist, I wrote
`plant-media-licence.ts` holding the commercial-media allowlist. The allowlist
was already implemented, in `domain/plant-media-asset.ts`, as
`isLicenseEligibleForPresentation` — same three licences, same CC-BY-SA
carve-out, same reasoning in the comment. I committed the duplicate.

Then, reaching for the next piece, I ran `cat > plant-media-asset.ts` and
overwrote that existing module outright. Only the typechecker's complaint
about a missing export revealed it; `git checkout` restored it.

Both mistakes have one cause: I searched for the THING I was about to build
(a table named `plant_media_asset`) but not for the RULE it would enforce, and
then wrote files without checking whether the path was occupied.

**Rule:** before adding a domain rule, grep for its vocabulary, not its
filename — `grep -rn "cc_by\|allowlist\|eligib" <module>/domain`. A rule with
a home already has tests, and duplicating it means two answers to one
question.

**Rule:** never create a file with `cat >` or `Write` without confirming the
path is free. `ls` the directory first. An overwrite leaves no trace in the
editor and only fails later, somewhere else.

## A comment claiming a rule is not the rule

`error-message.ts` says an untranslated server code is "a visible omission
instead of a silent fallback to English". Nothing checked it. The owner hit
the consequence on the deployed site: requesting a garden deletion answered
"The request failed for an unrecognized reason", when the server had in fact
replied `deletion.recent_authentication_required` with a plain sentence
telling them to sign in again.

Writing the test the comment described found fourteen more unmapped codes
across media, notifications and exports — every one of which would have shown
the same non-answer.

**Rule:** when a module's doc comment states an invariant, write the test that
holds it. An unenforced invariant decays silently, and the failure surfaces to
a user rather than to CI.

**Rule:** for a report of "it failed with no reason", check the SERVER's
answer before the server's behaviour. A 403 carrying a specific code is a
client presentation defect, not a backend fault — and the correlation
identifier the UI already shows is enough to find it in one query.

## The stale-build trap, hit a second time in the same session

`swift build --build-tests` reported success while `FakePlantGateway` did not
implement a protocol method I had just added. `swift test` then died with
signal 6 rather than a compile error. `swift package clean` produced the real
message in one line: `type 'FakePlantGateway' does not conform to protocol
'PlantGateway'`.

This is the lesson recorded earlier in this same file, met again. What is new
is the SHAPE of the symptom: not a link error naming a symbol, but a test
process aborting with a signal and no failing test named.

**Rule:** a Swift test run that dies with a signal instead of reporting a
failed test is a stale build until proven otherwise. `swift package clean`
first; do not go looking for the crashing test.

**Rule (earned, not lost):** the repository's own accessibility test rejected
a fixed `.frame(width:height:)` on the new image card, and it was right — a
picture pinned to fixed points shrinks against everything else as the reader
scales type up. Reach for `@ScaledMetric` when a view needs a dimension, not
after a test objects.

## Fake timers fake `setImmediate` too

Fixing a flake in `media-upload-controller.recovery.test.ts`, I made the wait
helper yield a "real macrotask" with `setImmediate`. `vi.useFakeTimers()`
fakes that as well, so the wait never returned and the test hit its own
five-second timeout — a worse failure than the flake, and one I briefly read
as a defect in the controller.

**Rule:** under fake timers, the ONLY yield that advances anything is the
timer mock's own (`vi.advanceTimersByTimeAsync`). Reaching for `setImmediate`,
`setTimeout`, or any other scheduler assumes it escaped the mock; check
`toFake` before assuming that.

**Rule:** a bounded wait must THROW on exhaustion, naming what it observed.
The original helper returned silently after twenty flushes, so the failure
surfaced as an assertion about the wrong phase — which reads as a product bug
and sends you looking in the wrong place.

## A limit the provider owns is a decision the caller has to make

Species identification sent Vertex AI whatever the phone produced. A 30.79 MiB
original came back as a bare `400 INVALID_ARGUMENT`, which the use case mapped
to `providerFailed`, and the person read as "no species found" on a plant with
no picture. Three separate mistakes wearing one symptom: analysing the original
when a smaller derivative of the same picture existed, spending quota on a call
whose failure was knowable in advance, and a UI promising identification while
creating the record before anything could be identified.

**Rule:** when an adapter has a documented input limit, the limit belongs above
the adapter — in the contract package, so both sides use one number — and the
caller refuses before the call rather than translating the provider's refusal
afterwards. `providerFailed` means the provider broke; a photo that is too big
is not a broken provider, and only one of those has a remedy a person can act on.

**Rule:** a test fixture that forces a row into a state the real command never
produces (here: `upload_state = 'available'` with no bucket or object key) hides
exactly the defect the code should refuse. The old code carried it with an
`as string` cast; the cast was the tell.

## `display: none` deletes a label from the accessibility tree

The garden rail collapses to icons on a phone, and the labels were hidden with
`display: none` — which removes them for screen readers too, leaving six links
announced as nothing. The E2E test that would have caught it had been silently
skipped for weeks: an earlier failure in the same serial block took it with it,
and a skipped test reads as a passing one in the summary line.

**Rule:** hiding a control's text visually is `clip-path`, never `display: none`.
If the name should be gone visually but present to assistive technology, the
project already has `visually-hidden.module.css`; copy its declarations when
`composes` cannot cross a media query.

**Rule:** read the skip count, not just the failure count. `1 failed, 6 skipped`
means seven tests told you nothing.

## A probe in a hidden tab measures nothing

Diagnosing a blank map backdrop, I drove MapLibre through an automated Chrome
tab and concluded that a map created at the editor's zoom never loads its
tiles. Two things were wrong with the setup, not the product: the tab was
hidden, so `requestAnimationFrame` never fired and the render loop never ran;
and the probe page loaded MapLibre's ESM build without its worker file, so no
tile could ever parse. Screenshots seemed to confirm the theory, because
taking one forces a frame — enough to paint sometimes, not enough to load.

**Rule:** before believing any browser measurement, assert the conditions the
measurement depends on. `document.hidden`, an rAF tick count, and the absence
of console errors are three lines of code and they invalidate or confirm the
whole session.

**Rule:** a claim that survives into a plan has to be re-measured in the
environment it will be fixed in. The real defect had a completely different
shape — vector tiles stop rendering six zoom levels past their source — and
only appeared once the harness was honest.

## Ask the provider what it holds

The repository stated NAIP imagery as "roughly 0.6–1 m per pixel", and I
carried that number into a plan, a user-facing note, and a magnification
calculation. The service publishes `pixelSizeX` on its own metadata endpoint:
0.30 m. Half of what we told people, and the difference decided both the zoom
cap and the default camera.

**Rule:** when a provider can be asked, ask it, and record the answer with the
date and the endpoint. An estimate written in prose becomes a constant, then a
product decision, and nothing in between ever re-checks it.

## Hooks after an early return

The redesigned editor crashed every route with "Something went wrong" because
`useState`/`useEffect` for the new drawer landed below `if (isLoadingError)
return`. Unit tests passed — they never render the failed-query branch — and
E2E caught it on the very first navigation.

**Rule:** new hooks go at the top of the component with the others, before any
conditional return, always. When adding state to a component that already has
early returns, place the hook first and the usage later, not both together
where the usage happens to read well.

## 2026-08-07 — three migrations collided with a parallel branch, and only the deploy noticed

**What happened**: I picked migration timestamps by incrementing from the highest
one on `master` when I started. A parallel branch did exactly the same, so both
produced `1789100000000`, `1789200000000` and `1789300000000`. Rebasing merged
both sets with no conflict — the filenames differ. Every local gate passed: the
migration suites apply the whole directory from scratch, which succeeds whatever
the numbering is.

It failed on the deployed database, where the other branch's migrations had
already run. `node-pg-migrate` refused the entire run — "Not run migration
`1789100000000_weather-precipitation-interval` is preceding already run migration
`1789200000000_tree-area-geometry`" — so the deploy died after CI was green, and
the API never got the new image.

**Rules for next time**:

- Pick a migration timestamp from `origin/master` AT THE MOMENT OF COMMIT, not
  from the checkout you started with. On a repository with parallel work, "highest
  - 1" computed hours earlier is a guess about what nobody else did.
- Re-check after every rebase: `ls services/api/migrations | tail`. A rebase that
  reports no conflict has still merged two independently-numbered sets, and a
  duplicate timestamp is invisible in the diff.
- "All tests pass" does not mean "this deploys". A suite that applies migrations
  from scratch cannot see an ordering problem, because ordering only matters
  against a database that already ran some of them. When adding a migration, ask
  what the DEPLOYED database will do, not what a fresh container does.
- The guard now exists: `tests/migrations/migration-ordering.test.ts` fails on a
  duplicate timestamp, needs no database, and runs on every push. It was verified
  by breaking it.
- Renaming a migration is safe only while it has not been applied anywhere. Check
  before renaming; here the deploy had refused the whole batch, so none had run.

## A multi-line regex is not a refactoring tool

**What happened**: adding one argument to two SwiftUI sheet initializers, I used
`re.sub` on a pattern ending `onClose: \{[^}]*\}` with the replacement text
written out literally — including the body `{ model.editingTask = nil }` copied
from the first call site. The pattern matched **three** call sites, not two, and
the replacement overwrote all three bodies with the first one's. `TasksListView`
then closed the reschedule sheet by clearing `editingTaskId`, and the assign
sheet by clearing it too. It compiled. Every one of 1173 tests passed, because
no test drives a sheet's dismissal.

**Why it was nearly invisible**: the diff was three lines that all looked like
plausible code, in a file with three near-identical blocks. Reading the patch
without reading the _original_ would not have caught it.

**Rules for next time**:

- Never let a regex replacement carry a literal body copied out of one match. If
  the replacement needs part of the match, capture it (`\1`) — if it cannot be
  captured, the edit is not a regex edit.
- `count=1` on `re.sub` is not a safety net when there are several call sites;
  it just picks an arbitrary one. Prefer N exact `str.replace(old, new, 1)` calls
  with enough surrounding context that each is unique.
- After any pattern-based edit, run `git diff <file>` and read the **minus**
  lines, not just the plus lines. What was deleted is where this class of bug
  lives, and here `git diff | grep '^[-+].*onClose'` showed it in one line.
- A green suite says nothing about view wiring. This repository tests values and
  conventions, deliberately and by ADR — so callbacks, dismissals and navigation
  are exactly the code a test run cannot vouch for, and exactly where a careless
  edit survives.

## Verifying a change against `src/` only is not verifying it

**What happened**: the per-garden seasonal-acceptance change was checked with
`npx vitest run src/`, which is green over the module's own unit tests. Three
suites under `tests/` — HTTP, DST, and integration — broke on the same change
and were found by CI instead. The local run was a narrower command than the one
that gates the branch, chosen because it matched the directory being edited.

**Rules for next time**:

- Run the script CI runs. `pnpm --filter @verdery/api test` covers `src/` **and**
  `tests/`; `npx vitest run src/` covers half the suite and reports success in
  the same words. This repeats the 2026-08-01 lesson above about
  `prettier --check` on a hand-written glob — same mistake, different tool, so
  the general rule is: never verify with a command whose scope you chose.
- In this codebase the `tests/` tree is where behaviour that crosses a boundary
  lives — transport shapes, authorization outcomes, real SQL, DST arithmetic. A
  change to an application service almost always has a consequence there, and
  those are the consequences worth catching.

## The wire shape of a route with no client is untested by construction

**What happened**: `GET /gardens/{id}/seasonal-facts/awaiting-acceptance` and its
accept were shipped, deployed, and described in a handoff as "the server side is
complete". Both were covered at the use-case level and neither had ever been
called over HTTP. Writing the first client found, in the first run of the first
test, that `POST .../seasonal-facts/{factId}/accept` rejected **every** real fact
id with `400`: the path validated `factId` against the version-7 `UUID_PATTERN`,
while `taxonomy_seasonal_fact` rows are seeded with `gen_random_uuid()` —
version 4. The same pattern was applied to `taxonomyReferenceId`, so no plant
could be attached to a catalog taxon either. Neither could ever have worked from
any client, and no test said so.

**Rules for next time**:

- A route without a client is not "complete", it is "unobserved". Either write
  the HTTP-level test with the route, or say in the handoff that its wire
  behaviour is unverified — those are the two honest options, and "the server
  side is done" is neither.
- Test fixtures must mint ids the way PRODUCTION mints them. Seeding a v7 id in
  a test for a table whose rows are v4 makes the suite agree with the code and
  both disagree with the database.
- A UUID's version is a property of who minted it. Requiring v7 is right for an
  id a client supplies or `generateUuidV7()` produces; it is wrong for a shared
  catalog id the server handed out and the client is only handing back.

## 2026-08-07 — "почему температура не доступна" (weather panel)

**What happened**: the panel showed rainfall and "no measurement" for temperature,
humidity and wind. The provider was fine — a direct call returned all four. The
defect was that one method answered two different questions.

`WeatherRecordRepository.findLatest` was written for the CACHE decision, and its
own doc comment said so: "Retrieval order, not effective order". The display path
reused it. But one provider response stores a point reading and one rain-only
total per elapsed day, all in one batch with identical `fetched_at` and
`created_at` — so the ordering fell through to `id DESC`, UUIDv7 ids ascend in
build order, and the largest id was always the last daily total. The panel was
handed a rainfall row and rendered its nulls honestly.

**Rules for next time**:

- **When a method's doc says what it is FOR, check that every caller wants that.**
  The comment was accurate and had been accurate for months; the second caller
  simply wanted a different thing and took the nearest method.
- **A tie-break is a decision, not a fallback.** `id DESC` looked like an
  arbitrary tiebreaker for an unlikely collision. It was in fact the deciding
  key for every read, because the rows it compared were always written together.
  If ties are the normal case, the ordering above them is not doing any work.
- **Two shapes in one table need two reads or a column that tells them apart.**
  `record_kind` has two values and cannot express "instant" versus "period";
  rather than widen it, the read that needs the distinction orders by the
  property that already encodes it (`effective_at`).
- **The same confusion usually has a second instance.** The forecast read had it
  too, mirrored: retrieval order handed back the FURTHEST day, so the panel
  announced a forecast six days out. Having found the pattern once, the honest
  next step was to look for it again rather than declare the bug fixed.
- **An ordering fix cannot conjure data that was never requested.** No forecast
  row carried temperature at all, because only `precipitation_sum` was ever
  asked for. Diagnosing the ordering and stopping there would have shipped a
  panel that still said "Not reported" under three fields out of four — right
  row, same emptiness. Check that the fix reaches the symptom the person
  reported, not just the defect you found on the way.

## 2026-08-07 — "map and diagram не синхронизированны" (iOS basemap, two defects)

**What happened**: a handoff (`tasks/ios-next-session.md`) named two defects
found by running the app. Running it again found that one diagnosis was wrong,
one was right for a reason it did not give, and a third defect sat between
them that nobody had named.

- **The span was passed as a camera distance.** `BasemapCamera.spanMetres` is
  how much ground the viewport covers; `MapCamera.distance` is how far the
  camera sits above it. A comment said taking one for the other was "close
  enough at a garden's scale". Measured through `MapProxy.camera(framing:)`, the
  factor is **1.866** — the photograph showed 54% of the ground it should, so
  everything drawn on it was nearly twice its true size.
- **The heading had the wrong sign.** `localPosition` puts local `+Y` at bearing
  `-θ`, and the camera was handed `+θ`. The error is `2θ`, which is exactly zero
  in an unrotated garden — the only kind any test or screenshot used. The web
  editor had the correct line, with a comment saying so, the whole time.
- **The clipped control row was a flexible `ScrollView`**, not the stack
  overflowing as the handoff guessed. `ScrollView(.horizontal)` is still
  flexible VERTICALLY, so it competed with the canvas for leftover height.

**Rules for next time**:

- **Ask the framework instead of assuming the framework agrees with you.** Both
  camera defects were a local quantity handed to an API that wanted a different
  one. MapKit publishes the conversion (`camera(framing:)`); the code guessed
  and left a comment excusing the guess. A comment admitting an approximation is
  a defect report nobody filed.
- **A property that vanishes at zero needs a fixture that is not zero.** Every
  basemap fixture and every screenshot used `rotationDegrees: 0`, where a sign
  error in the heading is invisible. The suite was not weak — it was blind in
  exactly one direction, and the round-trip test that "pins the projection"
  covered the centre and said nothing about which way up.
- **When two platforms implement one projection, read the other one.** The
  answer to the heading sign was one line of `basemap-provider.ts`, with a
  comment explaining it. Deriving it from first principles took far longer than
  looking.
- **A test's prose can contradict its own assertion.** `rotatedAxes` asserted
  west and its comment said east, and the wrong half was the half that was
  copied into the heading. Read the assertions, not the sentences above them.
- **Inherit a diagnosis, not a conclusion.** The handoff's second defect was
  real and its stated cause was not. Reproducing it first cost one screenshot;
  implementing the proposed fix would have cost a day and moved the rotation
  onto the canvas for nothing.
- **`CODE_SIGNING_ALLOWED=NO` strips entitlements.** The simulator build then
  has no `keychain-access-groups`, Firebase Auth cannot reach the keychain
  (`-34018`), and sign-in silently fails to persist — re-breaking, from the
  build command, the exact defect a previous session had fixed in
  `project.yml`. Build the simulator app signed ("Sign to Run Locally") whenever
  the run needs to be signed in.
