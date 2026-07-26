/**
 * The dual authorization gate every client-engagement lifecycle command
 * shares: an org-backed engagement is administered by that organization's
 * `manageEngagement`-holders; an engagement with no service organization is
 * administered by the garden's own owner (`manageGarden`) — ADR-0012,
 * section 4.4: "An organization administrator grants it [publisher access]
 * for an organization-backed engagement; a garden owner grants it when no
 * service organization is attached." `CreateClientEngagement` applies the
 * identical split to the REQUEST body's own `serviceOrganizationId` before
 * the row exists; `ActivateClientEngagement`/`EndClientEngagement`/
 * `RevokeClientEngagement` apply it here, against the STORED row's field —
 * never a client-supplied value, since only the stored fact is trustworthy
 * once the engagement exists.
 *
 * READ-THEN-AUTHORIZE, NOT AUTHORIZE-THEN-READ — a deliberate, documented
 * departure from this codebase's usual "authorize first" ordering (every
 * garden-scoped command calls `GardenAuthorization.requireCapability`
 * BEFORE touching any row, because its path already names a `gardenId` to
 * authorize against). Engagement lifecycle routes are flat
 * (`/client-engagements/{id}/...`, matching architecture/collaboration-and-
 * client-sharing.md section 13's own API surface list) — there is no
 * enclosing garden or organization id in the path, so which authorization
 * source even applies is a fact only the stored row can answer. This
 * mirrors the identical reasoning `AcceptOwnershipTransfer` already applies
 * (reads a pending transfer to learn who is allowed to act on it before
 * deciding), with one honestly-noted difference: unlike that command (whose
 * `gardenId` path segment already scopes the read to one garden before any
 * row is touched), a caller here who supplies ANY valid engagement id
 * learns THAT an engagement exists at that id (through whichever error path
 * follows — `notFound` for a bogus id, `forbidden`/`organization.not_found`/
 * `garden.not_found` for a real one they may not act on) before
 * authorization completes. The engagement's CONTENTS are never disclosed to
 * an unauthorized caller either way — only pass/fail — so this is a minor,
 * accepted existence-oracle trade-off of a flat resource route with
 * heterogeneous authorization sources, not a content leak.
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Publication Boundary".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { OrganizationAuthorization } from './organization-authorization.js';

export interface EngagementAuthorizationSubject {
  readonly serviceOrganizationId: Uuid | null;
  readonly gardenId: Uuid;
}

export async function requireEngagementCapability(
  engagement: EngagementAuthorizationSubject,
  actorProfileId: Uuid,
  organizationAuthorization: OrganizationAuthorization,
  gardenAuthorization: GardenAuthorization,
): Promise<void> {
  if (engagement.serviceOrganizationId !== null) {
    await organizationAuthorization.requireCapability(
      engagement.serviceOrganizationId,
      actorProfileId,
      'manageEngagement',
    );
    return;
  }

  await gardenAuthorization.requireCapability(engagement.gardenId, actorProfileId, 'manageGarden');
}
