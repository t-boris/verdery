# Media Storage and Processing Design

> Status: Draft 0.3
> Decision status: Approved baseline  
> Last updated: July 24, 2026

## 1. Purpose

This document defines photo, video, plan, scan artifact, derivative, upload, download, processing, retention, and deletion architecture using PostgreSQL metadata and private Google Cloud Storage objects.

## 2. Principles

- Binary media bypasses the interactive API data path.
- PostgreSQL owns media identity, authorization, state, provenance, and retention.
- Cloud Storage object names are opaque infrastructure identifiers.
- All objects are private by default.
- Upload completion is verified before processing.
- The only local copy is never deleted before verified remote durability or deliberate user discard.
- Raw capture media has stricter retention than ordinary garden photos.

## 3. Media Classes

| Class             | Examples                                    | Baseline retention                             |
| ----------------- | ------------------------------------------- | ---------------------------------------------- |
| Garden photo      | Plant and observation photos                | Until user or garden deletion                  |
| Imported plan     | PDF, scan, raster plan                      | Until user or garden deletion                  |
| Raw capture       | Garden Scan video, AR artifacts, depth data | 30 days after successful extraction by default |
| Derived preview   | Thumbnail, optimized image, plan tiles      | Rebuildable; lifecycle-managed                 |
| Processing output | Masks, point clouds, diagnostics            | Policy by output type; raw diagnostics limited |
| Export package    | User-requested ZIP                          | Short-lived automatic expiration               |

Retention can be shortened by the user or legal/privacy policy. Failed raw capture is retained only long enough for recovery and support policy.

## 4. Storage Layout

Use separate buckets by environment and sensitivity/purpose where operationally useful:

```text
grow-garden-<env>-user-media
grow-garden-<env>-raw-capture
grow-garden-<env>-derived
grow-garden-<env>-exports
```

Bucket names are examples; versioned environment provisioning configuration owns actual names.

Object keys are opaque and contain no email, garden name, address, or user-entered filename:

```text
<shard>/<mediaUuid>/<objectUuid>
```

## 5. Media Record

PostgreSQL stores:

- Media UUIDv7.
- Owning garden and creating actor.
- Media class and purpose.
- Original display filename after safe normalization.
- Declared and verified content type.
- Declared and verified byte size.
- SHA-256 or approved integrity checksum.
- Bucket and object key.
- Upload state.
- Processing state.
- Capture or observation relationships.
- Sensitivity classification.
- Retention deadline and deletion state.
- Original/derivative relationships.

Signed URLs and resumable session URLs are not persisted as identity.

## 6. Upload State Machine

```text
registered
    │
    ▼
authorized
    │
    ▼
uploading
    │
    ▼
verifying ─────► rejected
    │
    ▼
available ─────► processing ─────► processed
    │                 └──────────► processing_failed
    ▼
deletion_scheduled ──► deleted
```

Transitions are server-owned and revisioned.

## 7. Upload Flow

1. Client submits metadata, purpose, size, content type, and checksum when available.
2. API authenticates, authorizes garden access, validates quota and type, and creates a media record.
3. API creates a backend-authorized resumable Cloud Storage upload session.
4. Client uploads directly to Cloud Storage and persists local progress.
5. Completion event or explicit client call triggers verification.
6. The synchronous completion command compares authoritative object metadata with the registration,
   then emits a durable `media.processing_requested` event.
7. A private validation worker reads the bytes, posts a structured result, and the API records the
   job/media terminal state.
8. Signed access remains blocked until validation succeeds. Derivative work may begin only after
   that success.

Upload authorization is single-purpose, short-lived, size-bounded where supported, and scoped to one object.

## 8. File Validation

Validation includes:

- Allowed media class and extension policy.
- MIME signature rather than filename alone.
- Maximum bytes and dimensions/duration where applicable.
- Decompression and parser-bomb protection.
- Checksum validation.
- Image metadata parsing in a sandboxed worker.
- Malware scanning for documents and other relevant formats.
- Rejection of active or unsupported content.

Unverified objects are isolated from normal downloads and processors.

### 8.1 Implemented validation profile (P6-WORKER-01)

Images and PDF/documents only. Raw capture (Garden Scan video, AR artifacts) is explicitly out of
scope for this stage — video duration/codec/frame-rate validation needs `ffprobe`, a native binary
dependency not yet in this stack, deliberately deferred to a later stage. A `raw_capture` manifest is
accepted at today's declared-metadata-trusted level without deep byte inspection; no video parser
exists anywhere in this pipeline.

| Media class       | Accepted types                    | Maximum bytes                              |
| ----------------- | --------------------------------- | ------------------------------------------ |
| Garden photo      | JPEG, PNG, WebP, HEIC, HEIF       | 25 MiB                                     |
| Imported plan     | Garden-photo raster types, PDF    | 50 MiB                                     |
| Raw capture       | Not deeply validated (see above)  | Declared byte size only, no worker ceiling |
| Derived preview   | Garden-photo raster types         | 50 MiB                                     |
| Processing output | Raster types, PDF                 | 1 GiB                                      |
| Export package    | No accepted validator profile yet | 2 GiB ceiling                              |

Raster dimension reading uses a pure-JS, header-only parser (no native image-decoding dependency, and
no full pixel decode) bounded to 40 megapixels and 16,384 pixels per axis — MIME signature is
verified separately, from magic bytes, also via a pure-JS detector. Never decoding pixel data is a
deliberate trade-off: the declared-dimension check plus the download's own streaming byte cap is this
stage's decompression/parser-bomb protection for images, at the cost of not catching corruption
confined entirely to a well-formed header's pixel payload. PDF preflight does not execute or
decompress content; it requires a valid envelope and cross-reference representation, limits documents
to 100 pages and 200 objects per page, and rejects encryption, JavaScript, launch actions, embedded
files, open actions, rich media, and XFA.

The current malware adapter is deliberately `unavailable`, not a fake clean result. PDF validation
therefore fails retryably until a provider is selected. Raster plans do not require the unavailable
document scanner and remain supported through the constrained image parser.

## 9. Image Derivatives

Approved image processing produces:

- Small thumbnail.
- Standard screen preview.
- High-resolution review image where required.
- Metadata-stripped derivative.

Orientation is normalized. EXIF location is removed from derivatives unless the product explicitly needs and authorizes it. Original metadata remains protected by original-object access policy.

Derivative generation is idempotent and addressed by source checksum plus transformation version.

## 10. Video Handling

Raw video validation records duration, dimensions, codec, frame rate, and audio presence. Unsupported codecs may be transcoded in a worker or rejected with actionable guidance.

Video processing uses Cloud Run Jobs or specialized compute. Workers read from private storage using service identity and write versioned outputs to a derived bucket.

Video byte content never travels through Pub/Sub or Cloud Tasks payloads.

## 11. Plan Documents

PDF and raster plans are treated as sensitive documents. Processing may produce:

- Page previews.
- Tile pyramids.
- OCR or line-extraction proposals.
- Calibration metadata.

Original documents remain private. Browser rendering uses approved derived assets or short-lived access rather than public object URLs.

## 12. Download Flow

The client requests access by stable media ID. The API:

1. Authenticates the actor.
2. Authorizes the media purpose and garden role.
3. Selects an appropriate original or derivative.
4. Returns a short-lived signed or authorized download mechanism.
5. Records sensitive raw-access audit information where policy requires it.

Operational viewer role may access ordinary accepted photos according to garden capability but not raw scan artifacts unless explicitly allowed.

Client access is different from viewer access. A client may download only a safe derivative or entitled original explicitly attached to a published client version, while the engagement is active and the publication remains visible. Garden ownership or media association alone does not make media client-visible.

## 13. Processing Manifest

Jobs receive a manifest containing:

- Job and media IDs.
- Input object references.
- Expected checksums.
- Media class, normalized display filename, expected content type, and expected byte size.
- Processor configuration version.
- Output object prefix or approved target IDs.
- Trace context.
- Callback or result-record contract.

The manifest contains no storage credentials. Workload identity grants access.

## 14. Processing Result

Workers publish or record:

- Processor version.
- Input checksums.
- Output objects and checksums.
- Structured result summary.
- Quality diagnostics.
- Resource and duration metrics.
- Terminal success, partial success, cancellation, or failure code.

The backend validates result ownership and expected job attempt before making derivatives visible.
The implemented path is Cloud Tasks → validation worker → authenticated API result callback. The
worker service account is checked at both inbound boundaries; the manifest and result contain no
credentials or signed URLs.

## 15. Retention and Lifecycle

Cloud Storage lifecycle rules perform only actions that align with PostgreSQL retention state and recovery policy.

- Raw successful capture defaults to deletion 30 days after extraction.
- Short-lived exports expire automatically after the communicated deadline.
- Rebuildable derivatives may transition to lower-cost storage or be regenerated.
- Ordinary user photos remain until deleted by user, garden, or account policy.
- Orphan detection reconciles objects without valid metadata and metadata without objects.

Lifecycle deletion must not race an active retry, support case, or legal hold.

## 16. Deletion Workflow

Deletion is asynchronous and idempotent:

1. Revoke new access.
2. Mark media deletion scheduled.
3. Cancel eligible pending processing.
4. Delete derivatives.
5. Delete original and raw objects.
6. Verify absence or record provider retry state.
7. Purge or minimize metadata according to audit policy.
8. Emit completion.

User-visible deletion remains pending until required objects are confirmed deleted or a recoverable provider failure is reported internally.

## 17. Quotas

Quotas are applied to:

- File size.
- Video duration.
- Garden and account stored bytes.
- Concurrent uploads.
- Processing submissions.
- Raw retention volume.
- Export generation.

Quota reservation and release are idempotent. A failed abandoned upload eventually releases reserved capacity.

## 18. Security

- Uniform bucket-level access.
- Public access prevention.
- Least-privilege service accounts.
- Separate read/write permissions by worker role.
- No long-lived service-account keys.
- Signed access with short expiration.
- Sensitive access audit where practical.
- App Check on upload-session creation.
- Egress restrictions for untrusted parsers.

The validation worker materializes inputs only in a per-job temporary directory with mode `0600`,
deletes it in a `finally` path, and never logs object bytes, user filenames, or URLs.

## 19. Observability

Measure:

- Registered but never started uploads.
- Upload completion and verification time.
- Checksum and type mismatch.
- Processing queue age and duration.
- Derivative failures.
- Stored bytes by class and environment.
- Raw media approaching retention deadline.
- Deletion lag and orphan count.

Logs use media ID and classification, not signed URLs, user filenames, addresses, or content.

## 20. Testing

- Resumable interruption and continuation.
- Duplicate completion notification.
- Declared versus actual type and size mismatch.
- Malformed image, video, and PDF fixtures.
- Active-content PDF, type spoofing, truncated image, checksum mismatch, and malware outcomes.
- Checksum mismatch.
- Unauthorized cross-garden access.
- Viewer access restrictions.
- Client publication-media entitlement, withdrawal, and engagement revocation.
- Internal media denial even when another item from the same work log is published.
- Derivative idempotency.
- Lifecycle and deletion race conditions.
- Orphan reconciliation.
- Account deletion across all buckets.

## 21. Completion Criteria

- Media bytes never pass through the interactive API.
- Unverified uploads cannot be processed or downloaded normally.
- Original and derivative identities are distinct and traceable.
- Raw scan retention is enforced and user-visible.
- Signed access cannot bypass garden authorization.
- Client media access requires both publication entitlement and current engagement authorization.
- Deletion reaches every derivative and processing artifact.
- Processing is reproducible from versioned manifests where retained inputs permit it.

## 22. Current implementation boundary

P6-WORKER-01 is implemented in `services/workers/src/validation` with a production Dockerfile and
unit/malicious-fixture coverage. The API result callback records success, partial, terminal failure,
or cancellation through revision-guarded domain transitions, and signed access requires a successful
validation state.

The worker image has not been deployed to `verdery-dev`. The existing Phase 6 platform follow-ups
still apply: worker Cloud SQL IAM connectivity, queue/service rollout, always-allocated CPU for the
interval relay, and selection/integration of a real malware scanner. P6-WORKER-02 derivatives are
not implemented.
