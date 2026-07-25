import { describe, expect, it } from 'vitest';
import {
  deriveDefaultRetentionDeadline,
  EXPORT_PACKAGE_RETENTION_DAYS,
  MEDIA_RETENTION_RULES,
  RAW_CAPTURE_RETENTION_DAYS,
  STALE_UPLOAD_RECONCILIATION_DAYS,
  staleUploadCutoff,
} from './media-retention.js';
import type { MediaClass } from './media-record.js';

const NOW = new Date('2026-07-21T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('MEDIA_RETENTION_RULES', () => {
  it('declares exactly one rule per media class, in section 3 table order', () => {
    expect(MEDIA_RETENTION_RULES.map((rule) => rule.mediaClass)).toEqual([
      'garden_photo',
      'imported_plan',
      'raw_capture',
      'derived_preview',
      'processing_output',
      'export_package',
    ]);
  });

  it('declares the raw-capture rule (30 days after successful extraction) without claiming enforcement — Phase 10 owns the anchoring event', () => {
    const rawCapture = MEDIA_RETENTION_RULES.find((rule) => rule.mediaClass === 'raw_capture');
    expect(rawCapture).toMatchObject({
      retentionDays: RAW_CAPTURE_RETENTION_DAYS,
      anchor: 'successful_extraction',
      enforced: false,
    });
  });

  it('export_package is the only ENFORCED rule, registration-anchored at the exports bucket lifecycle figure', () => {
    const enforced = MEDIA_RETENTION_RULES.filter((rule) => rule.enforced);
    expect(enforced).toHaveLength(1);
    expect(enforced[0]).toMatchObject({
      mediaClass: 'export_package',
      retentionDays: EXPORT_PACKAGE_RETENTION_DAYS,
      anchor: 'registration',
    });
  });

  it('every duration-less rule is anchored to none', () => {
    for (const rule of MEDIA_RETENTION_RULES) {
      expect(rule.retentionDays === null).toBe(rule.anchor === 'none');
    }
  });
});

describe('deriveDefaultRetentionDeadline', () => {
  it('stamps export_package with registration + 7 days', () => {
    expect(deriveDefaultRetentionDeadline('export_package', NOW)).toEqual(
      new Date(NOW.getTime() + EXPORT_PACKAGE_RETENTION_DAYS * DAY_MS),
    );
  });

  it('returns null for every other class, raw_capture included (its rule is event-anchored, not registration-anchored)', () => {
    const otherClasses: MediaClass[] = [
      'garden_photo',
      'imported_plan',
      'raw_capture',
      'derived_preview',
      'processing_output',
    ];
    for (const mediaClass of otherClasses) {
      expect(deriveDefaultRetentionDeadline(mediaClass, NOW)).toBeNull();
    }
  });
});

describe('staleUploadCutoff', () => {
  it('is the documented reconciliation window before now', () => {
    expect(staleUploadCutoff(NOW)).toEqual(
      new Date(NOW.getTime() - STALE_UPLOAD_RECONCILIATION_DAYS * DAY_MS),
    );
  });
});
