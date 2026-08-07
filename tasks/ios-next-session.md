# iOS: two open defects, diagnosed

Both were found by running the application in the Simulator against the
owner's real garden (`7612 Cascade Way`), not by reading code. Both are
reproducible on sight. Neither is started.

## 1. The basemap does not line up with the garden

**Symptom.** The drawn objects float over the aerial photograph at the wrong
size and place. The garden is georeferenced and the backdrop is imagery, so the
two should coincide.

**Where.** `FeatureMap/MapBackgroundView.swift`, `apply(_:)`.

**Diagnosis.** `BasemapCameras.derive` produces a ground **span** in metres and
`apply` passes it to `MapCamera(distance:)`. Those are different quantities: a
camera's distance is how far it sits above the ground, and how much ground that
covers depends on a field of view MapKit does not publish. The code says as
much in a comment — "they differ by the field of view; at a garden's scale,
taking one for the other is close enough" — and the screenshot says it is not.

The centre is not suspect: `BasemapCameraTests.roundTripsThroughProjection`
pins `derive` against `GeographicProjection` across five rotations, so the
coordinate arithmetic inverts exactly. The **heading** is not covered by that
test and is worth confirming separately.

**Two ways out, and the trade.**

- `MapCameraPosition.region(MKCoordinateRegion(center:latitudinalMeters:
longitudinalMeters:))` states the span exactly and removes the guess. It
  carries no heading, so the garden's rotation would have to move onto the
  canvas's own drawing instead — a real change, not a one-line swap.
- Keep `MapCamera` for its heading and calibrate distance against span
  empirically. Cheaper, but it bakes in a constant nobody can derive, which is
  the kind of number that is wrong on a device with a different aspect ratio.

Prefer the first. Verify by eye against this same garden, not by unit test:
the failure is visual and a passing test is what let it through.

## 2. The map's bottom controls are clipped

**Symptom.** Below the category rail ("Add · Lot · Structure · Fence · Gate ·
Path") a second row of controls is cut in half by the console status strip.

**Where.** `FeatureMap/MapEditorView.swift`, `loadedContent`, and
`AppComposition/GardenTabView.swift`'s `.safeAreaInset(edge: .bottom)`.

**Diagnosis.** `loadedContent` is a `VStack` holding, in order: the tab rail,
any banners, the canvas, a selection/vertex/calibration bar, `draftControls`
and `createToolbar`. The console strip is added by the shell as a bottom safe
area inset, which reserves height the `VStack` never learns about. With every
band present the stack exceeds the space left and the last one loses.

**What to weigh.** The canvas is the flexible element and everything else is
fixed, so the canvas should give up the height rather than the controls. Check
whether the bars want to be a single scrolling band, and whether the banners —
disclosure, create hint, join hint, error, undo — can stack three deep at once,
because that is the case that overflows.

## Verified state at handoff

`origin/master` at `8bfde56`. 1198 tests, clean `swift build`, simulator
`BUILD SUCCEEDED`, 600-line gate and prettier both green. Working tree clean.
