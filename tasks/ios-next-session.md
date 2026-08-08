# iOS: two open defects, diagnosed — RESOLVED, and one they were hiding

Originally written August 7, 2026 as a handoff of two defects found by running
the application in the Simulator against the owner's real garden. Rewritten the
same day, after the work was done, so this file keeps saying what is TRUE.

Both were reproduced on sight before anything was changed. That was worth the
one screenshot it cost: **one of the two diagnoses was wrong**, and a third
defect — the one the owner actually noticed — sat behind the first.

Verified against `7612 Cascade Way - Gurnee`, which unlike the garden the
original handoff used has a non-zero georeference rotation. That difference is
the whole of section 2.

---

## 1. The basemap did not line up with the garden — RESOLVED

### What was diagnosed, and was right

`BasemapCameras.derive` produces a ground **span** in metres and
`MapBackgroundView.apply` passed it to `MapCamera(distance:)`. A camera's
distance is how far it sits above the ground; how much ground that covers
depends on a field of view MapKit does not publish. The code said as much in a
comment — "at a garden's scale, taking one for the other is close enough" — and
the screenshot said it was not.

### How wrong, measured rather than argued

`MapProxy.camera(framing:)` converts a region into the camera MapKit would
itself use to frame it. Asked for a 113.30 m span on a 402×397 pt canvas, it
answers **211.41 m** — a ratio of **1.866**. So the old code showed 54% of the
ground it should have, and everything drawn over the photograph was 1.87× too
large. That is the "wrong size and place" in the original report: a scale error
about the viewport centre displaces everything except the centre.

### The fix

The span is stated exactly, as an `MKCoordinateRegion` carrying the viewport's
own aspect ratio, and the distance is **asked of MapKit** rather than assumed:

```swift
var framed = map.camera(framing: region)
framed.heading = camera.headingDegrees
position = .camera(framed)
```

The unpublished quantity stays inside MapKit instead of becoming a calibration
constant nobody here could derive or check. Measured after the change, over the
same canvas: asked 113.30 m, shown 113.30 m, ratio **1.0000**.

Neither of the two options the handoff proposed. `MapCameraPosition.region`
states the span exactly but carries no heading, and the handoff's preferred
route out of that — moving the garden's rotation onto the canvas's own drawing —
is a real change to gestures, snapping and background placement, in service of a
problem `camera(framing:)` does not have. Empirical calibration, the other
option, was rejected for the reason the handoff gave.

`MapBackgroundView` is still the only file outside the Xcode glue that imports
MapKit.

## 2. The heading was wrong too — the defect behind the defect

The handoff flagged this exactly right: _"The heading is not covered by that
test and is worth confirming separately."_ It was not covered, and it was wrong.

`rotationDegrees` is what `GeographicProjection.localPosition` rotates a
compass-aligned offset by, **negated**, to reach local axes. Put local `(0, 1)`
through it and it comes back at east `-sin θ`, north `cos θ` — bearing `-θ`. The
garden's `+Y` therefore points θ degrees _anticlockwise_ of north, and since the
canvas draws `+Y` upward, `-θ` is the bearing the backdrop must put at the top.
`derive` returned `+θ`.

The error is `2θ`. It is exactly zero in an unrotated garden, which is what
every fixture, every existing test and the original handoff's own screenshots
used. On the Gurnee garden (θ ≈ 90°) the photograph was turned a half-turn under
a drawing that still looked plausible — the compass read **E** where it should
read **W**.

The web editor has always had this right, in one line with a comment saying so:
`bearing: -(georeference.rotationDegrees + camera.rotationDegrees)` in
`basemap-provider.ts`. The Swift port dropped the minus.

`BasemapCameraTests` now pins the heading against the projection instead of
against itself: for five rotations, the bearing from the anchor to a point one
metre up the canvas must equal the heading the camera asks for. Against the old
sign it fails by 74°, 180°, 67° and 2° — the `2θ` model exactly. The existing
`rotatedAxes` test asserted `headingDegrees == 90` two lines under two
assertions that already said _west_; its prose said east. The assertions were
right and the sentence was what got copied.

## 3. The map's bottom controls were clipped — RESOLVED, other cause

Both halves of the handoff's diagnosis were wrong, and looking at the running
app was what said so.

- **The clipped row was the tab bar, not the create rail.** The console strip
  was applied as a bottom safe-area inset on the `TabView`. That was right while
  the tab bar was opaque and part of that view's safe area; from iOS 26 the bar
  floats, so the inset landed at the bottom of the _screen_, on top of it. The
  strip now goes in `tabViewBottomAccessory`, the slot iOS 26 introduced for
  exactly this content, and stays on the inset before it.
- **The create rail also clips, for its own reason** — visible once the strip
  moved. Not the stack overflowing as diagnosed: `createToolbar` is a
  `ScrollView(.horizontal)`, which is still flexible _vertically_, so it
  competed with the canvas for leftover height instead of asking for the one row
  it holds. `.fixedSize(horizontal: false, vertical: true)` says what was always
  meant. The canvas is additionally marked `.layoutPriority(-1)`, so a band that
  is accidentally flexible cannot take the space a control needs.

Insetting each tab instead of the `TabView` was tried, because it preserves the
edge-to-edge charcoal the design asks for, and is worse: the chassis then fills
the whole bottom of the screen and the glass tab bar over it loses its labels.
The accessory's own glass tray around the strip is accepted for that reason.
Sizing the content to fill the tray does not take — the tray proposes an
unspecified height, against which both `maxHeight: .infinity` and
`containerRelativeFrame` resolve back to the content's ideal size.

`MapEditorView.swift` crossed the 600-line rule with these changes, so the
bottom bands moved to `MapEditorView+Bands.swift` — the same split
`MapEditorView+Toolbar.swift` already makes, and they belong together: between
them they decide how much height the canvas is left with.

## 4. What is left

- **Nobody has seen a rotated garden's backdrop under aerial imagery at more
  than one zoom.** The span was measured exactly at one zoom and the heading was
  confirmed by eye at one. Both are derived rather than tuned, so neither should
  vary with zoom — but "should" is what the last comment in this file said too.
- **The accessory's glass tray is a cosmetic compromise**, not a solved problem.
  If a later SDK exposes the tray's own background, the chassis should fill it.
- **The iOS 18–25 path is unverified.** Only iOS 26.2 and 26.5 runtimes are
  installed here, so the `safeAreaInset` fallback was reasoned about and not
  run. It is the behaviour that shipped, unchanged.
- **`swift test` runs on macOS.** The whole suite passes, but nothing in it
  exercises a `Map`; both camera defects were invisible to it by construction
  and were found by looking at the screen.

## Verified state

`swift build` clean, **1199 tests in 176 suites** pass, `check-file-size` clean.
Built and installed to the iPhone 17 simulator (iOS 26.5) **signed** — a build
with `CODE_SIGNING_ALLOWED=NO` carries no entitlements, so
`keychain-access-groups` is absent, Firebase Auth cannot reach the keychain
(`-34018`), and sign-in does not persist. That re-broke, from the build command,
the defect `8bfde56` had just fixed in `project.yml`.

The simulator build was pointed at the deployed dev API with
`API_ORIGIN=https://verdery-api-dev-t6amsr5o6a-uc.a.run.app`; the Debug default
is `http://localhost:8080`, which was not running.
