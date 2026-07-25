/**
 * Narrow cross-schema read port for recipient selection (P7-NOTIF-01):
 * "Recipient selection" is application-owned (notifications.md section 3),
 * and for garden-scoped notifications the recipients are the garden's
 * ACTIVE members — the same authorization fact `GardenAuthorization`
 * evaluates per request, read here as a set with each member's account
 * state and time zone (the per-recipient policy inputs).
 *
 * SELECT-only over `collaboration.membership` and
 * `identity_access.profile`, the `KyselyEvaluationGardenSource` /
 * `MediaReferenceFinder` narrow-read-port precedent — never a private
 * import of another module's persistence implementation.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AccountState } from '../../identity-access/public.js';

export interface GardenRecipient {
  readonly profileId: Uuid;
  readonly accountState: AccountState;
  /** The profile's own IANA zone (`identity_access.profile.time_zone`) — the quiet-hours default when no preference override exists. */
  readonly timeZone: string;
}

export interface GardenRecipientSource {
  /** Every ACTIVE membership's profile, any role: care notifications are relevant to anyone who can view the garden. */
  listActiveMembers(gardenId: Uuid): Promise<readonly GardenRecipient[]>;

  /**
   * One profile's ACTIVE membership on one garden, or `null` — the
   * delivery worker's per-intent access recheck (P7-NOTIF-02;
   * notifications.md section 14: "Shared-garden role changes are rechecked
   * at send time"). `null` is a legitimate answer meaning "skip", never an
   * error.
   */
  findActiveMember(gardenId: Uuid, profileId: Uuid): Promise<GardenRecipient | null>;

  /**
   * One profile's own account facts regardless of any garden, or `null`
   * when no profile exists — the recipient read for ACCOUNT-LEVEL intents
   * (P8-EXPORT-01: an `export_ready` intent's one recipient is the export
   * requester, whether or not the export concerned a garden).
   */
  findProfileRecipient(profileId: Uuid): Promise<GardenRecipient | null>;
}
