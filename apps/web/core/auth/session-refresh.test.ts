import { beforeEach, describe, expect, it, vi } from 'vitest';

const authStateReady = vi.fn(() => Promise.resolve());
const auth: { currentUser: { getIdToken: ReturnType<typeof vi.fn> } | null } = {
  currentUser: null,
};

vi.mock('./firebase-app', () => ({
  getFirebaseAuth: () => ({
    authStateReady,
    get currentUser() {
      return auth.currentUser;
    },
  }),
}));

const { refreshSessionCookie } = await import('./session-refresh');

describe('refreshSessionCookie', () => {
  beforeEach(() => {
    auth.currentUser = null;
    authStateReady.mockClear();
  });

  it('waits for the persisted user to be restored before reading it', async () => {
    auth.currentUser = { getIdToken: vi.fn(() => Promise.resolve('fresh-id-token')) };
    const exchange = vi.fn(() => Promise.resolve(true));

    await refreshSessionCookie(exchange);

    expect(authStateReady).toHaveBeenCalledTimes(1);
  });

  it('forces a fresh ID token and exchanges it', async () => {
    const getIdToken = vi.fn(() => Promise.resolve('fresh-id-token'));
    auth.currentUser = { getIdToken };
    const exchange = vi.fn(() => Promise.resolve(true));

    await expect(refreshSessionCookie(exchange)).resolves.toBe(true);
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(exchange).toHaveBeenCalledWith('fresh-id-token');
  });

  it('reports failure when this browser holds no Firebase user', async () => {
    const exchange = vi.fn(() => Promise.resolve(true));

    await expect(refreshSessionCookie(exchange)).resolves.toBe(false);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('reports failure when the identity provider refuses a new token', async () => {
    auth.currentUser = { getIdToken: vi.fn(() => Promise.reject(new Error('user-disabled'))) };
    const exchange = vi.fn(() => Promise.resolve(true));

    await expect(refreshSessionCookie(exchange)).resolves.toBe(false);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('reports failure when the API rejects the refreshed token', async () => {
    auth.currentUser = { getIdToken: vi.fn(() => Promise.resolve('fresh-id-token')) };

    await expect(refreshSessionCookie(() => Promise.resolve(false))).resolves.toBe(false);
  });
});
