# GG-0006: Garden Map canvas labels, controls, and Fit behavior compete with the plan

| Field          | Value        |
| -------------- | ------------ |
| Status         | `analyzed`   |
| Severity       | `SEV-3`      |
| Surface        | `web`        |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-08-31` |

## Summary

The Garden Map can show a relatively small plan while every visible object receives an ordinal chip
and several independent control clusters remain visible. This canvas-specific work was split from
GG-0005 so the inspector and object-list fix would not falsely claim to resolve label decluttering
or camera Fit semantics.

## Code analysis

### Finding

Supported in behavior, with the screenshot's exact camera cause still unconfirmed:

- every visible record receives a fixed-size ordinal chip without collision or scale suppression;
- tool, backdrop, orientation, zoom, and scale controls are independently visible;
- Fit includes every object geometry, including imported backgrounds and distant records;
- per-garden camera persistence can also restore a zoom at which the plan appears small.

The screenshot cannot distinguish a restored camera from oversized/outlier Fit bounds without its
runtime map data.

### Evidence

- `apps/web/features/map/map-canvas.tsx` — renders an ordinal chip for every visible record.
- `apps/web/features/map/shapes/object-label-chip.tsx` — fixed chip geometry without collision
  handling.
- `apps/web/features/map/viewport.ts` — combines all object bounds for Fit.
- `apps/web/features/map/use-map-view-persistence.ts` — restores camera state per garden.

## Proposed direction

1. Keep the selected object's marker and suppress overlapping or low-priority chips at low zoom.
2. Preserve full identification through selection and the accessible Objects tab.
3. Provide separate **Fit garden** and **Fit all** actions, or exclude background/support extents
   from the ordinary working Fit.
4. Validate control overlap at desktop, the 80rem breakpoint, tablet, and phone.

## Resolution

Pending implementation. No canvas rendering or camera behavior changed in web 0.6.3.

## Relationships

- Duplicate of: none
- Consolidates: OBS-005
- Split from: GG-0005
- Related issues: GG-0005

## History

| Date       | Change                                                         |
| ---------- | -------------------------------------------------------------- |
| 2026-08-31 | OBS-005 split from GG-0005 after the inspector fix was scoped. |
