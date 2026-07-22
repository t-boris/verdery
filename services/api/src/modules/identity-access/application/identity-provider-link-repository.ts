import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface IdentityProviderLinkRepository {
  /**
   * Records or refreshes the verified identifier this profile presented for
   * one provider, on every sign-in, not only the first. This is Grow
   * Garden's own shadow of the provider link — a narrower, support-facing
   * record, not a replacement for Firebase's own authority over provider
   * linking and duplicate-account prevention.
   *
   * Source: architecture/identity-and-authorization.md, sections
   * "2. Identity Authority", "6. Application Profile Provisioning".
   */
  link(
    profileId: Uuid,
    provider: string,
    providerUid: string,
    verifiedEmail: string | undefined,
    linkedAt: Date,
  ): Promise<void>;
}
