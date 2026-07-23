import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../../../platform/errors/application-error.js';
import {
  decodeSyncChangesCursor,
  encodeSyncChangesCursor,
  requireFreshCursor,
  SYNC_CHANGES_RETENTION_MILLISECONDS,
} from './sync-changes-cursor.js';

describe('sync changes cursor', () => {
  it('round-trips sequence and issuedAt through encode/decode', () => {
    const issuedAt = new Date('2026-07-21T09:00:00.000Z');
    const encoded = encodeSyncChangesCursor({ afterSequence: 42, issuedAt });

    const decoded = decodeSyncChangesCursor(encoded);

    expect(decoded).toEqual({ afterSequence: 42, issuedAt });
  });

  it('rejects a malformed cursor with a validation error, not a crash', () => {
    let caught: unknown;
    try {
      decodeSyncChangesCursor('not-a-real-cursor');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).code).toBe('request.invalid');
  });

  it('rejects a well-formed cursor missing a required field', () => {
    const malformed = Buffer.from(JSON.stringify({ afterSequence: 1 })).toString('base64url');

    expect(() => decodeSyncChangesCursor(malformed)).toThrow(ValidationError);
  });

  describe('requireFreshCursor', () => {
    it('accepts a cursor issued within the retention window', () => {
      const issuedAt = new Date('2026-07-01T00:00:00.000Z');
      const now = new Date(issuedAt.getTime() + SYNC_CHANGES_RETENTION_MILLISECONDS - 1);

      expect(() => requireFreshCursor(issuedAt, now)).not.toThrow();
    });

    it('rejects a cursor older than the retention window with a 409-mapped ConflictError', () => {
      const issuedAt = new Date('2026-07-01T00:00:00.000Z');
      const now = new Date(issuedAt.getTime() + SYNC_CHANGES_RETENTION_MILLISECONDS + 1);

      let caught: unknown;
      try {
        requireFreshCursor(issuedAt, now);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConflictError);
      expect((caught as ConflictError).code).toBe('sync.changes.cursor_expired');
    });
  });
});
