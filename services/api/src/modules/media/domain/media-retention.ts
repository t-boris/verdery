/**
 * Retention policy per media class (P6-RET-01) — the single source both the
 * user-visible policy statement (`GetMediaRetentionPolicy`) and the
 * enforcing retention sweep (`RunMediaRetentionSweep`) read, so what a
 * client displays and what the server executes can never drift.
 *
 * Honesty rules this table:
 *
 * - `export_package` (7 days from registration) is the ONE duration-based
 *   rule computable today. Section 15 says exports "expire automatically
 *   after the communicated deadline" without naming a number anywhere in
 *   this repository; `09-media-storage.sh`'s exports-bucket lifecycle rule
 *   already chose and documented 7 days ("no number decided yet, pick one
 *   and say so"), and that script's own comment demands exactly this
 *   reconciliation: "If the API ever communicates a different deadline to
 *   the user than this bucket enforces, that mismatch needs reconciling in
 *   the application layer." This constant IS that reconciliation — the
 *   deadline `registerMediaRecord` stamps on an `export_package` row uses
 *   the same 7-day figure the live bucket rule enforces.
 * - `raw_capture` (30 days after successful extraction — section 3, and
 *   architecture/garden-capture-and-scan.md section 17) is DECLARED but
 *   `enforced: false`: the anchoring event has no producer until Garden
 *   Scan (Phase 10), so no raw-capture deadline is ever computed yet.
 *   Declaring the rule without claiming enforcement is the "user-visible
 *   raw-capture policy foundation" this work package's title names.
 * - Every other class has no duration-based rule at all ("Until user or
 *   garden deletion", "Rebuildable; lifecycle-managed" — section 3), so
 *   `retentionDays` is `null` and nothing is invented.
 *
 * The staleness window for orphan reconciliation also lives here: 7 days.
 * Grounded, not arbitrary — a Cloud Storage resumable upload session is
 * only resumable for one week, so a registration older than that whose
 * upload never completed can never complete; it matches the exports
 * bucket's own 7-day precedent as this repository's one established
 * short-retention figure.
 *
 * Source: architecture/media-storage-and-processing.md, sections "3. Media
 * Classes", "15. Retention and Lifecycle", "17. Quotas";
 * architecture/garden-capture-and-scan.md, section "17. Privacy and
 * Retention"; infrastructure/gcloud/scripts/09-media-storage.sh.
 */

import type { MediaClass } from './media-record.js';

/** Mirrors the contract's `MediaRetentionAnchor` — kept as a separate domain declaration per this module's "domain does not import contract types" boundary. */
export type MediaRetentionAnchor = 'none' | 'registration' | 'successful_extraction';

export interface MediaClassRetentionRule {
  readonly mediaClass: MediaClass;
  readonly retentionDays: number | null;
  readonly anchor: MediaRetentionAnchor;
  readonly enforced: boolean;
  readonly summary: string;
}

export const EXPORT_PACKAGE_RETENTION_DAYS = 7;
export const RAW_CAPTURE_RETENTION_DAYS = 30;

/** See this file's own header comment for the grounding of this figure. */
export const STALE_UPLOAD_RECONCILIATION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ordered as section 3's own class table is. */
export const MEDIA_RETENTION_RULES: readonly MediaClassRetentionRule[] = [
  {
    mediaClass: 'garden_photo',
    retentionDays: null,
    anchor: 'none',
    enforced: false,
    summary: 'Kept until you delete it, or its garden or account is deleted.',
  },
  {
    mediaClass: 'imported_plan',
    retentionDays: null,
    anchor: 'none',
    enforced: false,
    summary: 'Kept until you delete it, or its garden or account is deleted.',
  },
  {
    mediaClass: 'raw_capture',
    retentionDays: RAW_CAPTURE_RETENTION_DAYS,
    anchor: 'successful_extraction',
    enforced: false,
    summary:
      'Raw scan captures are deleted 30 days after their content is successfully extracted; you may delete them sooner.',
  },
  {
    mediaClass: 'derived_preview',
    retentionDays: null,
    anchor: 'none',
    enforced: false,
    summary: 'Rebuildable previews are deleted together with their original.',
  },
  {
    mediaClass: 'processing_output',
    retentionDays: null,
    anchor: 'none',
    enforced: false,
    summary: 'Processing artifacts are deleted together with their source media.',
  },
  {
    mediaClass: 'export_package',
    retentionDays: EXPORT_PACKAGE_RETENTION_DAYS,
    anchor: 'registration',
    enforced: true,
    summary: 'Export packages expire automatically 7 days after they are created.',
  },
];

/**
 * The `retentionDeadlineAt` a freshly registered record starts with:
 * `export_package` gets `registration + 7 days` (the one enforced,
 * registration-anchored rule above); every other class gets `null` — the
 * raw-capture rule cannot be computed at registration because its anchor
 * (successful extraction) has not happened, and the remaining classes have
 * no duration-based rule at all.
 */
export function deriveDefaultRetentionDeadline(mediaClass: MediaClass, now: Date): Date | null {
  if (mediaClass !== 'export_package') {
    return null;
  }

  return new Date(now.getTime() + EXPORT_PACKAGE_RETENTION_DAYS * DAY_MS);
}

/** The cutoff before which a still-pre-`available` registration is considered abandoned — see this file's own header comment. */
export function staleUploadCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_UPLOAD_RECONCILIATION_DAYS * DAY_MS);
}
