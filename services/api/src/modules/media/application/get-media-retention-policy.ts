/**
 * `GetMediaRetentionPolicy` (P6-RET-01): the user-visible statement of
 * section 15's retention rules — a pure mapping of
 * `domain/media-retention.ts`'s own table (the single source the retention
 * sweep also enforces from) onto the contract shape. No repository, no
 * authorization beyond the ordinary authenticated pipeline: policy is
 * product-wide static data, not per-garden state.
 *
 * This is the "user-visible raw-capture policy foundation" the work
 * package's title names, scoped honestly: the raw-capture rule is DECLARED
 * (30 days after successful extraction, `enforced: false`) so clients can
 * already present it, while enforcement waits for the extraction event
 * Garden Scan (Phase 10) will produce — see the contract operation's own
 * description.
 */

import type { MediaRetentionPolicyResult } from '@verdery/api-contracts';
import { MEDIA_RETENTION_RULES } from '../domain/media-retention.js';

export class GetMediaRetentionPolicy {
  execute(): MediaRetentionPolicyResult {
    return {
      policies: MEDIA_RETENTION_RULES.map((rule) => ({
        mediaClass: rule.mediaClass,
        retentionDays: rule.retentionDays,
        anchor: rule.anchor,
        enforced: rule.enforced,
        summary: rule.summary,
      })),
    };
  }
}
