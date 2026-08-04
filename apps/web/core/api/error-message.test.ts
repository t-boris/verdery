/**
 * The mapping's own promise, enforced.
 *
 * `error-message.ts` says an untranslated server code is "a visible omission
 * instead of a silent fallback". Nothing checked that. `DeletionErrorCode`
 * had been unmapped since it was introduced, so requesting a garden deletion
 * with an older session showed "the request failed for an unrecognized
 * reason" — hiding an answer the server had already given in plain words,
 * and one the reader could act on by signing in again.
 *
 * This test is the enforcement: every code the contract exports must resolve
 * to something other than the unknown fallback.
 */

import {
  ClientAccessGrantErrorCode,
  ClientEngagementErrorCode,
  ClientPortalErrorCode,
  ClientUpdateErrorCode,
  CollaborationErrorCode,
  DeletionErrorCode,
  ExportErrorCode,
  GardenErrorCode,
  MapErrorCode,
  MediaErrorCode,
  NotificationErrorCode,
  OrganizationErrorCode,
  PublisherGrantErrorCode,
  SharedErrorCode,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { errorMessageKey } from './error-message';

/** Every code group the API can raise at a browser. */
const CODE_GROUPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  SharedErrorCode,
  GardenErrorCode,
  MapErrorCode,
  MediaErrorCode,
  NotificationErrorCode,
  ExportErrorCode,
  DeletionErrorCode,
  CollaborationErrorCode,
  OrganizationErrorCode,
  ClientEngagementErrorCode,
  ClientAccessGrantErrorCode,
  ClientPortalErrorCode,
  ClientUpdateErrorCode,
  PublisherGrantErrorCode,
};

describe('errorMessageKey', () => {
  it('has a message for every error code the contract defines', () => {
    const unmapped = Object.entries(CODE_GROUPS).flatMap(([groupName, group]) =>
      Object.values(group)
        .filter((code) => errorMessageKey(code) === 'error.unknown')
        .map((code) => `${groupName}.${code}`),
    );

    // Listed by name rather than counted, so a failure says which code needs
    // a translation instead of only that one does.
    expect(unmapped).toEqual([]);
  });

  it('falls back to the unknown message for a code it has never seen', () => {
    // The fallback must still exist: a server deployed ahead of this client
    // can raise a code this build predates.
    expect(errorMessageKey('something.not_in_any_contract')).toBe('error.unknown');
  });
});
