/**
 * In-memory {@link IdentityProviderAccountGateway} (P8-DELETE-01).
 *
 * Lives in `src/`, not `tests/`, for the same reason
 * `media/application/media-test-doubles.ts` does: the composition root's own
 * test harness and every integration suite need it, and a fake that ships
 * next to its port cannot drift out of sync with the interface it implements
 * — the compiler checks it on every build.
 *
 * Records what it was asked to delete so a test can assert that account purge
 * really reached the identity provider, and can be made to fail so the
 * purge's retry path is exercised against a refusing provider rather than
 * only against a cooperative one.
 */

import type { IdentityProviderAccountGateway } from './identity-provider-account-gateway.js';

export class FakeIdentityProviderAccountGateway implements IdentityProviderAccountGateway {
  readonly deletedUids: string[] = [];
  private failure: Error | null = null;

  /** Makes the next and every subsequent call throw, until `succeedFrom now on` clears it. */
  failWith(error: Error): void {
    this.failure = error;
  }

  /** Restores ordinary behavior after `failWith`. */
  succeed(): void {
    this.failure = null;
  }

  deleteUser(providerUid: string): Promise<void> {
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    this.deletedUids.push(providerUid);
    return Promise.resolve();
  }
}
