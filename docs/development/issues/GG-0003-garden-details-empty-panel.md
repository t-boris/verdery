# GG-0003: Garden details card stretches into an empty panel

| Field          | Value        |
| -------------- | ------------ |
| Status         | `fixed`      |
| Severity       | `SEV-4`      |
| Surface        | `web`        |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-08-31` |

## Summary

At desktop width, the first Garden Settings card showed only the editable garden name, lifecycle,
and caller role but stretched to the height of the adjacent location form. The resulting empty dark
area made the card appear unfinished. The layout defect was confirmed and fixed without inventing
garden metrics.

## Observations

| Observation | Date       | Surface and version             | Expected                            | Actual                                                                                     | Reproducibility |
| ----------- | ---------- | ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ | --------------- |
| OBS-003     | 2026-08-31 | Web 0.6.1, deployed development | A compact, purposeful summary card. | The grid stretched the short garden summary to match the much taller location editor card. | always          |

## Code analysis

### Finding

Supported. `page.module.css` used a two-column grid with the default `align-items: stretch`, while
`GardenSettings` contained only one short heading row. The adjacent `GardenLocationPanel` contains
an address search, actions, advanced fields, messages, and a save action, so it established a much
taller grid row and forced the garden summary to inherit that height.

### Evidence

- `apps/web/app/application/gardens/[gardenId]/page.module.css` — equal-height grid stretch.
- `apps/web/features/gardens/garden-settings.tsx` — only name, status, and role before the fix.
- `packages/api-contracts/openapi/components/schemas/gardens.yaml` — real `createdAt` and `updatedAt`
  metadata available without another request.

### Affected surface

- Garden Settings overview at desktop widths above the existing 68rem stacking breakpoint.
- Both English and Russian locales.

### Likely cause

The summary and the location editor were grouped as equal grid peers even though their content
depth is intentionally different. Grid stretch turned that useful side-by-side relationship into
an implied equal-height-card requirement.

## Reproduction and validation

1. Open an active garden's Settings page at desktop width.
2. Compare the first two cards; the garden summary should end after its own content rather than
   matching the location form's height.
3. Verify the summary shows only the API-backed name, lifecycle, role, created time, and updated
   time, with localized labels.

Automated verification:

- `garden-settings.test.tsx`: 3 tests passed, including the new real-metadata assertions.
- Localization translator/keyed-copy suites: 14 tests passed.
- `@verdery/web` typecheck and targeted ESLint passed.
- Prettier and `git diff --check` passed.

The local runtime was Node 22.22.3 rather than the repository's required Node 24, so CI-equivalent
runtime confirmation remains pending even though the checks passed.

## Resolution

Fixed for web 0.6.2:

- the essentials grid now aligns cards to the start instead of stretching them to equal height;
- the summary adds a localized title and concise context;
- it uses only existing `createdAt` and `updatedAt` values alongside the existing name, lifecycle,
  and role;
- no calculated scores, counts, or decorative metrics were introduced;
- the metadata becomes a single column on narrow screens.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: none

## History

| Date       | Change                                                           |
| ---------- | ---------------------------------------------------------------- |
| 2026-08-31 | OBS-003 analyzed and fixed in web 0.6.2; targeted checks passed. |
