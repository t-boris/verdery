import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getToken = vi.fn();

vi.mock('firebase/app-check', () => ({
  getToken,
  initializeAppCheck: vi.fn(() => ({ app: {} })),
  ReCaptchaEnterpriseProvider: class {},
}));

vi.mock('./firebase-app', () => ({
  getFirebaseApp: vi.fn(() => ({})),
  requireEnv: vi.fn(() => 'site-key'),
}));

/**
 * The composition test: that `getAppCheckToken` is bounded, not merely that
 * `resolveWithinBudget` works. The defect this covers lived exactly in the
 * seam between the two — the helper did not exist, and the SDK call was
 * awaited directly.
 */
describe('getAppCheckToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getToken.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('returns the token the provider issues', async () => {
    getToken.mockResolvedValue({ token: 'app-check-token' });
    const { getAppCheckToken } = await import('./app-check');

    await expect(getAppCheckToken()).resolves.toBe('app-check-token');
  });

  it('returns null when the provider never answers, rather than waiting forever', async () => {
    getToken.mockReturnValue(new Promise(() => {}));
    const { getAppCheckToken, APP_CHECK_TOKEN_BUDGET_MS } = await import('./app-check');

    const pending = getAppCheckToken();
    await vi.advanceTimersByTimeAsync(APP_CHECK_TOKEN_BUDGET_MS);

    await expect(pending).resolves.toBeNull();
  });

  it('returns null when the provider fails', async () => {
    getToken.mockRejectedValue(new Error('reCAPTCHA unavailable'));
    const { getAppCheckToken } = await import('./app-check');

    await expect(getAppCheckToken()).resolves.toBeNull();
  });
});
