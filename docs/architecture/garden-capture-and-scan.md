# Garden Capture and Reconstruction Research Design

> Status: Draft 0.3
> Decision status: Approved baseline  
> Last updated: July 28, 2026

## 1. Purpose

This document defines the architecture for plan import, voice-guided AR mapping, geographic
alignment, AR measurement, depth and LiDAR enhancement, solar and shadow context, synchronization,
and the bounded research questions that remain for possible automated reconstruction.

## 2. Product Position

Plan import and Phase 12 voice-guided AR mapping are product capabilities. Automated multi-capture
reconstruction is not a committed release phase or product surface. It may return to the roadmap
only after Phase 12 evidence, a bounded benchmark, and a new owner-approved ADR demonstrate that it
reduces total user effort at acceptable quality, privacy, reliability, and cost.

Grow Garden is not a cadastral survey, engineering measurement, or construction-layout tool. Capture output carries uncertainty and must remain editable.

## 3. Staged Capability Plan

### Stage 1: Plan and Image Import

- Import PDF or raster plan.
- Render page/image preview.
- Calibrate with known distance.
- Trace lot, house, deck, fence, path, and beds.
- Optionally extract line proposals.

### Stage 2: Voice-Guided AR Measurement

- Select semantic object types through bounded voice commands or equivalent touch controls.
- Mark points, lines, polygons, and height references with ARKit.
- Measure known references.
- Create lot, structure, deck, fence, path, bed, zone, tree, plant, and annotation geometry.
- Chain long boundaries through recoverable checkpoints and shared control points.
- Establish a geographic anchor, confirmed address, and true-north orientation when permitted.
- Preserve tracking-quality diagnostics.

### Stage 3: Depth and LiDAR Enhancement

- Use supported depth and scene-reconstruction capabilities.
- Improve plane, edge, and obstacle proposals.
- Preserve a non-LiDAR fallback.

### Future Research: Automated Reconstruction

- Identify a material mapping problem that remains after Phase 12.
- Compare a deliberately guided multi-capture approach with the Phase 12 effort and correction
  baseline.
- Evaluate reconstruction technology, privacy, provider rights, reproducibility, and unit economics.
- Require a new ADR and newly numbered delivery phase before any production implementation.

The future research track is not Stage 4 and carries no delivery commitment.

## 4. Hybrid Processing Boundary

### On Device

- Permission and safety guidance.
- Capability detection.
- Capture session lifecycle.
- AR tracking and immediate visual feedback.
- Contextual speech recognition, deterministic command parsing, and optional spoken feedback.
- Device location, heading, reverse-geocoding request, and user confirmation.
- Solar-position calculation and interactive shadow preview where inputs are sufficient.
- Basic blur, exposure, motion, coverage, and storage checks.
- Lightweight Vision/Core ML inference when evaluated.
- Local preview and explicit user confirmation.
- Recoverable media and session metadata.

### In Cloud

- Large media validation and transcoding.
- Document and line extraction.
- Quality report and audit metadata.

Frame sampling, multi-frame association, photogrammetry, semantic extraction, cross-capture
reconstruction, and specialist model inference are not approved production capabilities. They may be
used only in a separately authorized disposable research benchmark until
`RECON-DECISION-01` approves a delivery phase.

## 5. Capture Capability Tiers

The native client reports capabilities, not marketing model names:

- Camera only.
- Camera plus reliable AR world tracking.
- Camera plus depth.
- Camera plus LiDAR scene reconstruction.
- Unsupported or constrained mode.

The backend does not trust client capability claims for security. Claims select processing expectations and are verified against actual artifact metadata where possible.

## 6. Capture Session

A capture session record contains:

- Session and garden IDs.
- Capture purpose.
- Device capability class.
- Application and schema version.
- Local coordinate-space reference.
- Optional geographic anchor and georeference revision.
- Session heading, heading accuracy, and relationship to the garden true-north orientation.
- Start and end time.
- Media IDs.
- AR/world-map metadata references where retained.
- Calibration references.
- Voice-command locale and command events without retained raw audio by default.
- Checkpoints, committed points, active object, and partial geometry state.
- Quality observations.
- Upload and processing state.
- User cancellation or completion state.

The session is persisted before large capture begins and can recover after process termination.

## 7. Safety UX Requirements

- The user is not instructed to walk backward while watching the screen.
- Capture guidance pauses when tracking quality is poor.
- The application warns about traffic, obstacles, stairs, and private neighboring property in appropriate onboarding.
- Camera use and recording state are continuously visible.
- Capture can stop safely without losing completed segments.
- Audio is disabled by default outside a defined feature. Voice-guided capture requests microphone
  access contextually, displays a continuous recording indicator, establishes a clear
  push-to-talk or session recording boundary, and retains no raw audio by default.

## 8. Plan Import Flow

```text
select document
      │
      ▼
local preview and safety validation
      │
      ▼
register and upload private media
      │
      ▼
render/extract pages and line proposals
      │
      ▼
user selects page and known measurement
      │
      ▼
calibration with residual error
      │
      ▼
trace or accept editable object proposals
```

OCR or line extraction never asserts scale without a trusted reference.

## 9. AR Measurement Flow

ARKit observations are converted into application-owned records containing points, confidence, transform, tracking state, and session reference.

The application supports:

- Naming the active semantic object through a bounded voice command or equivalent touch selection.
- Selecting physical points explicitly through a camera reticle and commit action.
- Repositioning or deleting marked points.
- Pausing at a long-boundary checkpoint and resuming from shared control points.
- Entering an external measured distance for calibration.
- Reporting live segment length, cumulative length, perimeter, area, and uncertainty.
- Reporting tracking degradation.
- Saving partial progress after every committed point.
- Converting accepted measurements into ordinary map commands.

Raw AR framework objects are not persisted as domain geometry.

### 9.1 Voice Command Boundary

Voice control is a constrained capture interface, not the conversational assistant planned for a
later phase. Speech recognition produces one of a fixed set of commands:

```text
recognized speech
       │
       ▼
bounded intent and object vocabulary
       │
       ▼
deterministic capture state transition
       │
       ▼
visible effect or explicit confirmation
       │
       ▼
application-owned map command
```

The initial command set covers:

- Start or name an object.
- Add, move, or remove a point.
- Continue a line or add a corner.
- Close or finish an object.
- Undo, pause, resume, save, or discard.
- Confirm or reject a low-confidence interpretation.

The active object type and expected physical action remain visible. Speech never chooses an
unobserved physical point, and low-confidence recognition never mutates geometry without
confirmation. Touch, accessibility actions, and localized text labels provide complete parity.

### 9.2 Long Boundary Capture

A long lot edge is a sequence of independently recoverable segments rather than one assumed-stable
AR track. Each checkpoint retains its measured transform, tracking quality, heading evidence,
shared control points, cumulative uncertainty, and relationship to neighboring segments. The
application pauses and asks for a checkpoint when tracking quality or accumulated error crosses an
approved threshold.

A user may stop, move to the next suitable observation position, realign to known points, and
continue. GPS and geographic imagery constrain approximate global placement but do not establish a
legal boundary or replace local measurements. The field UI reports both per-segment and accumulated
uncertainty, especially for distances on the order of hundreds of metres.

### 9.3 Geographic Initialization

With permission, the native client obtains a location and accuracy, requests an approximate address,
and proposes a true-north orientation. The user confirms, edits, replaces, or omits the result. A
device heading is session evidence only; the accepted garden georeference is a separately revised
record.

Initialization supports:

- Current device location.
- Address search or manual map pin.
- Manual north rotation.
- Alignment to geographic imagery.
- Two or more known control points.
- A fully local garden with no geographic data.

The exact address and coordinate are sensitive. Raw values are excluded from logs and analytics and
are not part of a client publication unless explicitly selected under the applicable sharing policy.

### 9.4 Solar and Shadow Context

Source imagery may contain shadows from its unknown or historical acquisition time. Those pixels
remain reference evidence and are never presented as a current forecast.

Dynamic shadow context is calculated from:

- Geographic anchor and true-north orientation.
- Selected date and time.
- Accepted obstacle footprints.
- Known or estimated structure, fence, tree, canopy, and terrain heights.
- Input provenance, accuracy, and missing-obstacle declarations.

The application may estimate nearby heights through supported AR or depth observations, but every
height remains editable and uncertainty-bearing. The shared analysis result includes a model
version, input revisions, time interval, shadow geometry or bounded raster representation,
direct-sun duration where supported, quality summary, and missing-input reasons. iOS provides a
field preview; web provides the larger editing view and time/season exploration.

### 9.5 Acceptance and Synchronization

Every committed point is written atomically to the local capture-session projection. Finishing an
object creates an editable proposal with measurement provenance. User acceptance converts it into
ordinary revision-guarded map commands and queues it through the application-owned offline
synchronization protocol.

The web client receives accepted objects through the same garden map model and displays their source,
uncertainty, capture time, author, and synchronization state. It does not depend on ARKit objects or
opaque world-map state. Rejected or incomplete proposals remain separate from accepted geometry.

## 10. Future Research: Automated Reconstruction

Sections 10.1 through 10.13 define evaluation and safety constraints for a possible disposable
benchmark. They do not authorize a production pipeline, client flow, provider contract, raw-media
collection program, or release commitment.

### 10.1 Candidate Capture Guidance

Guidance targets sufficient overlap and coverage without promising full automatic reconstruction. On-device checks may detect:

- Excessive motion blur.
- Insufficient light.
- Rapid rotation.
- Long featureless surfaces.
- Lost tracking.
- Missing coverage around a user-marked object.
- Excessive duration or storage use.

Quality checks are hints and preserve explainable codes.

### 10.2 Candidate Processing Pipeline

```text
verified source media
        │
        ▼
manifest creation
        │
        ▼
frame/document normalization
        │
        ▼
feature and candidate extraction
        │
        ▼
alignment/reconstruction where supported
        │
        ▼
domain object proposal generation
        │
        ▼
PostGIS validation and quality scoring
        │
        ▼
user review package
```

Each stage records version, input checksum, output reference, duration, and outcome. A later stage cannot silently reinterpret artifacts from an incompatible earlier version.

### 10.3 Candidate Processing Technologies

Technology categories that a future benchmark may evaluate include:

- Apple Vision and Core ML on device.
- ARKit for tracking, anchors, depth, and scene observations.
- Python, OpenCV, and evaluated geometry libraries in workers.
- Evaluated photogrammetry tooling such as COLMAP-class pipelines when licensing and compute requirements are approved.
- Vertex AI for evaluated model inference.
- External specialist processing behind a provider adapter when it outperforms owned pipelines and meets privacy requirements.

No single technology is assumed to solve every garden, surface, or lighting condition.

### 10.4 Candidate Proposal Model

A proposal package contains:

- Proposal ID and source capture.
- Processor pipeline and model versions.
- Coordinate space and alignment transform.
- Proposed typed objects.
- Per-object confidence.
- Quality and validation findings.
- Supporting preview overlays.
- Known limitations.
- Expiration or reprocessing eligibility.

Proposals are immutable. User edits create an acceptance draft and then ordinary domain commands.

### 10.5 Candidate User Review

The review interface allows:

- Toggle proposal overlay.
- Compare with accepted map.
- Inspect confidence and source.
- Accept individual objects.
- Edit geometry before acceptance.
- Reject individual objects or the entire package.
- Retain existing accepted geometry.
- Report a processing problem.

Bulk acceptance requires a clear change summary and revision precondition.

### 10.6 Alignment Reuse

A research benchmark must reuse Phase 12 alignment records and accepted geometry where possible
rather than build a second garden-coordinate authority. Candidate evidence may include:

- Shared AR anchors where reliable.
- User-marked common control points.
- Known measurement references.
- Geographic anchor and heading.
- Image feature alignment.
- Existing accepted geometry.

Alignment records include residual errors. Conflicting captures produce alternatives or a user-review warning rather than an averaged false certainty.

### 10.7 Research Quality Model

Quality is multidimensional:

- Tracking stability.
- Image coverage.
- Blur and exposure.
- Calibration strength.
- Reconstruction residual.
- Object-class confidence.
- Agreement with accepted measurements.

The UI translates technical diagnostics into actionable recapture or manual-edit guidance.

### 10.8 Research Privacy and Retention

- Capture may include neighboring property and is classified as sensitive.
- Upload and remote processing are explained before transfer.
- No raw reconstruction dataset or production scan media collection is authorized by this document.
- If a future ADR authorizes retained raw capture, successful-source retention must default to no
  more than 30 days after extraction unless a separately reviewed shorter policy applies.
- Users may delete raw media sooner when processing dependencies permit it.
- Derived accepted geometry remains until user deletion.
- Training use is prohibited without separate explicit consent and governance.
- Provider contracts must prohibit unauthorized model training on user content.

### 10.9 Candidate Failure and Recovery

Failures retain:

- Stable failure code.
- Completed stage checkpoints.
- Input availability.
- Retry eligibility.
- Recommended user action.

The user can retry transient processing without re-uploading intact media. Corrupt or insufficient capture requests recapture or manual editing.

### 10.10 Research Cost Model

- Duration and file-size limits.
- Per-account concurrent capture processing.
- Stage-level early rejection of unusable input.
- Frame sampling before expensive reconstruction.
- CPU pipeline before GPU where sufficient.
- Explicit user confirmation before high-cost processing.
- Cached deterministic derivatives keyed by input and version.

### 10.11 Evaluation

Before enabling an automated capability, evaluate against a consented representative dataset covering:

- Lot sizes and layouts.
- Houses, decks, fences, paths, beds, and trees.
- Lighting and weather.
- Device tiers.
- Surface texture and occlusion.
- Regional vegetation.
- Ground-truth reference measurements.

Metrics include object precision/recall, geometric error, calibration error, user correction effort, processing success, processing cost, and safety incidents.

### 10.12 Candidate Testing

- Capture lifecycle interruption.
- Permission denial and later grant.
- Tracking degradation.
- Partial uploads.
- Duplicate processing submission.
- Stale proposal acceptance.
- Multi-capture alignment disagreement.
- Raw retention expiration.
- Processor-version reproducibility.
- Malicious and malformed media.
- User rejection preserving accepted geometry.

### 10.13 Promotion Criteria

- Phase 12 evidence identifies a material unsolved mapping problem.
- The benchmark shows lower total user effort after correction than the Phase 12 baseline.
- Accuracy, privacy, licensing, reproducibility, failure, and unit-economics thresholds pass.
- A new ADR reconciles the chosen modality with ADR-0015.
- A newly numbered phase defines production work packages, manual fallback, proposal-only output,
  retention enforcement, stale-revision protection, observability, and release evidence.
