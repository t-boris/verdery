# ADR-0015: Redirect Phase 10 — Real Plant Identification Over Photo-Based Garden-Object Capture

> Status: Accepted
> Date: July 28, 2026
> Approved: July 28, 2026, by the project owner, following an extended planning discussion

## Context

Planning P10-DATA-01/P10-ASYNC-01 under ADR-0014 prompted a re-examination of Phase 10's actual
value proposition: casual photo/video capture of a garden, processed by AI to propose object/line
candidates (fences, beds, paths). Two problems surfaced in discussion with the owner:

1. **The manual alternative already works and is likely simpler.** The map editor's exact-dimension
   entry (shipped earlier this session) lets a user type a fence's length or a bed's width/depth
   directly. For regular shapes, this is plausibly less effort than photographing the object,
   waiting for cloud processing, and reviewing/correcting an AI proposal — the opposite of Phase
   10's own stated goal (`implementation-plan.md` section 19.4: "Evaluation shows lower user effort
   for the selected use cases at approved quality and cost").
2. **A better mechanism already exists in the plan.** Phase 11 ("AR and LiDAR Measurement") lets a
   user mark points/lines/polygons on site, in real time, via ARKit — giving live, on-device
   measurement without photographing anything or waiting on server-side recognition. For an
   irregular bed or a complex lot boundary specifically (the cases where manual entry is genuinely
   tedious), AR marking is a closer fit than photo-based recognition: it produces a real geometric
   trace at the actual scale, not a 2D image an AI model has to reinterpret.

Separately, the owner identified that this codebase already has a real, higher-value, lower-risk
place for photo-based AI that was sitting on a placeholder: `plants-inventory/application/
identify-plant-from-photo.ts` (species suggestion when adding a plant from a photo) and
`observations-history/domain/image-analysis-result.ts` (`analyzeObservationPhoto`, condition/
health/pest/disease observation) both currently return fixed, non-functional stub values. The
owner explicitly named plant identification and tracking as "probably the most important part of
the application," and required it be built for real, not stubbed.

This ADR does not reopen ADR-0014's actual approvals (`P10-RESEARCH-01`, `P10-DATA-01`,
`P10-ASYNC-01` remain as that ADR left them) — it changes what Phase 10 is _for_.

## Decision

### Photo-based garden-object capture (the original Phase 10 Stage 2) is not pursued

`P10-CV-01`, `P10-CV-02`, and `P10-REVIEW-01` (candidate extraction, proposal packaging, and
proposal review UI for casually-photographed garden objects) are removed from the plan, not merely
deferred. The consented-capture-dataset gate ADR-0014 built for exactly this use case
(`P10-RESEARCH-01`'s representativeness axes, thresholds, and Round 1/2 recruitment plan) is no
longer needed for it. Garden-layout capture is served instead by:

- **Manual dimension entry** (shipped), for regular shapes a user can measure or estimate directly.
- **Phase 11 AR marking** (planned, unchanged), for irregular shapes and complex boundaries, via
  on-site, real-time measurement rather than photograph-and-recognize.

`P10-DATA-01`'s capture-session schema is **not discarded** — its fields (device capability class,
coordinate-space reference, session/processing state, cancellation/recovery) were already designed
generically enough to serve an AR capture session, not only a photo/video one (see
`garden-capture-and-scan.md` section 6, which describes the capture-session concept across all
capture stages, not Stage 2 specifically). It is retained as Phase 11 groundwork.
`P10-ASYNC-01`'s job-queue plumbing is **not currently needed**: a single Gemini call for plant
identification runs synchronously within an ordinary request (matching how the existing
recommendation-explanation adapter already works — a direct call, no queue), and nothing else in
the retained scope produces long-running background work. It is deferred, not deleted from the
architecture; it returns if Phase 11 or Phase 12 introduces genuinely long-running processing.

Property-plan OCR/vectorization (Stage 1: importing an existing plan document/image, distinct from
photographing the live garden) is unaffected by this decision and remains in scope where already
planned.

### Real plant photo identification and condition tracking becomes Phase 10's AI-facing deliverable

Two existing stubs are replaced with a real provider, using the same architecture-approved
technology category and adapter idiom this codebase already uses for Vertex AI (`ADR-0008`,
`recommendations-and-ai.md`):

1. **Species identification** (`identify-plant-from-photo.ts`, called from `AddPlantFromPhoto`):
   a real Gemini call suggests a taxonomy candidate with a confidence score. The existing safety
   design is unchanged and remains correct as-is: the suggestion never auto-confirms
   (`plant.taxonomyReferenceId` stays `null` until a separate `ConfirmPlantIdentification` call),
   and it never touches toxicity/edibility data — those remain human-authored from a cited source
   per `ADR-0013`, which this feature does not reopen. Identifying a photographed plant as
   "probably this already-reviewed taxon" is species matching, not new fact generation.
2. **Condition tracking** (`image-analysis-result.ts`, `analyzeObservationPhoto`): a real Gemini
   call evaluates a photo of an _already-known, user-selected_ plant (the user opens that plant's
   own record and adds the photo — confirmed explicitly with the owner as the only supported flow;
   no location/GPS-based disambiguation among same-species plants is needed, since the plant is
   already unambiguous from context) for stress/disease/pest signals, compared against that plant's
   own photo history. `requiresConfirmation` stays hardcoded `true`, matching the existing type.

Both are a materially lower-risk use of AI than the abandoned garden-object recognition: species
and condition suggestions are always human-reviewed before affecting any record, general plant
recognition is broadly capable off the shelf (no in-house training dataset required, unlike the
abandoned use case), and neither generates toxicity/edibility claims.

### What must happen before enabling either capability outside development

Mirroring `ADR-0014`'s own approval shape (a kill switch until an evidence bar is met), not a new
process:

- A manual spot-check of the real adapter against a representative sample of real garden-plant
  photos (owner-run, informal — this is a much lighter bar than `ADR-0014`'s pilot, because the
  underlying model is not being trained or newly evaluated for a domain it has never seen, only
  spot-checked for adequacy).
- Confirmation of the provider's current data-training/retention terms for image content — the
  same owner-only action `ADR-0014`'s discussion already identified as unverifiable from within
  this repository, since `aiplatform.googleapis.com` is not yet enabled anywhere and this
  codebase's own privacy-notice draft already flags Vertex AI's terms as "unverified" even for the
  existing text-only use.
- Until both are recorded, both capabilities ship real and callable, gated by a kill-switch flag
  defaulting to `false` (the same `RECOMMENDATION_AI_EXPLANATION_ENABLED` idiom already used
  elsewhere), not a placeholder implementation.

## Consequences

- Phase 10's work-package table (`implementation-plan.md` section 19.3) is rewritten: `P10-CV-01`,
  `P10-CV-02`, `P10-REVIEW-01`, `P10-RET-01`, `P10-COST-01` removed (they existed only to serve the
  abandoned use case); `P10-RESEARCH-01` removed (no dataset collection is required for what
  remains); `P10-IOS-01`/`P10-IOS-02` removed (AVFoundation-based guided photo/video capture UI —
  Phase 11's own AR session lifecycle work package supersedes this need); `P10-DATA-01` retained,
  reattributed as Phase 11 groundwork; `P10-ASYNC-01` deferred; two new work packages added for
  plant identification/condition tracking.
- Phase 11's `P11-IOS-01` dependency on "P10 capture coordinator" is corrected to depend on
  `P10-DATA-01`'s session schema directly, since the AVFoundation capture-coordinator work package
  it previously named no longer exists.
- `ADR-0014`'s status becomes Superseded by this ADR for the photo-object-recognition use case it
  gated; its `P10-DATA-01`/`P10-ASYNC-01` approvals and its general reasoning about consented
  evaluation data remain valid and are not overturned — they simply no longer have anything in the
  current plan to authorize beyond what this ADR already accounts for.
- The next real product work this unlocks is replacing the two stubs, not building new schema or
  infrastructure — a smaller, more contained change than anything ADR-0014 originally gated.

## Rejected Alternatives

- **Keep photo-based garden-object recognition as a lower-priority backlog item instead of
  removing it:** rejected. Nothing about it improved once AR entered the comparison — it was worse
  on effort (an extra photograph-and-wait step), worse on accuracy (2D image reinterpretation vs.
  real on-site measurement), and worse on cost (a cloud CV pipeline vs. on-device ARKit). Keeping a
  clearly-inferior approach on the backlog serves no one.
- **Add plant identification as a new phase instead of folding it into Phase 10:** considered, but
  rejected as unnecessary process — Phase 10's own numbering already exists in the owner's and this
  document's working vocabulary for "the AI-assisted capture work in progress," and the underlying
  work (replacing two already-identified stubs) is small enough not to need its own phase
  apparatus (research gate, exit criteria, forecast range).
