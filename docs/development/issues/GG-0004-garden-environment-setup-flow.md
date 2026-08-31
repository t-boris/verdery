# GG-0004: Garden environment facts lack a usable setup and summary flow

| Field          | Value              |
| -------------- | ------------------ |
| Status         | `analyzed`         |
| Severity       | `SEV-3`            |
| Surface        | `web / API / data` |
| Code finding   | `supported`        |
| First reported | `2026-08-31`       |
| Last updated   | `2026-08-31`       |

## Summary

The Garden Settings page presents six environment facts as six equally prominent cards. An empty
garden therefore shows six repeated "not declared" states, each with its own disclosure, field,
Save action, and Cancel action. This technically permits recording facts but does not help a
gardener understand what to enter, what can be left unknown, or which facts affect the product.

## Observations

| Observation | Date       | Surface and version             | Expected                                                                                 | Actual                                                                                                             | Reproducibility |
| ----------- | ---------- | ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------- |
| OBS-004     | 2026-08-31 | Web 0.6.1, deployed development | A guided way to add real observations and a compact summary that explains their purpose. | Six isolated cards repeat an undeclared state and require six separate edit-and-save interactions without prompts. | always          |

## Code analysis

### Finding

Supported. The web implementation deliberately renders one row for every context kind, including
missing values, and each row owns an independent edit form and mutation. The domain supports
provenance but not a general quality score, confidence level, evidence attachment, unknown reason,
or change history. The screen title and description therefore imply a quality assessment that the
model does not provide.

The data itself is not nonfunctional: three facts already feed candidate suitability and are
snapshotted onto observations. The defect is the collection and presentation model around those
facts, not the existence of the facts.

### Evidence

- `apps/web/features/garden-context/context-quality.tsx` — always renders all six kinds as a long
  list.
- `apps/web/features/garden-context/context-fact-row.tsx` — repeats missing state, provenance, raw
  recorder profile ID, and an edit disclosure for every kind.
- `apps/web/features/garden-context/context-fact-edit-form.tsx` — saves one fact at a time and
  provides no question-specific guidance; ordinary web submissions correctly force
  `user_declared` provenance.
- `services/api/src/modules/gardens-mapping/domain/garden-context-fact.ts` — one current value per
  kind; four single-choice vocabularies, two free-text values, and three provenance sources.
- `services/api/src/modules/gardens-mapping/application/record-garden-context-fact.ts` — independent
  last-writer-wins upserts without optimistic concurrency or an audit event.
- `services/api/src/modules/plants-inventory/application/recalculate-candidate-suitability.ts` —
  suitability currently consumes only sun exposure, drainage, and growing context.
- `services/api/src/modules/observations-history/application/resolve-observed-context-snapshot.ts`
  — observations snapshot those same three facts.
- `docs/technical-specification.md`, FR-22 — requires source and quality to be understood before
  context influences high-impact guidance, but does not require six isolated editors.

### Affected surface

- The Environment data quality section of web Garden Settings, for both English and Russian.
- `GET /gardens/{gardenId}/context` and the six independent
  `PUT /gardens/{gardenId}/context/{contextKind}` operations.
- Candidate-suitability explanations and observation context snapshots for sun exposure, drainage,
  and growing context.
- Any future importer or horticulturally reviewed-default pipeline that uses the other provenance
  sources.

### Likely cause

The first UI mirrors the storage shape: one card and one mutation per database row. That makes the
domain's provenance visible, but it does not translate the six fields into a task-oriented setup
flow or distinguish currently consequential inputs from stored descriptive context.

## Confirmed constraints

- A garden has at most one current value for each of the six kinds; updates replace that value in
  place while incrementing its revision. There is no fact-history or clear/delete operation.
- Sun exposure, drainage, irrigation method, and growing context are single-choice values. Soil
  type and microclimate are nonblank free text.
- The model cannot accurately represent mixed growing contexts or irrigation methods, seasonal
  differences, or bed-specific conditions. Supporting those cases requires a contract and data
  model change, not only a new form.
- Editors and owners can record facts. The ordinary UI must continue to record them as
  `user_declared`; `imported` and `horticulturally_reviewed_default` are pipeline provenance, not
  user-selectable confidence labels.
- The API has no atomic multi-fact write. A web-only "Save all" implemented as six existing PUTs
  can partially succeed and must not pretend to be transactional.
- The API exposes a recorder profile ID but no member display name on this resource.

## Proposed experience

This section is a product proposal, not current behavior.

1. Rename the user-facing section to **Growing environment**. In an empty state, show one compact
   explanation and one **Add environment details** action instead of six empty cards.
2. Open one guided form grouped by purpose:
   - **Recommendations:** growing context, typical growing-season sunlight, and drainage;
   - **Care setup:** irrigation method;
   - **Optional observations:** soil and microclimate notes.
3. Ask observable, plain-language questions. For example, explain sunlight using typical hours of
   direct growing-season sun and drainage using how long water remains after heavy rain. Do not ask
   users to guess a soil classification. Every optional item can be skipped; an explicit
   **Not sure yet** state should remain distinct from **None**.
4. Save the profile as one deliberate action. The durable design should add a transactional batch
   API with per-fact validation and revisions. If the existing per-fact API is retained, use honest
   progressive autosave with per-field success/error states instead of presenting a false atomic
   Save action.
5. After setup, collapse the result into a compact two-column summary with one **Edit details**
   action. Show friendly source and updated-date text in a secondary Details disclosure; do not
   expose a raw profile UUID as primary user-facing metadata.
6. Explain impact precisely: sun, drainage, and growing context currently inform plant
   suitability. Label soil, irrigation, and microclimate as recorded garden notes until a real
   consumer is implemented.
7. For gardens that mix beds, containers, greenhouses, or watering methods, avoid forcing a false
   garden-wide answer. Initially allow users to skip the field and explain the limitation; a later
   model should scope facts to beds/areas or support multiple values with explicit applicability.

## Data and migration implications

- A guided web layout alone can reuse the current list and per-kind PUT contracts, but cannot
  provide atomic Save, clearing, mixed values, scoped facts, or a real quality assessment.
- A complete redesign should introduce a batch command, conflict handling, and an explicit way to
  clear a fact. Existing rows and enum values should remain readable during rollout.
- Adding `unknown`, multiple values, applicability scope, evidence, confidence, or history requires
  backward-compatible schema and API evolution plus suitability and observation-snapshot review.
- Existing imported or reviewed-default provenance must survive edits and migrations. A member edit
  should create a user declaration intentionally rather than silently masquerading as the prior
  reviewed/imported source.

## Reproduction and validation

1. Open Garden Settings for a garden with no context facts.
2. Confirm that six cards and six independent Declare workflows appear.
3. In a redesign, verify empty, partial, and complete profiles; editor/viewer permissions; Russian
   and English copy; keyboard and narrow-screen behavior; partial network failures; and imported or
   reviewed facts.
4. Verify that the UI never claims soil, irrigation, or microclimate currently affects suitability.

## Resolution

Pending product design and implementation. The recommended flow is recorded above; no application
code was changed for this redesign analysis.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: none

## History

| Date       | Change                                                                |
| ---------- | --------------------------------------------------------------------- |
| 2026-08-31 | OBS-004 analyzed; guided setup and compact-summary proposal recorded. |
