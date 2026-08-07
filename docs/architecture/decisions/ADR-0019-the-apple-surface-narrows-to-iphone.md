# ADR-0019: The Apple Surface Narrows to iPhone

> Status: Accepted
> Date: August 7, 2026

## Context

`implementation-plan.md` section 26 commits to iPad in all three of its parity tables, and
`ios-application-design.md` section 3 named "iPhone and iPad" as the support policy. The project
carried `TARGETED_DEVICE_FAMILY: "1,2"`, a `~ipad` orientation block, and an App Store submission
checklist that required a second set of screenshots at a second set of resolutions.

Nothing was ever built for the larger screen. The application shipped one layout, sized for a
phone, and an iPad ran it stretched. That is not a neutral state — it is a promise made in three
tables and kept nowhere, and every release that went out under it added to the gap between what the
plan said and what existed.

Three things forced the decision now rather than later:

1. **The redesign has a device in mind.** "Professional Field Console" is a language for one hand,
   in sunlight, with a 72-point shutter in the bottom third of the screen and every action inside a
   thumb's reach. Those are phone decisions. An iPad layout is not a wider version of them; it is a
   different set of decisions — a split view, a persistent inspector, a pointer, a keyboard — and
   pretending otherwise produces a phone screen with 400 points of empty margin.

2. **The product's main loop is a phone loop.** Section 26.3 requires "camera-first offline-capable
   repeated observations with background upload". That is somebody walking a bed with a phone in
   one hand. Nobody photographs forty plants with an iPad, and the parts of this application that
   matter most in a garden are the parts an iPad is worst at.

3. **The cost is not the layout, it is the second promise.** Supporting iPad properly means a
   second navigation model, a second set of gesture affordances for a pointer, a second screenshot
   set per release, and a second device class in every accessibility and orientation decision. Doing
   it badly is worse than not doing it: an application that runs stretched on a device it claims to
   support is one that gets reviewed as broken.

## Decision

**The Apple client targets iPhone only.**

- `TARGETED_DEVICE_FAMILY` is `"1"`. The `~ipad` orientation block is removed.
- Portrait everywhere, except the map editor, which may enter landscape and returns to portrait on
  leaving — the one screen where a wide canvas buys real estate.
- Section 26's three tables read "iPhone" where they read "iPhone/iPad".
- The distribution checklist requires one screenshot set.

**This is a narrowing, not a deferral of iPad, and not a claim that iPad is wrong.** A tablet layout
for planning work — a large map beside an inspector, a season plan beside a bed list — is a
plausible future product. It is a _different_ product surface with its own navigation model, and
adding it later is a new decision with its own ADR, not the quiet unchecking of a box.

## Consequences

**What gets better immediately.** Every layout question has one answer. Every gesture is a
fingertip. Every screenshot set is one set. The accessibility work — touch targets, orientation,
text sizes — is measured against one geometry rather than hedged across two.

**What is given up.** An owner with an iPad can still install and run the application; iOS runs an
iPhone-only binary on iPad in compatibility mode. It will look like what it is: a phone application
on a tablet. That is an honest presentation of a phone application, and better than a stretched
layout claiming to be designed for the device.

**What must not happen quietly.** If iPad returns, it returns as a designed surface with its own
navigation model and its own parity table — not by flipping `TARGETED_DEVICE_FAMILY` back to
`"1,2"` and hoping the phone layout stretches acceptably. That is precisely the state this decision
is ending.

## Alternatives Considered

**Keep iPad in the plan and build it later.** This is what the plan already said, and it had been
saying it through eight phases without producing a single iPad-specific view. A commitment nothing
acts on is not a plan; it is a note that the reader must remember to discount.

**Build a real iPad layout now.** Defensible, and genuinely the better product for planning work.
Rejected on sequencing rather than on merit: the phone client is not finished, the redesign that
defines the visual language is mid-flight, and a second layout built against a language still being
settled would be rebuilt as soon as the language changed.

**Ship universal and let the phone layout stretch.** The status quo. Rejected because it is the one
option that makes a promise and breaks it — an application listed as supporting a device it was
never laid out for.

## Sources

- `docs/implementation-plan.md`, section 26 (parity tables).
- `docs/architecture/ios-application-design.md`, sections 3 and 14.
- `docs/development/ios-distribution.md`, section 0 (device family) and section 11 (screenshots).
- ADR-0009, "Apple deployment target", for the toolchain and OS floor this sits inside.
