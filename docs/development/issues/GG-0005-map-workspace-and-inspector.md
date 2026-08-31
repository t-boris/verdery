# GG-0005: Garden Map inspector and object list are difficult to read and operate

| Field          | Value        |
| -------------- | ------------ |
| Status         | `fixed`      |
| Severity       | `SEV-3`      |
| Surface        | `web`        |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-08-31` |

## Summary

The Garden Map inspector used a fixed width, an ambiguous collapse chevron, and inconsistent
spacing on the Backdrop & layers tab. Object rows compressed the ordinal, truncated name, uppercase
type, and three icon-only actions into one line, making long Russian names and object purpose hard
to understand. The inspector and object-list portion is fixed in web 0.6.3; canvas label density and
Fit behavior were split into GG-0006.

## Observations

| Observation | Date       | Surface and version             | Expected                                                                                                   | Actual                                                                                                                          | Reproducibility |
| ----------- | ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| OBS-006     | 2026-08-31 | Web 0.6.1, deployed development | Consistent panel spacing and a clear way to widen it for long content.                                     | The Backdrop tab was crowded, width was fixed, and a chevron suggested an unclear collapse/dropdown behavior.                   | always          |
| OBS-007     | 2026-08-31 | Web 0.6.1, deployed development | Each object row clearly identifies the object and its localized type, with discoverable secondary actions. | Long names were available only as a single-line ellipsis while ordinal and icon-only visibility/lock/delete controls dominated. | always          |

## Code analysis

### Finding

Supported. The inspector width came only from `clamp(18rem, 21vw, 25rem)`. Its Backdrop tab had no
shared padding or section gap. The object-list grid allocated fixed columns to ordinal and category
and forced the name to `white-space: nowrap` with ellipsis. Visibility, lock, and delete were three
adjacent icon-only controls.

The pre-existing collapse control was technically keyboard accessible, but the user identified a
semantic UX problem: its generic chevron looked like a selector for all sections. The selected
resolution removes collapse entirely rather than making that behavior more powerful.

## Resolution

Fixed in web 0.6.3:

- removed the inspector collapse control, state, and copy;
- kept four explicit tabs and completed their keyboard pattern with roving focus plus Left, Right,
  Home, and End navigation;
- added clearly labelled Narrow, Reset width, and Widen controls using native buttons;
- bounded widths at 18rem, the existing responsive standard width, and 25rem, persisted per garden;
- hid width controls below the desktop breakpoint, where the overlay/sheet layout owns panel size;
- added a consistent gutter, section gap, and overflow containment to Backdrop & layers;
- changed object rows to show a category icon, full wrapping name, localized type, and secondary
  ordinal;
- changed visibility, lock, and delete from dominating icon-only cells to a wrapping, named action
  group while preserving icons as visual reinforcement;
- preserved row selection, Arrow Up/Down navigation, Shift multi-selection, visibility, locking,
  deletion, and join behavior.

Automated verification:

- inspector layout/drawer/object-list suites: 9 tests passed;
- long Russian names, explicit tabs, tab keyboard navigation, width bounds/persistence, row keyboard
  navigation, and named actions are covered;
- web typecheck passed.

The local runtime is Node 22.22.3 rather than the repository's required Node 24. Browser-level
visual verification remains limited by the lack of a locally running authenticated API session.

## Acceptance criteria

- All four sections are explicit tabs; no collapse/dropdown chevron is present. Met.
- Tabs support pointer activation and standard keyboard focus/navigation. Met.
- Desktop width can be narrowed, reset, or widened within 18–25rem and persists per garden. Met.
- Long Russian names remain fully readable and localized object type is visible. Met.
- Visibility, lock, delete, selection, and multi-selection remain keyboard and pointer accessible.
  Met.
- Backdrop content has consistent outer padding/gaps and cannot widen the inspector. Met.
- Dense canvas chips and Fit semantics are handled separately. See GG-0006.

## Relationships

- Duplicate of: none
- Consolidates: OBS-006 and OBS-007
- Split from: none
- Related issues: GG-0006

## History

| Date       | Change                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| 2026-08-31 | OBS-006 recorded from inspector layout analysis.                                |
| 2026-08-31 | OBS-007 added for unreadable long-name object rows.                             |
| 2026-08-31 | Product correction removed collapse from the selected design.                   |
| 2026-08-31 | Inspector and object list fixed in web 0.6.3; canvas concerns split to GG-0006. |
