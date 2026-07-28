# ADR-0014: Phase 10 Capture Research Gate

> Status: Proposed
> Date: July 27, 2026

## Context

`docs/implementation-plan.md` section 19.2 requires a Research Gate before any Phase 10
("Assisted Photo/Video Capture and Plan Recognition") production implementation: "Approve a
consented evaluation set covering garden layouts, structures, lighting/weather, devices,
vegetation, occlusion, surface texture, and reference measurements. Approve thresholds for capture
abandonment, useful-proposal precision/recall, geometry error, correction time, processing time,
privacy, and unit cost." Assumption A-5 states the same requirement independently: "AR, LiDAR,
reconstruction, and model-based recognition receive evaluation milestones before production
implementation is committed," with confidence "High." `garden-capture-and-scan.md` section 20
("Evaluation") states the dataset requirement architecturally but does not itself propose a
concrete dataset plan or numeric thresholds — that proposal is this document.

This ADR is the P10-RESEARCH-01 work package's own prerequisite artifact ("Dataset card and
approval" in the work-package table). It does not implement anything. **No Phase 10 code — data
schema, iOS capture coordinator, async pipeline, CV/OCR extraction, or review UI — is in scope
here or written alongside it.** Per this repository's own delivery principle ("Manual before
automatic") and the owner's explicit instruction this session, the correct next action for Phase 10
is a proposal for approval, not an implementation, and not a self-approved placeholder dataset.

## Proposed Dataset and Evaluation Plan

### Consent and recruitment

The pilot dataset should start from the smallest safe circle and expand only after privacy review:

1. **Round 1 (pilot):** internal team members' own gardens, captured with their own informed
   consent, explicitly told the media is used for capture-pipeline evaluation and is not published.
2. **Round 2 (only after Round 1 completes and a privacy review sign-off exists):** a small panel of
   opted-in existing beta/TestFlight users, recruited with a specific consent flow naming the
   evaluation purpose, retention period, and that no capture is used to train a shared model.

Who qualifies for Round 2, and whether any compensation is offered, is a product/legal decision this
ADR does not make — see "Open Decisions" below.

### Representativeness axes

Following `garden-capture-and-scan.md` section 20 verbatim, the pilot set should span:

| Axis                      | Minimum pilot coverage                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lot size/layout           | Small urban lot, suburban lot, larger/rural lot                                                                               |
| Structures                | House, deck, fence, path, bed, tree — the existing required/optional map object categories (FR-7/FR-8), not new ones          |
| Lighting/weather          | Bright midday, overcast, low sun angle (morning or evening); no capture guidance is written for unsafe weather                |
| Device capability tier    | Camera-only, camera + AR world tracking, camera + depth, camera + LiDAR (section 5 tiers)                                     |
| Surface texture/occlusion | Mulch/gravel, dense planting occluding a boundary, mixed hardscape                                                            |
| Regional vegetation       | At least two distinct US hardiness/climate regions, consistent with the approved US-first market                              |
| Ground-truth reference    | An independent physical measurement (tape or laser rangefinder) for every captured boundary segment, recorded outside the app |

**Proposed pilot floor: 20-30 distinct garden captures** spanning the axes above. This is sized to
produce directional precision/recall/error estimates and to validate the annotation guide and
thresholds themselves — not to reach statistical power for a general release decision. A larger,
statistically powered follow-up remains a separate, later evaluation gated behind this pilot's own
results, consistent with the G10/G11 evidence gates the implementation plan already names for P10
and P12.

### Annotation guide (outline)

- Label the same object categories the domain model already defines (lot, structure, deck, fence,
  path, bed) as the same geometry types the map editor already uses (point/line/polygon) — no new
  taxonomy is introduced for evaluation purposes.
- Every labeled boundary carries its independent ground-truth physical measurement.
- At least 10% of the pilot set is independently re-annotated by a second person; inter-annotator
  agreement is reported alongside every subsequent evaluation run, not computed once and assumed
  stable.

### Reproducible baseline

The already-shipped manual plan-import and manual-trace flow (Phase 6) is the baseline for
correction-time and effort comparison. Per implementation-plan.md section 19.4, the exit bar is
comparative — "Evaluation shows lower user effort for the selected use cases at approved quality and
cost" — not an absolute number invented in isolation.

## Proposed Thresholds (draft — requires explicit owner approval or amendment)

These are directional starting points reasoned from this product's own already-shipped positioning
(the map editor's dimension entry is explicitly labeled "a planning aid, not a legal survey"; Garden
Scan is explicitly "not a cadastral survey, engineering measurement, or construction-layout tool")
and from the plan's own cost-control principles (CPU before GPU, stage-level early rejection). None
of them are measured yet — no pipeline exists to measure. They are proposed so the owner has
something concrete to accept, amend, or reject, not because they are already validated.

| Metric                    | Proposed draft threshold                                                                                                                                  | Rationale                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture abandonment       | ≤ 20% of started guided-capture sessions end with no usable media                                                                                         | Consumer guided-capture flows commonly see meaningful first-use abandonment; treat as a pilot ceiling to react to, not a validated benchmark |
| Useful-proposal precision | ≥ 70% of proposed objects are accepted or accepted-with-edit (not outright rejected)                                                                      | A wrong proposal costs more trust than a missed one; precision bar set higher than recall                                                    |
| Useful-proposal recall    | ≥ 50% of ground-truth objects have at least one corresponding proposal                                                                                    | Missed objects are cheap to add manually; the bar exists so the tool is worth running at all                                                 |
| Geometry error            | Median boundary position error ≤ 0.5 m; 90th percentile ≤ 1.5 m against physical reference                                                                | Matches the "planning estimate, not survey-grade" framing already shipped elsewhere in the product                                           |
| Correction time           | Below the manual-trace baseline for the same zone, for the selected use case(s)                                                                           | Directly operationalizes the plan's own comparative exit criterion (section 19.4)                                                            |
| Processing time           | P95 end-to-end (upload complete → review package ready) ≤ 10 minutes for a single zone                                                                    | Consistent with "CPU pipeline before GPU where sufficient" (section 19)                                                                      |
| Privacy                   | Zero unconsented neighboring-property identity retained beyond what boundary geometry requires; raw media stays Sensitive User Data-classified throughout | No new privacy category — applies the existing classification (security-and-privacy.md section 3)                                            |
| Unit cost                 | No draft number proposed — see below                                                                                                                      | A dollar ceiling invented without a real compute benchmark would be fiction, not a threshold                                                 |

**Unit cost is deliberately left open.** The correct process is to measure actual Cloud Run
Jobs/Cloud Tasks compute and storage cost per processed pilot session during Round 1, then propose a
per-accepted-proposal cost ceiling from that measurement before any expansion past the pilot cohort.
Proposing a number now, with no infrastructure pricing evidence behind it, would not be a threshold —
it would be a guess dressed as one.

## Privacy and Retention

No new privacy category is introduced. Pilot capture media is Sensitive User Data under
`security-and-privacy.md` section 3 (original media and property-plan-adjacent imagery), the same
classification `garden-capture-and-scan.md` section 17 already assigns to Garden Scan raw media.

- The existing 30-day raw-retention default (`garden-capture-and-scan.md` section 17;
  `security-and-privacy.md` section 19) applies to pilot media unless this ADR's approval explicitly
  grants an exception.
- **Proposed bounded exception:** pilot raw media may be retained up to 90 days, solely to allow
  annotation and evaluation turnaround, solely for this pilot's own captures, and deleted
  immediately once its own evaluation round completes if that happens sooner. This is an explicit,
  time-boxed deviation from the general default and requires the owner's sign-off as part of
  accepting this ADR, not a standing policy change.
- No training use of pilot data, ever, without separate explicit consent and governance — the
  existing prohibition (`garden-capture-and-scan.md` section 17; `security-and-privacy.md` section 18) is not weakened by this pilot.
- Round 2 participants (if approved) receive the same consent, disclosure, and deletion rights as
  any other capture, plus the evaluation-specific disclosure named above.

## Decision

**This ADR proposes; it does not decide.** Its Status remains `Proposed` until the owner records
explicit approval of:

1. The consent and recruitment approach (Round 1 only, or Round 1 + Round 2).
2. The numeric thresholds above, as proposed or amended.
3. The bounded 90-day pilot retention exception.
4. A compute budget ceiling for the pilot's processing runs.

Until Status changes to `Accepted`, `P10-RESEARCH-01` has not started and no other Phase 10 work
package may begin — the table in `implementation-plan.md` section 19.3 lists "Research Gate" as
every downstream package's transitive dependency. Accepting this ADR authorizes **starting**
`P10-RESEARCH-01` (real consented data collection under the plan above); it does not by itself
authorize writing CV/ML pipeline code, since that code would have no real annotated data to be
evaluated against until `P10-RESEARCH-01` actually produces one.

## Consequences

- Approval unlocks `P10-RESEARCH-01` and, once its dataset card exists, the schema and pipeline
  packages that depend on it.
- The 90-day pilot retention exception, if approved, must be enforced the same way the 30-day
  default is enforced elsewhere — an explicit, tested deletion job, not a documented intention.
- Every subsequent Phase 10 evaluation report should be checked against these thresholds by name, so
  a later change to them is visible as a deliberate amendment to this ADR rather than silent drift.
- The unit-cost ceiling remains genuinely unknown until Round 1 produces a real cost measurement;
  planning beyond the pilot should not assume a number that does not exist yet.

## Open Decisions Requiring the Owner

- Approve or reject Round 2 recruitment (opted-in beta users) versus staying at Round 1
  (internal-only) until later.
- Legal/privacy review sign-off for capturing neighboring private property, even incidentally.
- Final numeric thresholds: accept, tighten, loosen, or replace each draft value above.
- Compute budget ceiling for the pilot's processing runs.

## Rejected Alternatives

- **Build the pipeline against synthetic or mocked data now, with self-approved placeholder
  thresholds:** rejected. This is precisely the shortcut Assumption A-5 and this session's explicit
  instruction both exclude; a threshold nobody outside this document agreed to is not a gate.
- **Skip a small pilot and collect a large dataset immediately:** rejected. The annotation guide and
  draft thresholds themselves are unvalidated; collecting at scale before a pilot risks discovering
  the guide or thresholds were wrong only after paying for a large collection effort.
- **License or scrape an existing public garden-imagery dataset instead of consented in-house
  capture:** rejected for now. Public imagery datasets do not carry this application's own capture
  metadata (device motion, AR tracking state, capability tier) that the pipeline needs to evaluate,
  and most carry their own unclear consent posture for depicting private property. Revisit only if
  consented in-house collection proves infeasible at pilot scale.
