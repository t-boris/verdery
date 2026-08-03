-- Near-duplicate photo detection: a 64-bit difference hash of an image's
-- own pixels, alongside the SHA-256 of its bytes.
--
-- `checksum_sha256` answers "these exact bytes are already here". It cannot
-- answer "this looks like the photograph you uploaded last week", because a
-- re-encode, a resize, or a gallery export changes every byte while the
-- picture stays the same. That is the case a gardener photographing the
-- same plant repeatedly actually produces.
--
-- STORED AS HEX TEXT, exactly like `checksum_sha256` beside it, with the
-- same shape of CHECK. One representation travels the whole stack — worker,
-- contract, domain, row — with no conversion layer to get wrong.
-- Hamming distance is still a real SQL predicate rather than an
-- application-side loop, because PostgreSQL casts hex to bits directly:
-- `bit_count(('x' || perceptual_hash)::bit(64) # ('x' || $1)::bit(64))`.
--
-- Nullable on purpose, and no default. A media record predating this
-- column, one whose class is not an image, and one whose derivative job
-- could not decode the bytes all legitimately have no hash; the duplicate
-- warning degrades to the exact-bytes check for them rather than failing.
-- No index: the query is always garden-scoped and bounded by that garden's
-- own photo count, and a Hamming-distance predicate is not indexable by
-- b-tree anyway. Adding one later needs a measured reason.
--
-- Source: tasks/todo.md, "P11 remainder — the two engineering gaps,
-- decided (2026-08-03)"; architecture/media-storage-and-processing.md,
-- section 9; implementation-plan.md work package P11-MEDIA-01.

-- Up Migration

ALTER TABLE media.media_record
  ADD COLUMN perceptual_hash text;

ALTER TABLE media.media_record
  ADD CONSTRAINT media_record_perceptual_hash_format_check
    CHECK (perceptual_hash IS NULL OR perceptual_hash ~ '^[0-9a-f]{16}$');

COMMENT ON COLUMN media.media_record.perceptual_hash IS
  'dHash of the source image''s pixels; NULL when none was computed. Advisory only — used to warn about near-duplicate uploads, never to reject one.';

-- Down Migration

ALTER TABLE media.media_record
  DROP CONSTRAINT media_record_perceptual_hash_format_check;

ALTER TABLE media.media_record
  DROP COLUMN perceptual_hash;
