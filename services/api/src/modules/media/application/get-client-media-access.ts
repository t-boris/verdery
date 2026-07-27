/**
 * The CLIENT-side equivalent of `GetMediaAccess` (operational garden
 * members) — collaboration-and-client-sharing.md section 16's own six
 * ALL-of conditions, checked in this exact order, every one of them
 * re-verified at issuance time from live rows, never a cache:
 *
 *   1. Authenticated client profile.
 *   2. Active account and engagement.
 *   3. Active client access grant.
 *   4. Visible publication version.
 *   5. Explicit publication-media entitlement.
 *   6. Requested safe derivative or specifically entitled original.
 *
 * WHY NO CACHING LAYER SITS IN FRONT OF THIS COMMAND. Section 16's own
 * closing sentence — "State is rechecked before issuing access so
 * revocation and withdrawal do not wait for an old application cache" — is
 * the entire reason this class is a fresh read on every call rather than a
 * memoized authorization result. A grant revoked, an engagement ended, or a
 * publication withdrawn one second before this call must already be
 * visible to THIS call; nothing here stores, TTLs, or reuses a prior
 * verdict, and no caller of this class should wrap it in one either.
 *
 * SHARES `GetMediaAccess`'s DELIVERY MECHANISM, NOT ITS AUTHORIZATION GATE.
 * The signed-URL issuance at the bottom of `execute` is the identical call
 * `GetMediaAccess` makes (`MediaStorageGateway.createSignedDownloadUrl`,
 * the same short-lived mechanism `media-storage-and-processing.md` section
 * 12 names — "Returns a short-lived signed or authorized download
 * mechanism"). This class does not reimplement Cloud Storage signing; it
 * only reimplements the GATE in front of it, per this package's own
 * instructions.
 *
 * CHECK 1 IS NOT RE-VERIFIED HERE. `clientProfileId` arrives already
 * authenticated — the same convention every authorization entrypoint in
 * this codebase already follows (`GardenAuthorization.requireCapability`,
 * `OrganizationAuthorization.requireCapability` both receive a bare
 * `profileId` and trust it), because Fastify's `registerAuthentication`
 * plugin (`platform/authentication/authentication-plugin.ts`) already
 * verified the credential and set `request.actorContext.profileId` before
 * any application command runs.
 *
 * "ACTIVE ACCOUNT" (the first half of check 2) IS ALSO NOT RE-VERIFIED
 * HERE — NOT a new gap this command leaves open, but the SAME existing
 * platform convention: `registerAuthentication`'s own `onRequest` hook
 * already calls `isAccountUsable(profile.accountState)` on EVERY request
 * (see that file's own header, "where 'account state' ... is enforced,
 * once, for every ... endpoint uniformly"), reading the profile fresh from
 * the database on every call (`ProvisionProfile.execute` runs "on every
 * authenticated request, not only the first"), so it is already rechecked
 * at issuance time with no caching — exactly what this command's own
 * no-cache requirement demands. A second check here would duplicate an
 * existing, already-fresh gate, not add a genuinely new safeguard.
 * "ACTIVE ENGAGEMENT" (the second half of check 2) IS new: no other module
 * in this codebase authorizes against `client_engagement.state`, and this
 * command is the first to enforce it for media specifically.
 *
 * WHY THE ENGAGEMENT/GRANT/PUBLICATION READ IS ANCHORED ON THE
 * ENTITLEMENT, NOT ON THE MEDIA'S OWN `gardenId`. A garden's client
 * relationship can, in principle, span more than one `client_engagement`
 * row over its history (a prior engagement ended or revoked, a new one
 * begun); nothing in the schema forbids that. Resolving "the" engagement
 * independently from `media_record.garden_id` would therefore be genuinely
 * ambiguous. The `media_entitlement` row itself is unambiguous: it names
 * the EXACT engagement and publication version whose publish transaction
 * selected this EXACT media object (the P9C-DATA-01 migration's own words:
 * "does this client's engagement have an EXPLICIT entitlement to this
 * exact media object"), so anchoring on it is not a shortcut — it is the
 * one fact section 16's own check 5 already requires reading, reused to
 * resolve which engagement checks 2-4 apply to. That publish transaction
 * is independently obligated (section 10, step 2: "Validates that every
 * selected item is client-safe and belongs to the engagement's garden") to
 * have confirmed the media's garden already matches, so this command does
 * not re-derive or re-check `media_record.gardenId` a second time.
 *
 * DERIVATIVE FALLBACK (check 6): a request for a media id with NO direct
 * entitlement row is tried again against its own immutable
 * `derivedFromMediaId` parent, but ONLY when the requested record is
 * itself a derivative — mirrors `GetMediaAccess`'s own
 * `isDerivative`-based split exactly (`derivedFromMediaId !== null`), and
 * implements section 16's "safe derivative ... or specifically entitled
 * original" precisely: a derivative is "safe by default" once ITS parent
 * carries a genuine entitlement (no second, per-derivative entitlement row
 * is required — the publish transaction entitles the one media object a
 * publisher actually selected, typically the original, once); an original
 * has no parent to fall back through, so it is servable only when
 * EXPLICITLY, exactly entitled — the literal "original only if explicitly
 * entitled" rule this package's own instructions ask for. No
 * `media_entitlement` schema column distinguishes "derivative only" from
 * "original included" — none is needed: the existing
 * `(publication_version_id, media_record_id)` shape already answers the
 * question precisely for whichever exact id is entitled, and the fallback
 * above is resolved through `derivedFromMediaId`, a column `media_record`
 * already has. Confirmed by reading the actual row shape
 * (`collaboration.media_entitlement`, migration
 * `1786700000000_client-publication-and-work-logs.sql`) before writing this
 * class, not assumed.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "16. Media Access"; architecture/media-storage-and-processing.md, section
 * "12. Download Flow"; implementation-plan.md work package P9C-MEDIA-01.
 */

import type { MediaAccess } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { ClientMediaEntitlementSource } from './client-media-entitlement-source.js';
import { mediaNotAvailableError, mediaNotFoundError } from './media-errors.js';
import type { MediaRepository } from './media-repository.js';
import type { MediaStorageGateway } from './media-storage-gateway.js';
import { toMediaAccessResource } from './media-view.js';

export class GetClientMediaAccess {
  constructor(
    private readonly media: MediaRepository,
    private readonly entitlements: ClientMediaEntitlementSource,
    private readonly storage: MediaStorageGateway,
    private readonly clock: Clock,
  ) {}

  async execute(clientProfileId: Uuid, mediaId: Uuid): Promise<MediaAccess> {
    const record = await this.media.get(mediaId);
    if (record === null) {
      throw mediaNotFoundError();
    }

    const isDerivative = record.derivedFromMediaId !== null;

    // Check 5 (resolved first, structurally — see this file's own header,
    // "WHY THE ... READ IS ANCHORED ON THE ENTITLEMENT"): the exact
    // requested id first; only a DERIVATIVE retries through its immutable
    // parent, the "safe derivative" fallback check 6 describes.
    const exactGrant = await this.entitlements.findEntitlementGrant(clientProfileId, record.id);
    const grant =
      exactGrant ??
      (isDerivative
        ? await this.entitlements.findEntitlementGrant(clientProfileId, record.derivedFromMediaId)
        : null);

    if (grant === null) {
      // No `media_entitlement` row reaches this profile at all — covers
      // both "media never entitled to any engagement" and "entitled to an
      // engagement this profile holds no grant on" (cross-client) alike;
      // never distinguished to the caller, mirroring
      // `requireMediaAndAuthorize`'s own existence-concealment posture.
      throw mediaNotFoundError();
    }

    // Check 2 (engagement half — see this file's header for the account
    // half, already covered upstream).
    if (grant.engagementState !== 'active') {
      throw mediaNotFoundError();
    }

    // Check 3.
    if (grant.grantState !== 'active') {
      throw mediaNotFoundError();
    }

    // Check 4 — withdrawal never touches `media_entitlement`
    // (P9C-DATA-01's own design); THIS join through `client_update.state`
    // is the only thing that makes withdrawal effective for media access.
    if (grant.publicationState !== 'published') {
      throw mediaNotFoundError();
    }

    // Check 6 — mirrors `GetMediaAccess`'s own availability gate exactly: a
    // derivative is servable at `available` alone; an original also
    // requires `processed` (its safety validation concluded clean).
    if (isDerivative) {
      if (record.uploadState !== 'available') {
        throw mediaNotAvailableError();
      }
    } else if (record.uploadState !== 'available' || record.processingState !== 'processed') {
      throw mediaNotAvailableError();
    }

    const now = this.clock.now();
    const access = await this.storage.createSignedDownloadUrl(
      // Always both set once `uploadState` reached `available` — the same
      // invariant `GetMediaAccess`'s own comment relies on.
      { bucketName: record.bucketName as string, objectKey: record.objectKey as string },
      now,
    );

    return toMediaAccessResource(access);
  }
}
