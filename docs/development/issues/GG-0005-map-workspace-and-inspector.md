# GG-0005: Garden Map inspector and object list are difficult to read and operate

| Field          | Value        |
| -------------- | ------------ |
| Status         | `fixed`      |
| Severity       | `SEV-3`      |
| Surface        | `web`        |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-10-05` |

## Summary

The Garden Map inspector used a fixed width, an ambiguous collapse chevron, and inconsistent
spacing on the Backdrop & layers tab. Object rows compressed the ordinal, truncated name, uppercase
type, and three icon-only actions into one line, making long Russian names and object purpose hard
to understand. The inspector and object-list portion is fixed in web 0.6.3; canvas label density and
Fit behavior were split into GG-0006.

## Observations

| Observation   | Date       | Surface and version                            | Expected                                                                                                                       | Actual                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Reproducibility                                                                                                                |
| ------------- | ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| OBS-006       | 2026-08-31 | Web 0.6.1, deployed development                | Consistent panel spacing and a clear way to widen it for long content.                                                         | The Backdrop tab was crowded, width was fixed, and a chevron suggested an unclear collapse/dropdown behavior.                                                                                                                                                                                                                                                                                                                                                             | always                                                                                                                         |
| OBS-007       | 2026-08-31 | Web 0.6.1, deployed development                | Each object row clearly identifies the object and its localized type, with discoverable secondary actions.                     | Long names were available only as a single-line ellipsis while ordinal and icon-only visibility/lock/delete controls dominated.                                                                                                                                                                                                                                                                                                                                           | always                                                                                                                         |
| OBS-R02-005   | 2026-10-04 | Web 0.6.4, deployed development; Chrome, macOS | Explicit accessible tabs, bounded persistent width, readable localized rows, operable actions, and contained Backdrop content. | Partial pass: four tabs without a chevron; pointer and Right/Home/End navigation; 18rem/25rem bounds, reset and reload persistence; full three-line Russian annotation label with localized type/ordinal; pointer hide/lock and keyboard Space reversal. Failure: Location and north/layer controls remained visible below Objects, Properties and Warnings when Backdrop was not selected. Keyboard row selection, multi-selection and deletion were not fully verified. | Tab-content leakage reproduced across three non-Backdrop tabs in a disposable garden; width persistence repeated after reload. |
| OBS-CLOSE-005 | 2026-10-05 | Web 0.6.4, deployed development; Chrome, macOS | Arrow navigation changes the selected row while keeping the object list visible and keyboard focus usable.                     | Arrow Down selected the next annotation, automatically switched to Properties, and moved focus to the page content. Traversal could not continue in the object list.                                                                                                                                                                                                                                                                                                      | Reproduced once in the R02 disposable verification garden.                                                                     |

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

## R02 manual verification result

Keep this issue open (`fixed`). The dated deployed check does not justify closure:
Backdrop content leaks into other selected sections, and the complete pointer
and keyboard selection/multi-selection/deletion matrix is not yet verified.
Earlier “Met” statements describe the original automated fix checks, not complete
deployed acceptance. Backdrop's own gutter and section gaps were visually
consistent and contained; width was reset after checking its bounds. Test objects
were annotations in a disposable garden. No issue-specific Playwright assertions
or GG-0005 fix was added by R02, as required by DEC-003.

## Follow-up repair on 2026-10-05

Web 0.6.7 adds an explicit `display: none` rule for hidden inspector panels. The
Backdrop panel's flex display had overridden the browser's `[hidden]` rule, so
Backdrop controls leaked into Objects, Properties, and Warnings. The existing
responsive tabpanel assertion remains unchanged. The complete local browser
suite passed 53/53 tests with the repair. The issue remains `fixed` until the
deployed acceptance matrix, including selection, multi-selection, and deletion,
passes and is recorded as a new dated observation.

The follow-up deployed check also found that arrow selection hid the Objects
tab and lost keyboard focus. Web 0.6.7 now retains Objects during Up/Down
navigation and Shift multi-selection, while ordinary row activation opens
Properties. The persisted-map browser journey verifies focus retention and
the visible multi-selection actions against the integrated editor.

## Relationships

- Duplicate of: none
- Consolidates: OBS-006 and OBS-007
- Split from: none
- Related issues: GG-0006

## History

| Date       | Change                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-31 | OBS-006 recorded from inspector layout analysis.                                                                                                    |
| 2026-08-31 | OBS-007 added for unreadable long-name object rows.                                                                                                 |
| 2026-08-31 | Product correction removed collapse from the selected design.                                                                                       |
| 2026-08-31 | Inspector and object list fixed in web 0.6.3; canvas concerns split to GG-0006.                                                                     |
| 2026-10-04 | R02 deployed manual verification recorded; issue remains open pending complete passing acceptance.                                                  |
| 2026-10-05 | Follow-up fixed hidden-panel leakage and retained the Objects tab for keyboard navigation and multi-selection; deployed acceptance remains pending. |
