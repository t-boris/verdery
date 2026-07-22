# Garden Capture and Scan Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines the staged architecture for plan import, photo and video assistance, AR measurement, depth and LiDAR enhancement, reconstruction, proposal generation, quality reporting, and human review.

## 2. Product Position

Garden Scan is an optional accelerator, not a prerequisite for creating a garden. Users can always begin with a blank canvas, imagery, manual dimensions, or an imported plan.

Grow Garden is not a cadastral survey, engineering measurement, or construction-layout tool. Capture output carries uncertainty and must remain editable.

## 3. Staged Capability Plan

### Stage 1: Plan and Image Import

- Import PDF or raster plan.
- Render page/image preview.
- Calibrate with known distance.
- Trace lot, house, deck, fence, path, and beds.
- Optionally extract line proposals.

### Stage 2: Assisted Photo and Video Capture

- Capture guided property video or photographs.
- Record device motion and available camera metadata.
- Detect quality problems on device.
- Upload for frame extraction and object/line proposals.

### Stage 3: AR Measurement

- Mark points, lines, and planes with ARKit.
- Measure known references.
- Place anchors for structures and fence segments.
- Preserve tracking-quality diagnostics.

### Stage 4: Depth and LiDAR Enhancement

- Use supported depth and scene-reconstruction capabilities.
- Improve plane, edge, and obstacle proposals.
- Preserve a non-LiDAR fallback.

### Stage 5: Advanced Reconstruction

- Reconcile multiple captures.
- Run photogrammetry or specialized reconstruction where inputs support it.
- Produce versioned geometry proposals and quality evidence.

Each stage can ship and provide value without waiting for the next.

## 4. Hybrid Processing Boundary

### On Device

- Permission and safety guidance.
- Capability detection.
- Capture session lifecycle.
- AR tracking and immediate visual feedback.
- Basic blur, exposure, motion, coverage, and storage checks.
- Lightweight Vision/Core ML inference when evaluated.
- Local preview and explicit user confirmation.
- Recoverable media and session metadata.

### In Cloud

- Large media validation and transcoding.
- Frame sampling.
- Document and line extraction.
- Multi-frame association.
- Photogrammetry or reconstruction.
- Larger model inference.
- Cross-capture alignment.
- Reproducible proposal generation.
- Quality report and audit metadata.

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
- Start and end time.
- Media IDs.
- AR/world-map metadata references where retained.
- Calibration references.
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
- Audio is disabled by default unless a defined feature needs it and receives consent.

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

- Repositioning or deleting marked points.
- Entering an external measured distance for calibration.
- Reporting tracking degradation.
- Saving partial progress.
- Converting accepted measurements into ordinary map commands.

Raw AR framework objects are not persisted as domain geometry.

## 10. Video Capture Guidance

Guidance targets sufficient overlap and coverage without promising full automatic reconstruction. On-device checks may detect:

- Excessive motion blur.
- Insufficient light.
- Rapid rotation.
- Long featureless surfaces.
- Lost tracking.
- Missing coverage around a user-marked object.
- Excessive duration or storage use.

Quality checks are hints and preserve explainable codes.

## 11. Processing Pipeline

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

## 12. Processing Technologies

Approved technology categories include:

- Apple Vision and Core ML on device.
- ARKit for tracking, anchors, depth, and scene observations.
- Python, OpenCV, and evaluated geometry libraries in workers.
- Evaluated photogrammetry tooling such as COLMAP-class pipelines when licensing and compute requirements are approved.
- Vertex AI for evaluated model inference.
- External specialist processing behind a provider adapter when it outperforms owned pipelines and meets privacy requirements.

No single technology is assumed to solve every garden, surface, or lighting condition.

## 13. Proposal Model

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

## 14. User Review

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

## 15. Alignment and Reconciliation

Captures may be aligned through:

- Shared AR anchors where reliable.
- User-marked common control points.
- Known measurement references.
- Geographic anchor and heading.
- Image feature alignment.
- Existing accepted geometry.

Alignment records include residual errors. Conflicting captures produce alternatives or a user-review warning rather than an averaged false certainty.

## 16. Quality Model

Quality is multidimensional:

- Tracking stability.
- Image coverage.
- Blur and exposure.
- Calibration strength.
- Reconstruction residual.
- Object-class confidence.
- Agreement with accepted measurements.

The UI translates technical diagnostics into actionable recapture or manual-edit guidance.

## 17. Privacy and Retention

- Capture may include neighboring property and is classified as sensitive.
- Upload and remote processing are explained before transfer.
- Raw successful scan media defaults to deletion after 30 days.
- Users may delete raw media sooner when processing dependencies permit it.
- Derived accepted geometry remains until user deletion.
- Training use is prohibited without separate explicit consent and governance.
- Provider contracts must prohibit unauthorized model training on user content.

## 18. Failure and Recovery

Failures retain:

- Stable failure code.
- Completed stage checkpoints.
- Input availability.
- Retry eligibility.
- Recommended user action.

The user can retry transient processing without re-uploading intact media. Corrupt or insufficient capture requests recapture or manual editing.

## 19. Cost Controls

- Duration and file-size limits.
- Per-account concurrent capture processing.
- Stage-level early rejection of unusable input.
- Frame sampling before expensive reconstruction.
- CPU pipeline before GPU where sufficient.
- Explicit user confirmation before high-cost processing.
- Cached deterministic derivatives keyed by input and version.

## 20. Evaluation

Before enabling an automated capability, evaluate against a consented representative dataset covering:

- Lot sizes and layouts.
- Houses, decks, fences, paths, beds, and trees.
- Lighting and weather.
- Device tiers.
- Surface texture and occlusion.
- Regional vegetation.
- Ground-truth reference measurements.

Metrics include object precision/recall, geometric error, calibration error, user correction effort, processing success, processing cost, and safety incidents.

## 21. Testing

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

## 22. Completion Criteria

- Every advanced capture mode has a manual fallback.
- Processing outputs are proposals with provenance and uncertainty.
- Capture interruption does not lose completed recoverable work.
- Raw media retention is explicit and enforced.
- Stale proposals cannot overwrite newer garden revisions.
- Pipeline stages are independently observable, versioned, and retryable.
