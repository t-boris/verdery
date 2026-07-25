/**
 * Firebase Admin SDK adapter for {@link IdentityProviderAccountGateway}
 * (P8-DELETE-01).
 *
 * The third and last file in the service allowed to import `firebase-admin`
 * — the others are `firebase-token-verifier.ts` and
 * `platform/app-check/firebase-app-check-verifier.ts`. Built over the SAME
 * `App` instance `main.ts` already constructs for those two, so account
 * deletion runs under the same runtime service-account identity and needs no
 * new credential (`roles/firebaseauth.admin`, already granted in
 * infrastructure/gcloud/scripts/05-service-accounts.sh, is what permits
 * `deleteUser`).
 */

import type { App } from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';
import type { IdentityProviderAccountGateway } from './identity-provider-account-gateway.js';

/** Firebase's own code for "there is no such user" — the idempotent success case, not a failure. */
const USER_NOT_FOUND_CODE = 'auth/user-not-found';

function isUserNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === USER_NOT_FOUND_CODE
  );
}

export class FirebaseIdentityProviderAccountGateway implements IdentityProviderAccountGateway {
  private readonly auth: Auth;

  constructor(app: App) {
    this.auth = getAuth(app);
  }

  async deleteUser(providerUid: string): Promise<void> {
    try {
      await this.auth.deleteUser(providerUid);
    } catch (error) {
      if (isUserNotFound(error)) {
        // Already gone — a retry of an attempt that succeeded here and then
        // crashed. The port's contract requires treating this as success;
        // rethrowing would wedge the purge on its own progress.
        return;
      }
      throw error;
    }
  }
}
