# Verdery collaborative issue implementation plan

## Purpose and planning rules

This document turns every record in the collaborative issue registry into an ordered delivery
plan. The individual [GG issue records](README.md) remain the source of truth for observations,
scope, evidence, and acceptance criteria. If this plan and an issue record diverge, update the
issue analysis first and then synchronize this plan.

This is a relative-effort plan, not a calendar commitment:

- **S** — focused verification or a contained web change with no contract migration.
- **M** — one bounded feature spanning several components or test layers.
- **L** — coordinated web and API work, or a substantial interaction redesign.
- **XL** — lifecycle/data work with migrations, compatibility, operational rollout, or several
  independently risky surfaces.

No issue is considered complete merely because code exists. A `fixed` item still needs its stated
browser/device verification before it can advance to `verified`; an `analyzed` item advances only
after its own acceptance criteria are implemented and evidenced.

## Portfolio snapshot

| Issue                                                      | Current state and evidence                                                                                        | Planned outcome                                                                                | Effort | Epic |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ | ---- |
| [GG-0001](GG-0001-sign-in-composition.md)                  | `analyzed`; code supports poor focal composition and missing responsive sign-in coverage                          | Responsive authentication-specific composition with unauthenticated visual coverage            | M      | A    |
| [GG-0002](GG-0002-archive-first-permanent-deletion.md)     | `analyzed`; garden/account delay and inconsistent delete semantics are code-confirmed                             | Archive-first, separately confirmed irreversible deletion for explicitly approved entity scope | XL     | B    |
| [GG-0003](GG-0003-garden-details-empty-panel.md)           | `fixed` in web 0.6.2; targeted tests passed, Node 24/browser verification pending                                 | Verify compact intrinsic card and real metadata on supported viewports/locales                 | S      | 0    |
| [GG-0004](GG-0004-garden-environment-setup-flow.md)        | `analyzed`; six storage-shaped editors and domain limitations are confirmed                                       | Guided Growing environment setup plus an honest compact summary                                | XL     | C    |
| [GG-0005](GG-0005-map-workspace-and-inspector.md)          | `fixed` in web 0.6.3; component/type tests passed, browser verification pending                                   | Verify explicit tabs, width controls, long Russian rows, and preserved editor actions          | S      | 0/D  |
| [GG-0006](GG-0006-map-canvas-density-and-fit.md)           | `analyzed`; universal chips/control competition/combined Fit bounds confirmed, screenshot camera cause unresolved | Decluttered labels and explicit working versus complete Fit behavior                           | L      | D    |
| [GG-0007](GG-0007-today-weather-hierarchy-and-coverage.md) | `fixed` in web 0.6.4; unit/provider/view tests passed, browser verification pending                               | Verify weather hierarchy, missing/zero/stale states, and cookie unit restoration               | S      | 0/E  |
| [GG-0008](GG-0008-automatic-checks-claims.md)              | `analyzed`; all seven rules and readiness semantics audited                                                       | Truthful localized readiness/explanation surface with resolvable blockers and partial coverage | L      | E    |
| [GG-0009](GG-0009-plant-image-loading.md)                  | `analyzed`; per-image status-to-access waterfall and original downloads confirmed                                 | Derivative-aware, bounded/batched access with measurable request and transfer budgets          | L/XL   | F    |
| [GG-0010](GG-0010-observation-quick-capture.md)            | `analyzed`; storage-shaped controls, raw IDs, and downstream invariants confirmed                                 | One-prompt quick capture with named targets, direct symptoms, and progressive details          | L      | C    |

## Recommended order and dependencies

```text
Epic 0: baseline verification for GG-0003, GG-0005, GG-0007
  ├─> Epic A: sign-in redesign (independent)
  ├─> Epic D: map canvas completion, building on verified GG-0005
  ├─> Epic F: media performance (independent after contract choice)
  └─> Epic C1: environment setup
        ├─> Epic C2: observation quick capture (reuses named garden targets)
        └─> Epic E: Automatic Checks recovery links and partial-coverage truthfulness

Epic B: archive-first deletion runs as an isolated lifecycle/data program after product decisions
and worker readiness, not as a dependency of the other UX epics.
```

Recommended delivery sequence:

1. Establish a Node 24 test environment and verify the three fixed baselines before layering more
   behavior onto their screens.
2. Resolve the product/contract decisions listed below. Contract and migration choices must precede
   web implementation for GG-0002, GG-0004, GG-0008, GG-0009, and GG-0010.
3. Deliver GG-0001 and GG-0006 as bounded web improvements while the larger contracts are designed.
4. Implement GG-0004 before GG-0008 so Automatic Checks can link to a real seasonal/environment
   recovery flow rather than another storage-shaped section.
5. Implement the named plant/area target source and ownership validation before completing GG-0010.
6. Deliver GG-0009 behind measurable performance budgets; do not optimize only the visual loading
   state while retaining full-original transfers.
7. Deliver GG-0002 only after legacy-state, ownership, retention, and durable-worker decisions are
   approved. Roll out garden/candidate scope before any separately approved account or new entity
   scope.
8. Run cross-epic English/Russian, responsive, accessibility, authorization, offline, and deployed
   development verification, then advance individual records from `fixed` to `verified` based on
   their own evidence.

## Epic 0 — completed baselines and release verification

### GG-0003 — compact Garden Settings summary

**Current evidence.** The desktop grid now uses intrinsic-height alignment, and the summary uses
only name, lifecycle, role, `createdAt`, and `updatedAt`. Component, localization, type, lint, and
format checks passed under Node 22; the issue is `fixed`, not yet browser-verified.

**Remaining tasks (S).** No feature expansion is planned.

1. Run the existing `garden-settings.test.tsx`, localization suites, typecheck, lint, and file-size
   gate under the repository-required Node 24 runtime.
2. Verify active and archived gardens at desktop above 68rem and below the stacking breakpoint in
   English and Russian. Confirm the card ends after its own content and contains no invented metric.
3. Check long names, localized dates, owner/editor/viewer labels, zoom/reflow, keyboard navigation,
   and high-contrast/focus visibility.
4. Capture browser evidence in the issue and advance `fixed → verified`; no migration, flag, or
   backfill is needed.

**Affected code.** `apps/web/app/application/gardens/[gardenId]/page.module.css`,
`apps/web/features/gardens/garden-settings.tsx`, its CSS/tests, and localization messages.

**Risk.** A visual regression could reintroduce equal-height stretching without failing component
tests. Keep the intrinsic-height assertion in browser coverage.

### GG-0005 — Map inspector and object list

**Current evidence.** Web 0.6.3 removed collapse, added four explicit keyboard tabs and persistent
18–25rem width choices, and made object identity/actions readable. Nine targeted tests and web
typecheck passed; browser verification lacks an authenticated local API session.

**Remaining tasks (S).** No collapse behavior is to be added.

1. Under Node 24, rerun inspector layout/drawer/object-list tests and the complete map editor suite.
2. In an authenticated garden, verify desktop width persistence, absence of a collapse chevron,
   tab roving focus, and Backdrop padding/overflow.
3. Exercise long Russian names and every preserved action: selection, Shift multi-selection,
   visibility, object/layer lock, deletion, join, and Arrow Up/Down navigation.
4. Verify the overlay/sheet layout below 80rem, tablet and phone reflow, browser zoom, target size,
   accessible tab names, and screen-reader association between tabs and panels.
5. Record browser evidence and advance `fixed → verified`. GG-0006 remains open even if this passes.

**Affected code.** `map-editor.tsx`, `map-inspector-drawer.tsx`, `map-inspector-layout.ts`,
`map-object-list.tsx`, their CSS/tests, map localization, and map architecture documentation.

**Risk.** Treating GG-0005 verification as proof that the canvas is fixed would incorrectly close
GG-0006. Keep the scopes separate.

### GG-0007 — Today weather hierarchy and units

**Current evidence.** Web 0.6.4 separates current point conditions, nearest forecast, latest
precipitation interval, and completed-day rainfall; it preserves missing/zero/stale semantics and
server-restores a one-year °C/°F cookie. Complete/partial/provider/unit tests passed.

**Remaining tasks (S).** The current model must continue not to claim a garden-local current-day
total.

1. Run weather view, Open-Meteo mapping, rainfall deduplication, panel, and temperature-cookie tests
   under Node 24.
2. Verify complete, partial, zero, unavailable, stale, and year/day-boundary fixtures in English and
   Russian. Confirm icons have textual equivalents and do not carry meaning alone.
3. Switch units next to the temperature display, reload, navigate away/back, and server-render a
   subsequent visit. Confirm no hydration mismatch and no provider/source-unit mutation.
4. Inspect narrow and desktop hierarchy, chart labels, link/focus behavior, and contrast.
5. Record deployed browser evidence and advance `fixed → verified`. No migration, backfill, or flag
   is required for the existing fix.

**Affected code.** Today route, `features/weather/weather-panel*`, `temperature-unit*`, weather
icons/localization, Open-Meteo adapter, and weather read repository/view tests.

**Risk.** Later copy must not rename the latest provider interval to “today's total” without adding
garden/provider timezone and verified partial-day aggregation to the model.

## Epic A — authentication composition

### GG-0001 — responsive sign-in redesign

**Current evidence.** Right alignment covers the image's foliage, dark overlays suppress its focal
area, the authentication heading is reduced to 1.25rem, and only a 30rem route-specific breakpoint
exists. Russian copy is complete and no WCAG contrast failure was established.

**Implementation tasks (M).**

1. Produce and approve one authentication-specific composition using the existing content and
   actions. Define focal-safe image positioning, card placement, heading hierarchy, and phone,
   tablet, and desktop behavior together; do not treat “dark” itself as a defect.
2. Update `apps/web/app/auth/sign-in/page.module.css` and, only where the approved hierarchy needs
   it, `sign-in-panel.module.css` or the public shell treatment. Preserve all existing provider and
   email authentication behavior.
3. Add an unauthenticated E2E fixture so `/auth/sign-in` does not redirect during coverage. Extend
   responsive tests at 360×780, 834×1112, and 1440×900.
4. Add stable visual snapshots or explicit focal/card composition assertions. Keep axe, keyboard,
   focus order, error announcement, reflow, zoom, and target-size tests.
5. Review English and Russian text wrapping without shortening complete translations merely to fit
   the design. Verify first access, expired session, invitation, and protected-route redirect paths.
6. Roll out as a normal web release. A feature flag is optional only if product wants an A/B design
   comparison; the issue itself does not require experimentation. No data migration or backfill.

**Decisions required.** Product/design must approve the visual direction, whether the existing hero
asset remains, and whether the global compact header/tagline should be adapted specifically for
authentication. The issue does not prescribe a new illustration, a light theme, or new copy.

**Risks.** Snapshot brittleness, background cropping on unusual aspect ratios, and accidental auth
behavior changes. Keep layout work separate from Firebase/provider logic.

## Epic B — archive-first irreversible deletion

### GG-0002 — lifecycle, contracts, data, and operations

**Current evidence.** Garden deletion accepts active or archived state, shares an unconditional
30-day recovery policy with account deletion, and depends on an undeployed development worker.
Candidates already expose archive and hard delete but do not require archive. Plant/task/map/media
and append-only history have different semantics and are not automatically in scope.

**Mandatory product decisions before implementation.**

1. Confirm initial entity scope: gardens and candidates are supported primary scope. Decide account
   policy separately. Do not add plant, task, map-object, media, observation, publication, or audit
   hard deletion without a separate survivor/cascade and retention decision.
2. Decide shared-garden authority: single-owner destruction, ownership transfer, multi-owner
   approval, or ineligibility.
3. Choose the legacy policy for existing `deletionRequested` gardens/accounts: retain legacy
   recovery, allow a new irreversible confirmation, or another explicitly approved transition.
4. Define account deactivation/archive semantics and whether/where a web entry point is desired.
5. Approve confirmation strength and which high-impact operations require recent authentication.
6. Confirm operational semantics: “immediate” means immediate irreversible transition and durable
   purge start, not synchronous erasure of remote bytes, backups, audit, or tombstones.

**Contract and domain design (XL).**

1. Document lifecycle transition tables for each approved entity. For garden/candidate, enforce
   `active → archived → active` and `archived → purging`; reject permanent deletion from every other
   state. Preserve a distinct terminal/pending representation.
2. Prefer additive OpenAPI operations and states so generated TypeScript/Swift clients and queued
   offline commands remain compatible. Define idempotency, revision/`If-Match`, recent-auth, and
   authorization errors explicitly.
3. Add garden unarchive/restore-from-archive. Keep restoration of legacy delayed deletion separate
   from unarchive so old and new semantics cannot be confused.
4. Define a deletion impact resource for confirmation: entity identity plus only the collaborator,
   membership, publication, media, and dependent-data facts already justified by the deletion
   analysis. Do not promise unsupported byte counts or completion times.
5. Preserve checkpoints, revocation, sync tombstones, audit, reference guards, purge resume, and
   retained-record policies in the new archived-to-purging path.

**Data and migration work.**

1. Add only lifecycle/checkpoint columns or enum values required by the approved transition model;
   make migrations backward compatible with existing active, archived, and `deletionRequested`
   rows.
2. Do not silently rewrite legacy pending deletion to archived. Add explicit version/state handling
   and test both old and new clients during the compatibility window.
3. Ensure `archived → purging` creates every deletion record/checkpoint the current sweep expects.
4. Deploy and exercise the deletion/media worker in development before enabling the new action.
   Alert on stuck purges and make retries idempotent.
5. No blanket backfill is authorized. Any legacy transition is driven by the approved policy and
   auditable per row.

**Web implementation.**

1. In garden and candidate lifecycle controls, show Archive/Unarchive in ordinary lifecycle UI.
   Show permanent deletion only when archived and visually separate it from restoration.
2. Replace native confirmation with an accessible impact dialog that names the exact entity,
   affected access/data, irreversibility, retained-policy caveat, and a deliberate second action.
3. Show `Archived`, irreversible purge pending/in progress, failure/retry, and completed/removed
   outcomes distinctly. Disable edits as soon as the irreversible transition succeeds.
4. Localize all state, error, confirmation, and retained-data copy in English and Russian.

**Tests and verification.**

- Domain transition/property tests: active deletion rejected, archive reversible, archived purge
  idempotent, stale revisions rejected, dependency/ownership guards preserved.
- OpenAPI/generated-client compatibility and queued-command tests for old and additive operations.
- Authorization matrix for owner/editor/viewer and the approved shared-owner rule; recent-auth tests.
- Persistence/integration tests for checkpoints, interruption/resume, media absence, identity
  removal where applicable, sync convergence, tombstones, audit, publications, exports, and retained
  records.
- Web tests for control visibility by state, keyboard/focus/dialog semantics, exact-name
  confirmation, error recovery, and English/Russian copy.
- A real worker run in development proving database, storage, identity, sync, and audit outcomes
  separately. Backup and Cloud Storage soft-delete windows remain documented, not hidden.

**Rollout.** Use a server-side capability/feature flag for the new irreversible operation while old
clients remain in circulation. Enable for internal development gardens first, monitor stuck and
failed purges, then expand. Do not remove legacy endpoints until client compatibility evidence and
the legacy-state policy allow it.

**Risks.** Irrecoverable data loss, ownership disputes, partial purge, old-client incompatibility,
false “deleted everywhere” claims, and an enabled UI without a durable worker. This epic requires a
rollback plan that disables new requests; an already accepted irreversible purge cannot be rolled
back.

## Epic C — garden knowledge and quick capture

### GG-0004 — Growing environment setup and summary

**Current evidence.** Six independent cards mirror storage rows. Three facts currently affect
suitability and observation snapshots; the API has one current value per kind, independent PUTs,
no clear/history operation, and no atomic batch. Mixed/scoped environments are not representable.

**Decisions required.**

1. Choose transactional batch save versus honest progressive per-field autosave. The UI must not
   present six PUTs as one atomic save.
2. Decide whether this delivery adds an explicit unknown/clear state. `Not sure yet` must not be
   stored as `None`; adding it requires contract/data design.
3. Decide whether mixed bed/container/greenhouse environments remain an explained limitation or
   enter scope as area-scoped/multiple facts. Do not force a false garden-wide answer.
4. Approve the plain-language prompts and the rename to **Growing environment**.

**Implementation tasks (XL for the complete durable design).**

1. Define the grouped form: Recommendations (growing context, typical growing-season sunlight,
   drainage), Care setup (irrigation), and Optional observations (soil and microclimate). Mark every
   optional input and explain observable answers.
2. If batch is chosen, add an additive batch command carrying per-kind revisions and validations,
   execute it transactionally, and return authoritative facts. If autosave is chosen, preserve
   current PUTs and implement explicit per-field saving/saved/failed states and retry.
3. If clearing/unknown is approved, add backward-compatible schema/OpenAPI/domain semantics and
   review suitability plus observation snapshots before migration. Otherwise leave absent as
   unknown and provide no fake value.
4. Replace the empty six-card stack with one explanation and **Add environment details**. After
   setup, render a compact two-column summary with one Edit action and a secondary source/date
   disclosure; never expose raw recorder UUID as primary metadata.
5. Preserve `user_declared` for ordinary edits. Imported and horticulturally reviewed default
   provenance remain pipeline states and must survive migration accurately.
6. State product impact exactly: sun, drainage, and growing context affect suitability; soil,
   irrigation, and microclimate are stored notes until a real consumer exists.

**Affected surfaces.** `features/garden-context/context-quality.tsx`, fact row/edit form and queries;
garden settings composition/localization; garden-context OpenAPI paths and generated clients;
`garden-context-fact` domain, record application service/repository; suitability recalculation and
observation context snapshot code. A batch/clear/scope choice may require database migrations.

**Tests and checks.** Empty/partial/complete/imported/reviewed profiles; owner/editor/viewer matrix;
batch atomicity or autosave partial failure; revision conflict; clear/unknown only if approved;
suitability inputs and snapshot regression; English/Russian prompt and enum labels; keyboard,
fieldset/legend/error association, focus restoration, phone/tablet/desktop reflow, and browser zoom.
Test that the UI never claims the three stored-only facts drive suitability.

**Rollout/backfill.** The grouped web UI can read existing rows without backfill. Gate new batch,
clear, or scoped contracts until both web and generated clients understand them. Preserve all
existing values/provenance. No conversion of absent facts to explicit unknown without an approved
migration.

**Risks.** Partial writes disguised as success, provenance loss, forcing false garden-wide values,
and changing suitability behavior through a presentation project.

### GG-0010 — observation quick capture

**Current evidence.** The initial form asks users to add fields, exposes raw plant/map UUIDs, and
duplicates note/condition summary. Valid content is note, summary, or labelled photo. Only plant
linkage and `observedAt` affect the shipped 14-day rule; ambient context is server-derived. Garden
object ownership is not enforced in the inspected command.

**Decisions required.**

1. Confirm that quick capture uses one target relationship at a time: whole garden, named plant, or
   named area. Dual plant+area targeting remains unchanged only if product explicitly requires it.
2. Approve hiding `conditionSummary` from general quick capture while preserving the API field and
   historical data for a future structured health flow.
3. Decide whether structured symptoms/measurements join recoverable drafts now or the UI explicitly
   warns that they are not restored. Photo recovery must not claim an attachment the upload owner
   cannot verify.

**Implementation tasks (L).**

1. Add one always-visible multiline **What did you notice?** prompt and primary Save action. Keep a
   labelled photo alone valid.
2. Compose a target selector from current-garden data: whole garden, plants by display name, and
   named map areas. Never show UUIDs. Preserve fixed-plant behavior on plant detail.
3. Add server-side garden-object ownership validation equivalent to the existing plant check, with
   a typed validation/not-found response and authorization tests.
4. Put **Add symptom** next to the prompt. Reuse the nine visual kinds, uniqueness, and
   mild/moderate/severe severity; do not merge testimony with model diagnoses.
5. Put photo, measurement, and changed observation time under **More details**. Default time to the
   server command timestamp and expose datetime only when backdating.
6. Preserve optional height/width/count integrity, nonnegative values, required units, and the
   abandoned-row safeguard. Preserve ambient context as server-owned.
7. On success, show target, time, symptom count, and attachment count, then clear only data the
   accepted observation consumed.

**Affected surfaces.** `record-observation-form.tsx` and CSS/tests; symptom/measurement fields;
route-level photo composition; plant and map-object queries/pickers; draft schema/version;
observation gateway/OpenAPI if target validation errors or picker reads change; `RecordObservation`,
unit of work, garden-object repository/authorization, and downstream recommendation fixtures.
No observation-row migration is required for the proposed compatibility-preserving form.

**Tests and checks.** Note-only, labelled-photo-only, symptom, measurement, backdated, fixed-plant,
garden, and area captures; invalid cross-garden plant/object IDs; idempotency; quick-check cadence
reset only for the linked plant; garden-only entry not counted for all plants; draft restore policy;
offline disable/recovery; English/Russian labels; keyboard order, disclosure semantics, focus/error
announcement, touch targets, phone/desktop reflow, and confirmation content.

**Rollout/backfill.** Version the local draft schema and migrate only safely representable text
drafts. Preserve `conditionSummary` reads and API writes for older clients. Feature-flag the new
composer only if draft/target behavior needs gradual comparison; no database backfill.

**Risks.** Losing recoverable structured input, mis-targeting an observation, changing automation
cadence accidentally, or presenting a symptom as diagnosis.

## Epic D — Map canvas completion

### GG-0006 — label density, controls, and Fit semantics

**Current evidence.** Every visible object gets a fixed ordinal chip, independent control clusters
remain visible, Fit combines all object geometry including backgrounds/outliers, and persisted
camera may restore a small plan. The screenshot alone does not identify which camera cause occurred.

**Runtime evidence gate.** Before selecting Fit semantics, reproduce with the reported garden or a
fixture containing dense objects, an imported background, and a distant record. Compare restored
camera, current Fit bounds, and bounds with support/background objects excluded. Record the actual
cause rather than inferring it from the screenshot.

**Implementation tasks (L).**

1. Define a deterministic label-priority function: selected object always retained; suppress
   overlapping or low-priority chips at low zoom; preserve complete identity in selection and the
   Objects tab. Do not remove the accessible list alternative.
2. Implement collision/scale visibility in `map-canvas.tsx` and/or `object-label-chip.tsx` with
   stable ordering so labels do not flicker while panning.
3. Based on runtime evidence, add clearly named **Fit garden** and **Fit all**, or make ordinary Fit
   exclude only proven support/background extents. Document exactly which categories each uses.
4. Rationalize control placement/visibility at desktop, the 80rem breakpoint, tablet, and phone
   without removing required drawing, backdrop, orientation, zoom, or scale operations.
5. Preserve persisted camera behavior, but ensure a user-invoked Fit is predictable and not
   immediately overwritten by restore.

**Affected surfaces.** `map-canvas.tsx`, object label chip/ordinal code, `viewport.ts`, camera
persistence, toolbar/control clusters, map editor store/actions, localization, architecture docs,
and map E2E/visual fixtures. No API contract or data migration is expected unless runtime evidence
reveals invalid stored geometry; that is not currently supported by the issue.

**Tests and checks.** Pure collision/priority and bounds tests; selected/hidden/locked/background/
outlier fixtures; Fit garden/all expected camera; persistence reload; pointer and keyboard
selection after label suppression; visual snapshots at dense desktop, 80rem, tablet, phone, zoom,
and Russian labels; axe and control target/overlap checks.

**Decision required.** Product must choose the working Fit definition after the runtime comparison.
The issue supports two alternatives and does not authorize silently ignoring arbitrary objects.

**Rollout/risk.** A client-side feature flag can compare old/new decluttering on development maps.
No backfill. Risks are label flicker, hiding important identity, surprising Fit behavior, and
performance degradation from collision work on every frame.

## Epic E — weather baseline and truthful automation

### GG-0008 — Automatic Checks readiness and explanations

**Current evidence.** The endpoint lists seven active versions and coarse garden blockers.
`Running` means inputs are available, not that a rule fired or that every plant was eligible. All
seven rule thresholds await horticultural review; Russian renders server-authored English rule
titles/descriptions. Seasonal acceptance can be partial but readiness reports only none/some.

**Decisions required.**

1. Approve the user-facing status vocabulary, with `Inputs available` as the recorded example.
2. Decide whether the surface shows static per-rule eligibility explanations only, or an additive
   per-target diagnostic read. Do not claim current evaluation output from garden-level readiness.
3. Decide how partial seasonal coverage is summarized: counts and affected named taxa/plants must
   come from an authoritative API read, not client inference.
4. Horticultural reviewers must approve or explicitly retain each threshold. The UI project must
   not silently change watering, observation, harvest, frost, seasonal, succession, or rotation
   parameters.

**Implementation tasks (L).**

1. Change the panel copy and status semantics to readiness, not recommendation output. Present
   review status as a first-class warning and elevated frost risk distinctly.
2. Localize rule titles and descriptions by stable rule key/version in web message catalogs.
   Treat server English as data/audit fallback, not the primary Russian display.
3. For every rule, show exact inputs, windows, stale posture, and important per-target eligibility
   reasons documented in GG-0008. Preserve unknown-not-zero/dry/safe semantics.
4. Add direct recovery links for all user-resolvable blockers: garden location, seasonal acceptance,
   plant identification, and placement. Coordinate anchors/routes with GG-0004 and existing map
   screens.
5. Extend readiness contracts only as needed to distinguish none from partial accepted seasonal
   coverage and to support approved diagnostics. Keep the read provider-free/read-only and avoid
   duplicating rule evaluation logic.
6. Keep succession's static 21-day recurrence fallback and rotation's 365-day season visible as
   limitations until separately changed and reviewed; do not describe the displayed per-taxon
   succession interval as the actual recurrence scheduler.

**Affected surfaces.** `care-rules-panel.tsx`, queries/tests/localization; care-rules OpenAPI schema
and generated clients if readiness detail expands; `GetGardenCareRules`, plant-readiness source,
seasonal acceptance/placement/location routes; launch catalog metadata, safety catalog, rule
fixtures, and Today integration. A schema migration is not expected for display/readiness counts;
an evaluated-diagnostics persistence design would be separate and is not assumed.

**Tests and checks.** All seven rule versions; fresh/stale/missing weather; zero versus unknown rain;
plant lifecycle/taxon/hemisphere/placement/family/prior occupancy; none/partial/full seasonal
acceptance; succession fallback and rotation season copy; reviewed/unreviewed and ordinary/elevated
risk; exact blocker links; English/Russian completeness; keyboard, headings/list semantics, focus,
reflow, and screen-reader status wording. Keep cross-rule, completed-care, seasonal, and readiness
fixtures as regression proof.

**Rollout/backfill.** Additive readiness fields can roll out server-first and be ignored by old
clients. Gate new diagnostics if their query cost is material. No backfill is needed for static
metadata or computed readiness. Review-state changes follow the existing accountable review
process, not a data rewrite by this epic.

**Risks.** Reimplementing the rule engine in a status endpoint, presenting a skip as safety,
localization drift when rule versions change, and making unreviewed thresholds look authoritative.

## Epic F — plant media performance

### GG-0009 — derivative-aware access and loading

**Current evidence.** A 20-card list can make 20 status requests followed by 20 access requests,
then download originals into 118px covers. Detail photos repeat the pattern; reference images are
all eager. Runtime object sizes, derivative coverage, headers, and latency contribution remain to
be measured in an authenticated deployed session.

**Measurement gate.** Capture a sanitized development trace for 20 plants and a photo-heavy detail:
list API duration, status/access request count and concurrency, signed-access latency, selected
media/derivative IDs, object bytes, object TTFB, cache headers/hits, decode time, and reference-host
behavior. Never log signed URLs.

**Decision required.** Choose one authorized delivery contract: batch ready-media access or a
same-origin authorized media URL. Both must preserve processing, failed, unavailable, and
authorization states. Also confirm whether providers expose licensed size variants before adding
reference-image transformations.

**Implementation tasks (L/XL depending on delivery choice).**

1. Extend plant list/photo resources with a ready display derivative: thumbnail for list and screen
   preview for gallery. Keep original access separate and explicit.
2. Collapse status/access for known-ready media through the chosen additive contract. Batch visible
   covers or use a bounded queue; do not create an unbounded signing burst.
3. Update `SearchPlants`, plant-photo reads, repositories/views, OpenAPI, generated TypeScript/Swift
   clients, gateways, and TanStack query keys/cache expiry.
4. Render list covers from thumbnails. Load gallery screen previews lazily and obtain an original
   only through an explicit full-resolution action.
5. For licensed references, request provider-supported size variants. If none exist, preserve the
   licensed source and lazy-load below-fold images rather than inventing an unlicensed proxy.
6. Define safe cache behavior aligned with signed URL expiry and storage metadata. Instrument
   request/transfer budgets without URL/token leakage.

**Data/backfill.** Measure existing derivative coverage. If processed originals lack thumbnail or
screen-preview rows, run an idempotent derivative backfill through the existing processing pipeline,
with progress/failure monitoring and no source-byte mutation. Do not enable derivative-only UI
until fallback behavior for missing derivatives is tested.

**Tests and checks.** Contract/view selection of derivative by context; batch authorization and no
cross-garden leakage; processing/failure/unavailable states; expiry/cache refresh; 20-item request
budget; transferred-byte budget; lazy loading and explicit original action; gallery keyboard and
lightbox focus; alt text; English/Russian status copy; slow network, expired URL, missing derivative,
and partial batch failure. Repeat the sanitized deployed trace after rollout.

**Rollout.** Server-first additive contract, derivative backfill, internal flag for new list/gallery
reads, then percentage/capability rollout. Monitor signing calls, storage egress, image failures,
LCP, and cache hit behavior. Retain old original flow as a temporary fallback until coverage is
proven.

**Risks.** Authorization leakage in batching, signed URL expiry races, storage/egress amplification
during backfill, degraded image quality, license violations, and an apparent speedup that still
downloads originals.

## Cross-cutting delivery gates

### Documentation and versioning

- Synchronize relevant architecture, API, runbook, privacy/retention, and issue records in the same
  task as each implementation.
- Every application-changing task bumps `apps/web/package.json` semantically, and the authenticated
  header must display that exact version. Documentation-only planning does not bump the version.
- Update issue status/history only when evidence supports the lifecycle transition.

### Automated gates

- Node 24, formatting, lint, TypeScript, file-size, unit/component tests, API contract generation,
  affected service tests, and `git diff --check`.
- Add migration forward/compatibility tests wherever an epic changes data. Never use a successful
  web test as proof of an API authorization or persistence invariant.
- Preserve existing unrelated work and run the full relevant suites after targeted tests.

### Visual, responsive, accessibility, and localization gates

- Verify English and Russian at minimum, including long names/copy and localized date/number units.
- Use signed-out browser coverage for sign-in and an authenticated browser fixture for application
  screens.
- Cover phone, tablet, desktop, the map's 80rem breakpoint, 200% zoom/reflow, keyboard-only use,
  visible focus, touch targets, contrast, error/status announcements, dialog/disclosure/tab
  semantics, and axe checks.
- Visual snapshots supplement semantic assertions; they do not replace functional or accessibility
  tests.

### Rollout and observability gates

- Use feature flags for irreversible deletion, materially changed media delivery, or expensive new
  diagnostics. Simple CSS/layout fixes do not require flags unless product explicitly requests an
  experiment.
- Define success/failure telemetry before rollout without collecting signed URLs, private notes,
  photos, or other user content.
- Exercise workers and external storage/provider paths in development before production enablement.
- Document rollback boundaries. UI and read-path rollouts can revert; an accepted permanent purge
  cannot.

## Product decision register

| Decision                                                           | Blocks  | Supported choices from issue analysis                                                                                                 |
| ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication visual direction and hero/header treatment          | GG-0001 | Preserve or reposition existing hero; approve route-specific hierarchy. No new art/theme is assumed.                                  |
| Initial permanent-deletion entity scope                            | GG-0002 | Gardens and candidates confirmed; account separate; plants/tasks/map/media/history require separate approval.                         |
| Shared-garden destruction authority                                | GG-0002 | Single owner, transfer, multi-owner approval, or ineligible; issue does not select one.                                               |
| Legacy `deletionRequested` handling                                | GG-0002 | Keep legacy recovery or offer an approved new irreversible transition; never silently archive.                                        |
| Account deactivation/archive and web entry point                   | GG-0002 | Separate policy required; garden semantics do not automatically apply.                                                                |
| Environment persistence interaction                                | GG-0004 | Transactional batch command or honest per-field autosave.                                                                             |
| Environment unknown/clear and mixed-scope model                    | GG-0004 | Keep absence/limitation, or approve backward-compatible clear/scoped data design.                                                     |
| Map working Fit definition                                         | GG-0006 | Fit garden versus Fit all, or evidence-based exclusion of support/background extents.                                                 |
| Automatic Checks diagnostic depth and status wording               | GG-0008 | Static eligibility explanation or authoritative additive per-target diagnostics; approve precise readiness label.                     |
| Horticultural threshold review                                     | GG-0008 | Approve or explicitly retain each existing placeholder through accountable review.                                                    |
| Media access delivery and reference variants                       | GG-0009 | Batch ready access or same-origin authorized URL; use provider size variants only if licensed/available.                              |
| Observation target cardinality, condition summary, and draft scope | GG-0010 | One named target unless dual targeting is approved; hide but preserve condition summary; persist or disclose structured-draft limits. |

## Definition of portfolio completion

The registry program is complete only when:

1. GG-0003, GG-0005, and GG-0007 have Node 24 and browser/device evidence and are `verified` or
   `closed` without expanding their recorded scope.
2. Every acceptance criterion in GG-0001, GG-0002, GG-0004, GG-0006, GG-0008, GG-0009, and GG-0010
   has implementation and test evidence, or an explicit product decision records why it changed.
3. Contracts, generated clients, data migrations, workers, documentation, localization, and
   accessibility are synchronized for every affected epic.
4. No UI claims stronger semantics than the domain proves: unknown is not zero/safe, an available
   rule input is not a fired recommendation, a displayed interval is not a daily total, a symptom
   is not a diagnosis, and an asynchronous purge is not instantaneous erasure from backups.
5. The registry index, issue histories, and this plan link to the final verification evidence.
