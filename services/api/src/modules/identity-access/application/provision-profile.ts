/**
 * Provisions or fetches the application profile for a verified Firebase
 * identity.
 *
 * Runs on every authenticated request, not only the first: the common case
 * is a single indexed lookup, and creation is idempotent under a concurrent
 * race (two simultaneous first requests for the same brand-new identity, for
 * example two browser tabs completing sign-in together).
 *
 * The profile insert and its audit record are deliberately two separate
 * statements, not one transaction: a crash between them leaves a profile
 * with no "profile.provisioned" audit entry, a minor observability gap, not
 * a correctness bug — the profile row is the only fact anything else
 * depends on. Garden mutations do not take this shortcut; see
 * modules/gardens-mapping/application, where the audited fact is
 * authorization-relevant and atomicity is enforced.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "6. Application Profile Provisioning".
 */

import type { AuditLogger } from '../../../platform/audit/audit-logger.js';
import type { VerifiedCredential } from '../../../platform/authentication/verified-credential.js';
import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { provisionProfile } from '../domain/profile.js';
import type { Profile } from '../domain/profile.js';
import type { IdentityProviderLinkRepository } from './identity-provider-link-repository.js';
import type { ProfileRepository } from './profile-repository.js';

export class ProvisionProfile {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly identityProviderLinks: IdentityProviderLinkRepository,
    private readonly clock: Clock,
    private readonly auditLogger: AuditLogger,
  ) {}

  async execute(credential: VerifiedCredential): Promise<Profile> {
    const profile = await this.resolveProfile(credential);

    // Refreshed on every sign-in, not only the first, so a provider added
    // after initial registration (signing in with Apple having previously
    // only used Google, for example) is recorded too.
    await this.identityProviderLinks.link(
      profile.id,
      credential.signInProvider,
      credential.providerUid,
      credential.email,
      this.clock.now(),
    );

    return profile;
  }

  private async resolveProfile(credential: VerifiedCredential): Promise<Profile> {
    const existing = await this.repository.findByFirebaseUid(credential.firebaseUid);
    if (existing !== null) {
      return existing;
    }

    const profile = provisionProfile(generateUuidV7(), credential.firebaseUid, this.clock.now());

    try {
      await this.repository.insert(profile);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      // Lost the race: another concurrent request for the same identity
      // already committed. Its result is authoritative.
      const raced = await this.repository.findByFirebaseUid(credential.firebaseUid);
      if (raced !== null) {
        return raced;
      }
      throw error;
    }

    await this.auditLogger.record({
      eventType: 'profile.provisioned',
      subjectType: 'profile',
      subjectId: profile.id,
      actorProfileId: profile.id,
      actorType: 'user',
    });

    return profile;
  }
}
