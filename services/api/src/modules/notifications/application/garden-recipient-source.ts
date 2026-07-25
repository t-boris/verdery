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
}
