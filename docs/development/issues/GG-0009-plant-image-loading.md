# GG-0009: Plant photos load through per-image request waterfalls and original assets

| Field          | Value               |
| -------------- | ------------------- |
| Status         | `analyzed`          |
| Severity       | `SEV-4`             |
| Surface        | `web / API / media` |
| Code finding   | `supported`         |
| First reported | `2026-08-31`        |
| Last updated   | `2026-08-31`        |

## Summary

The Plants list returns a primary media ID but no display derivative or access URL. Every visible
photo then performs one API request for media status, a dependent request for a short-lived signed
URL, and finally the object download. Because the list cannot select a thumbnail, it downloads the
original into a 118 px cover. The detail gallery repeats the same work for every specimen photo.

## Code analysis

Supported structural causes:

- `SearchPlants` batches the primary media IDs, so the plant database query itself is not N+1.
  The web list then mounts `usePlantPhotoAccess` once per cover.
- Each hook first calls `GET /media/{id}` and only after `processingState === processed` calls
  `GET /media/{id}/access`. A page of 20 covers can therefore add 40 API requests before image
  bytes begin. The two-step gate is correct for unprocessed uploads but creates a verified
  sequential waterfall for already processed photos.
- The `Plant` contract exposes only `coverMediaId`, not derivative metadata. Unlike the general
  media preview, the plant list and gallery cannot choose `thumbnail` or `screen_preview`; signed
  access therefore serves the original object.
- The browser uses plain `<img>` for signed URLs. List covers are lazy-decoded, which helps initial
  rendering but not transferred bytes. The specimen gallery has no explicit lazy-loading, and its
  resolved lightbox uses the same original URL.
- Licensed taxon reference images bypass signed access, but every image is marked `loading=eager`
  and uses the provider's source URL without a requested display size or local transformation.
- Signed-access query data is fresh for only five minutes. Browser/object caching depends on the
  stored object's metadata; no cache policy is established by this web path.

Runtime latency, object byte sizes, derivative availability, and provider response headers were not
measured in an authenticated deployed session, so their relative contribution remains environment
dependent. The request count and original-selection problem are code-confirmed.

## Recommended resolution

1. Extend the plant list/photo response with a ready display derivative ID (prefer thumbnail for
   list, screen preview for gallery) and either a batch access result or a same-origin authorized
   media delivery URL.
2. Collapse status and access into one read for known-ready media, while preserving a typed
   processing state for uploads that are not ready.
3. Fetch covers in one batch or bounded queue and prefetch the selected lightbox image only when
   the user opens it.
4. Request appropriately sized licensed reference assets when the provider supports variants;
   otherwise lazy-load images below the fold.
5. Add request-count and transferred-size budgets for 20 list items, plus timing instrumentation
   separating list API, access signing, object TTFB, and decode.

## Acceptance criteria

- A 20-plant page does not make two serialized API calls per cover.
- List cards never download full originals when a processed thumbnail exists.
- Opening a specimen image uses a screen-sized derivative and can obtain the original only for an
  explicit full-resolution action.
- Processing, failed, unavailable, and authorized states remain distinguishable.
- Signed URL expiry and cache behavior are tested without exposing URLs in logs.
- Reference images below the initial viewport are not all eager-loaded.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: none

## History

| Date       | Change                                                          |
| ---------- | --------------------------------------------------------------- |
| 2026-08-31 | Traced list, signed-access, derivative, and image-render paths. |
