import { describe, expect, it } from 'vitest';
import { MEDIA_RETENTION_RULES } from '../domain/media-retention.js';
import { GetMediaRetentionPolicy } from './get-media-retention-policy.js';

describe('GetMediaRetentionPolicy', () => {
  it('maps the domain retention table one-to-one onto the contract shape — the same table the sweep enforces from', () => {
    const result = new GetMediaRetentionPolicy().execute();

    expect(result.policies).toHaveLength(MEDIA_RETENTION_RULES.length);
    expect(result.policies).toEqual(
      MEDIA_RETENTION_RULES.map((rule) => ({
        mediaClass: rule.mediaClass,
        retentionDays: rule.retentionDays,
        anchor: rule.anchor,
        enforced: rule.enforced,
        summary: rule.summary,
      })),
    );
  });

  it('states the raw-capture policy visibly while reporting it unenforced — the honest P6-RET-01 foundation', () => {
    const rawCapture = new GetMediaRetentionPolicy()
      .execute()
      .policies.find((policy) => policy.mediaClass === 'raw_capture');

    expect(rawCapture).toMatchObject({
      retentionDays: 30,
      anchor: 'successful_extraction',
      enforced: false,
    });
  });
});
