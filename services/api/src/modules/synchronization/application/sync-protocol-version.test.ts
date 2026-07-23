import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../platform/errors/application-error.js';
import {
  MIN_SUPPORTED_SYNC_PROTOCOL_VERSION,
  requireSupportedSyncProtocolVersion,
} from './sync-protocol-version.js';

describe('requireSupportedSyncProtocolVersion', () => {
  it('accepts the minimum supported version and anything above it', () => {
    expect(() =>
      requireSupportedSyncProtocolVersion(MIN_SUPPORTED_SYNC_PROTOCOL_VERSION),
    ).not.toThrow();
    expect(() =>
      requireSupportedSyncProtocolVersion(MIN_SUPPORTED_SYNC_PROTOCOL_VERSION + 5),
    ).not.toThrow();
  });

  it('rejects a version below the supported window with a 409-mapped ConflictError', () => {
    // Below the wire schema's own `minimum: 1` — unreachable through real
    // request parsing today (see `tests/http/sync-routes.test.ts`'s own
    // comment on why), but this guard is written for the day the server
    // raises `MIN_SUPPORTED_SYNC_PROTOCOL_VERSION`, and this proves it
    // throws the right typed error right now.
    let caught: unknown;
    try {
      requireSupportedSyncProtocolVersion(MIN_SUPPORTED_SYNC_PROTOCOL_VERSION - 1);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    expect((caught as ConflictError).code).toBe('sync.protocol_version.unsupported');
  });
});
