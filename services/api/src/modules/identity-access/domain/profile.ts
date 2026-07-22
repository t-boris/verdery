import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AccountState } from './account-state.js';

/**
 * The Grow Garden application profile: PostgreSQL's side of identity.
 *
 * Firebase remains the sole authority for credentials, provider links, and
 * token state — this entity never carries them.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "2. Identity Authority".
 */
export interface Profile {
  readonly id: Uuid;
  readonly firebaseUid: string;
  readonly accountState: AccountState;
  readonly locale: string;
  readonly timeZone: string;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const DEFAULT_LOCALE = 'en';
const DEFAULT_TIME_ZONE = 'UTC';

/**
 * Provisions a new profile for a first-seen Firebase identity.
 *
 * Starts directly in `active`, not `pending`: Phase 2 has no onboarding or
 * consent-gated registration policy built, and parking every new sign-in in
 * `pending` with no screen that ever moves it to `active` would make the
 * first-garden vertical slice this phase exists to deliver impossible to
 * reach. A future onboarding requirement is a policy this function's caller
 * can add without changing the entity itself.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "6. Application Profile Provisioning".
 */
export function provisionProfile(id: Uuid, firebaseUid: string, createdAt: Date): Profile {
  return {
    id,
    firebaseUid,
    accountState: 'active',
    locale: DEFAULT_LOCALE,
    timeZone: DEFAULT_TIME_ZONE,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
}
