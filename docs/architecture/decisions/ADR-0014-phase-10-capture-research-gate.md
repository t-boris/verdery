# ADR-0014: Phase 10 Capture Research Gate

> Status: Superseded by [ADR-0015](ADR-0015-phase10-redirect-plants-over-photo-capture.md) for the
> photo-based garden-object recognition use case this ADR gated (`P10-RESEARCH-01`, `P10-CV-01`,
> `P10-CV-02`, `P10-REVIEW-01` are removed from the plan, not merely blocked). This ADR's
> `P10-DATA-01`/`P10-ASYNC-01` approvals and its general reasoning about consented evaluation data
> remain valid and are not overturned.
> Date: July 27, 2026
> Approved: July 27, 2026, by the project owner, as proposed (see "Approval" under Decision)

## Current Roadmap Alignment

ADR-0015 redirected Phase 10 and the current implementation plan removed automated reconstruction
from numbered release phases. Consequently, this historical approval does not authorize a current
production pipeline or new raw-media collection. Its reusable capture-session data work belongs to
Phase 12; its async patterns are architectural groundwork; and reconstruction may return only
through the implementation plan's research promotion criteria, a new ADR, and a newly numbered
phase.

## Context

`docs/implementation-plan.md` section 19.2 requires a Research Gate before any Phase 10
("Assisted Photo/Video Capture and Plan Recognition") production implementation: "Approve a
consented evaluation set covering garden layouts, structures, lighting/weather, devices,
vegetation, occlusion, surface texture, and reference measurements. Approve thresholds for capture
abandonment, useful-proposal precision/recall, geometry error, correction time, processing time,
privacy, and unit cost." Assumption A-5 states the same requirement independently: "AR, LiDAR,
reconstruction, and model-based recognition receive evaluation milestones before production
implementation is committed," with confidence "High." `garden-capture-and-scan.md` section 10.11
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

Following `garden-capture-and-scan.md` section 10.11, the pilot set should span:

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
(the map editor's dimension entry is explicitly labeled "a planning aid, not a legal survey"; the
proposed automated reconstruction was explicitly "not a cadastral survey, engineering measurement,
or construction-layout tool")
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
classification `garden-capture-and-scan.md` section 10.8 assigns to candidate reconstruction media.

- The existing reserved 30-day raw-retention default (`garden-capture-and-scan.md` section 10.8;
  `security-and-privacy.md` section 19) applies to pilot media unless this ADR's approval explicitly
  grants an exception.
- **Proposed bounded exception:** pilot raw media may be retained up to 90 days, solely to allow
  annotation and evaluation turnaround, solely for this pilot's own captures, and deleted
  immediately once its own evaluation round completes if that happens sooner. This is an explicit,
  time-boxed deviation from the general default and requires the owner's sign-off as part of
  accepting this ADR, not a standing policy change.
- No training use of pilot data, ever, without separate explicit consent and governance — the
  existing prohibition (`garden-capture-and-scan.md` section 10.8; `security-and-privacy.md` section 18) is not weakened by this pilot.
- Round 2 participants (if approved) receive the same consent, disclosure, and deletion rights as
  any other capture, plus the evaluation-specific disclosure named above.

## Decision

### Approval

Approved as proposed on July 27, 2026:

1. **Consent and recruitment:** Round 1 (internal team, own gardens) only, for now. Round 2 stays
   gated behind its own future privacy-review sign-off, as this ADR already specified — approving
   this ADR does not itself approve Round 2.
2. **Numeric thresholds:** accepted as drafted (the table above), unamended.
3. **Retention exception:** the bounded 90-day pilot retention exception is approved, scoped only to
   Round 1 pilot media, per the "Privacy and Retention" section above.
4. **Compute budget:** no ceiling number was proposed for unit cost, deliberately (see "Proposed
   Thresholds"), so none is approved here either. What is approved is the _process_: Round 1's
   processing runs proceed under ordinary cost-control engineering practice (the existing duration/
   file-size/concurrency limits this repository already applies elsewhere), and a real per-unit cost
   ceiling is set from Round 1's actual measurement before any expansion past the pilot cohort.

### Scope this approval unlocks now

This approval authorizes starting `P10-RESEARCH-01` (real consented data collection under the plan
above) and, because they do not depend on the collected dataset existing yet, the two "production
implementation" work packages that only require schema and infrastructure plumbing:

- `P10-DATA-01` — capture session, capability class, media reference, quality observation,
  calibration, processing state, and cancellation/recovery schema.
- `P10-ASYNC-01` — manifest, job state, Cloud Tasks initiation, Cloud Run Job execution, progress,
  cancellation, checkpoint, retry, and terminal-failure plumbing, with no CV/ML content.

It does **not** unlock `P10-IOS-01`/`P10-IOS-02` (capture UI depends on `P10-DATA-01` existing, but
was not part of this approval round), `P10-CV-01`/`P10-CV-02` (would have no real annotated data to
run against), `P10-REVIEW-01`, `P10-RET-01`, `P10-COST-01`, or `P10-QA-01`. Those remain blocked
until `P10-RESEARCH-01` has actually produced its dataset card, or until a separate, explicit
approval extends this one.

## Consequences

- `P10-DATA-01` and `P10-ASYNC-01` may proceed now; once `P10-RESEARCH-01` produces a real dataset
  card, the packages that depend on it (`P10-IOS-01` onward) can be brought back for their own
  approval.
- The 90-day pilot retention exception must be enforced the same way the 30-day default is enforced
  elsewhere — an explicit, tested deletion job, not a documented intention.
- Every subsequent Phase 10 evaluation report should be checked against these thresholds by name, so
  a later change to them is visible as a deliberate amendment to this ADR rather than silent drift.
- The unit-cost ceiling remains genuinely unknown until Round 1 produces a real cost measurement;
  planning beyond the pilot should not assume a number that does not exist yet.

## Open Decisions Still Requiring the Owner

These were not resolved by this approval and remain open:

- Approve or reject Round 2 recruitment (opted-in beta users) versus staying at Round 1
  (internal-only) — a later decision, not required before `P10-RESEARCH-01`/`P10-DATA-01`/
  `P10-ASYNC-01` begin.
- Legal/privacy review sign-off for capturing neighboring private property, even incidentally —
  required before any actual capture session runs, i.e., before `P10-RESEARCH-01` collects real
  media, even though schema/plumbing work may proceed in parallel.
- The final per-unit cost ceiling, once Round 1 produces a real measurement.
- Approval to proceed past `P10-DATA-01`/`P10-ASYNC-01` into `P10-IOS-01` and later packages, once
  `P10-RESEARCH-01`'s dataset card exists.

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
