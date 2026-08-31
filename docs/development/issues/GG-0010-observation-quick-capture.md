# GG-0010: Observation capture exposes implementation fields before the primary task

| Field          | Value        |
| -------------- | ------------ |
| Status         | `analyzed`   |
| Severity       | `SEV-3`      |
| Surface        | `web / API`  |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-08-31` |

## Summary

The form initially presents seven equal “add field” controls and no obvious primary input. Two of
those controls expose raw UUIDs, while note and condition summary overlap for ordinary users. The
form is technically functional, but its progressive disclosure starts one level too early: users
must first design their own form before they can record what they saw.

## Code-confirmed constraints

- A valid observation needs at least a nonblank note, condition summary, or purpose-labelled photo.
- Plant and garden object are optional relationships; when opened from a plant page, plant ID is
  correctly fixed and hidden. The garden-wide form currently uses raw text UUID fields because no
  picker is composed there.
- `observedAt` defaults server-side to the command timestamp. It only needs exposure for backdated
  capture.
- Symptoms are observer testimony from a fixed nine-kind visual vocabulary, each unique per
  observation, with mild/moderate/severe severity. They are deliberately not diagnoses or model
  health suggestions.
- Measurements allow one height, width, and count, with nonnegative values and a required free-text
  unit. They are optional and not currently consumed by recommendation rules.
- Current automation uses only a plant-linked observation ID and `observedAt` for the 14-day
  condition-check cadence. Note, summary, symptom, measurement, and area do not affect any shipped
  recommendation rule.
- Ambient sun, drainage, and growing context are snapshotted automatically at record time and must
  remain server-owned.
- Text drafts recover after reload; symptoms, measurements, and photos currently do not.
- The server verifies that a selected plant belongs to the garden. The inspected record path does
  not perform an equivalent garden-object ownership check, so a future picker must submit only
  objects from the current garden and the API should enforce that invariant independently.

## Recommended quick-capture flow

1. Show one always-visible prompt: **“What did you notice?”** with a multiline input. Place the
   primary `Save observation` action immediately after it. A labelled photo alone remains valid.
2. If the form is not already scoped to a plant, show a friendly optional target selector above the
   prompt: `Whole garden`, a plant by display name, or a named map area. Never display or request an
   ID. Use one target relationship at a time unless the domain explicitly defines dual targeting.
3. Put one clear secondary action beside the prompt: **“Add symptom”**. Selecting it opens the
   visual symptom picker and severity, using plain localized labels. This preserves the user's
   stated need without making every observation a health workflow.
4. Place `Add photo`, `Add measurement`, and `Change time` under one **“More details”** disclosure.
   Default time to `Now` and show the chosen time only when changed.
5. Remove condition summary as a second general-purpose field from quick capture. Preserve the API
   property for compatibility and existing records; reserve it for a future structured condition
   summary or map it only from an explicitly named health-summary flow.
6. After save, show a compact confirmation containing target, time, symptom count, and attachment
   count so the user can verify what was recorded.

## Acceptance criteria

- The initial state contains an obvious writable prompt and primary save action, not a row of field
  constructors.
- A note, a purpose-labelled photo, or their combination can be saved without opening details.
- `Add symptom` is directly available; symptoms remain observations, never diagnoses.
- Plant/area selection uses names and current-garden options; raw IDs never appear.
- Time defaults to now and can be backdated accessibly.
- Measurements stay optional, retain kind/value/unit integrity, and cannot silently submit an
  abandoned row as data.
- Existing `conditionSummary`, IDs, timestamps, photos, symptoms, and measurements remain API/data
  compatible; ambient context stays server-derived.
- Plant-linked observations continue to reset the correct plant's quick-check cadence. Garden-only
  observations do not falsely count for every plant.
- Recoverable drafts either include all newly editable structured details or explicitly warn which
  attachments/details cannot be restored.
- The API validates a selected garden object belongs to the route garden.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: GG-0004

## History

| Date       | Change                                                              |
| ---------- | ------------------------------------------------------------------- |
| 2026-08-31 | Analyzed form/domain and proposed a progressive quick-capture flow. |
