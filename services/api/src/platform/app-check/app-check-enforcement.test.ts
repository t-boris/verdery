/**
 * The enforcement rule, tested as the pure function it is.
 *
 * These tests are the reviewable form of the policy: the endpoint list is a
 * security decision, so it is pinned here rather than merely asserted about
 * indirectly through the plugin. A future change that adds or removes a
 * protected endpoint has to change this file too, which is exactly the review
 * gate the list is supposed to have.
 */

import { API_BASE_PATH } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import {
  APP_CHECK_DELIBERATELY_UNENFORCED,
  APP_CHECK_ENFORCED_ENDPOINTS,
  decideAppCheckOutcome,
  isEnforcedEndpoint,
  type AppCheckEnforcementMode,
} from './app-check-enforcement.js';
import type { AppCheckClassification } from './app-check-verifier.js';

const NOT_VALID: readonly AppCheckClassification[] = ['missing', 'invalid'];
const BOTH_MODES: readonly AppCheckEnforcementMode[] = ['monitor', 'enforce'];

describe('APP_CHECK_ENFORCED_ENDPOINTS', () => {
  it('is exactly the five reviewed expensive endpoints', () => {
    expect(
      APP_CHECK_ENFORCED_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.url}`),
    ).toEqual([
      `POST ${API_BASE_PATH}/auth/session`,
      `POST ${API_BASE_PATH}/gardens/:gardenId/media`,
      `POST ${API_BASE_PATH}/gardens/:gardenId/media/:mediaId/complete`,
      `POST ${API_BASE_PATH}/exports`,
      `GET ${API_BASE_PATH}/gardens/:gardenId/today`,
    ]);
  });

  it('states, for every entry, which register row puts it on the list', () => {
    for (const endpoint of APP_CHECK_ENFORCED_ENDPOINTS) {
      expect(endpoint.rationale).toMatch(/T-COST-\d+/u);
    }
  });

  it('never lists the same endpoint twice', () => {
    const keys = APP_CHECK_ENFORCED_ENDPOINTS.map((e) => `${e.method} ${e.url}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not contradict the deliberately-unenforced list', () => {
    for (const endpoint of APP_CHECK_ENFORCED_ENDPOINTS) {
      expect(APP_CHECK_DELIBERATELY_UNENFORCED).not.toContain(`${endpoint.method} ${endpoint.url}`);
    }
  });

  it('never enforces an internal worker route: a Cloud Tasks caller has no App Check token', () => {
    for (const endpoint of APP_CHECK_ENFORCED_ENDPOINTS) {
      expect(endpoint.url.startsWith(`${API_BASE_PATH}/internal/`)).toBe(false);
    }
  });

  it('never enforces a health route: a probe App Check can fail reports the wrong thing', () => {
    for (const endpoint of APP_CHECK_ENFORCED_ENDPOINTS) {
      expect(endpoint.url.startsWith(`${API_BASE_PATH}/health`)).toBe(false);
    }
  });

  it('leaves sign-out reachable, so a broken attestation cannot trap a session open', () => {
    expect(isEnforcedEndpoint('DELETE', `${API_BASE_PATH}/auth/session`)).toBe(false);
  });
});

describe('isEnforcedEndpoint', () => {
  it('matches the registered, parameterized route URL rather than a concrete path', () => {
    expect(isEnforcedEndpoint('POST', `${API_BASE_PATH}/gardens/:gardenId/media`)).toBe(true);
    // A concrete path is what `request.url` holds; the hook passes
    // `routeOptions.url`, and this asserts the difference is real so a future
    // refactor cannot quietly swap one for the other and disable enforcement.
    expect(isEnforcedEndpoint('POST', `${API_BASE_PATH}/gardens/abc-123/media`)).toBe(false);
  });

  it('is method-sensitive', () => {
    expect(isEnforcedEndpoint('POST', `${API_BASE_PATH}/auth/session`)).toBe(true);
    expect(isEnforcedEndpoint('DELETE', `${API_BASE_PATH}/auth/session`)).toBe(false);
  });

  it('accepts a lowercase method', () => {
    expect(isEnforcedEndpoint('post', `${API_BASE_PATH}/exports`)).toBe(true);
  });

  it('is false for an unknown route URL', () => {
    expect(isEnforcedEndpoint('GET', undefined)).toBe(false);
    expect(isEnforcedEndpoint('GET', `${API_BASE_PATH}/gardens`)).toBe(false);
  });
});

describe('decideAppCheckOutcome', () => {
  it('observes a valid token in either mode, enforced endpoint or not', () => {
    for (const mode of BOTH_MODES) {
      expect(
        decideAppCheckOutcome({
          mode,
          classification: 'valid',
          method: 'POST',
          routeUrl: `${API_BASE_PATH}/auth/session`,
        }),
      ).toBe('observed');
    }
  });

  it('observes an unattested request on an UNENFORCED endpoint even in enforce mode', () => {
    for (const classification of NOT_VALID) {
      expect(
        decideAppCheckOutcome({
          mode: 'enforce',
          classification,
          method: 'GET',
          routeUrl: `${API_BASE_PATH}/gardens`,
        }),
      ).toBe('observed');
    }
  });

  it('reports wouldReject in monitor mode — the telemetry the flip decision needs', () => {
    for (const classification of NOT_VALID) {
      expect(
        decideAppCheckOutcome({
          mode: 'monitor',
          classification,
          method: 'POST',
          routeUrl: `${API_BASE_PATH}/exports`,
        }),
      ).toBe('wouldReject');
    }
  });

  it('rejects in enforce mode on an enforced endpoint', () => {
    for (const classification of NOT_VALID) {
      expect(
        decideAppCheckOutcome({
          mode: 'enforce',
          classification,
          method: 'POST',
          routeUrl: `${API_BASE_PATH}/exports`,
        }),
      ).toBe('rejected');
    }
  });

  it('treats a missing token exactly like an invalid one: omitting the header is not a bypass', () => {
    const forClassification = (classification: AppCheckClassification) =>
      decideAppCheckOutcome({
        mode: 'enforce',
        classification,
        method: 'GET',
        routeUrl: `${API_BASE_PATH}/gardens/:gardenId/today`,
      });

    expect(forClassification('missing')).toBe(forClassification('invalid'));
  });

  it('rejects nothing at all in monitor mode, for every enforced endpoint', () => {
    for (const endpoint of APP_CHECK_ENFORCED_ENDPOINTS) {
      for (const classification of NOT_VALID) {
        expect(
          decideAppCheckOutcome({
            mode: 'monitor',
            classification,
            method: endpoint.method,
            routeUrl: endpoint.url,
          }),
        ).not.toBe('rejected');
      }
    }
  });
});
