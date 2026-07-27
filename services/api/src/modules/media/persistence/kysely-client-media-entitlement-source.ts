import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientEngagementState, PublicationState } from '../../collaboration/public.js';
import type {
  ClientAccessGrantState,
  ClientMediaEntitlementGrant,
  ClientMediaEntitlementSource,
} from '../application/client-media-entitlement-source.js';

/**
 * SELECT-only cross-schema implementation of `ClientMediaEntitlementSource`
 * — mirrors `KyselyGardenAssignmentAccessSource` exactly (see that
 * adapter's own header): reads `collaboration.media_entitlement`,
 * `.publication_version`, `.client_update`, `.client_engagement`, and
 * `.client_access_grant` — five tables `collaboration` owns — through
 * Kysely's shared typed schema; never imports `collaboration`'s own
 * repository classes.
 *
 * ONE JOINED QUERY, NOT FIVE ROUND TRIPS: authorization decides on the
 * engagement/grant/publication state together, at one instant, the
 * identical "read together" reasoning `KyselyGardenAssignmentAccessSource`'s
 * own header gives for joining role and lifecycle state in one query —
 * doubly important here since section 16 requires every check to be
 * genuinely fresh at issuance time, and one snapshot read is more
 * consistent than several reads taken at slightly different instants.
 * Filtered to `client_access_grant.client_profile_id = clientProfileId` so
 * a request from an unrelated client (cross-client) or one who was never
 * granted access at all yields no row, identically to a genuinely
 * nonexistent entitlement — `GetClientMediaAccess` denies both the same
 * way.
 *
 * KNOWN, ACCEPTED LIMITATION: if the SAME `media_record_id` were ever
 * entitled under more than one engagement this profile holds a grant on
 * (structurally possible — `media_entitlement`'s own uniqueness key is
 * `(publication_version_id, media_record_id)`, not `media_record_id`
 * alone — but not a scenario any test in this package's own denial matrix
 * constructs, nor one the product's engagement model anticipates), this
 * query returns one row arbitrarily rather than preferring a fully-valid
 * one. Recorded here rather than silently assumed away; revisit if a real
 * multi-engagement-per-media case is confirmed.
 */
export class KyselyClientMediaEntitlementSource implements ClientMediaEntitlementSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findEntitlementGrant(
    clientProfileId: Uuid,
    mediaRecordId: Uuid,
  ): Promise<ClientMediaEntitlementGrant | null> {
    const row = await this.db
      .selectFrom('collaboration.media_entitlement')
      .innerJoin(
        'collaboration.publication_version',
        'collaboration.publication_version.id',
        'collaboration.media_entitlement.publication_version_id',
      )
      .innerJoin(
        'collaboration.client_update',
        'collaboration.client_update.id',
        'collaboration.publication_version.client_update_id',
      )
      .innerJoin(
        'collaboration.client_engagement',
        'collaboration.client_engagement.id',
        'collaboration.media_entitlement.engagement_id',
      )
      .innerJoin('collaboration.client_access_grant', (join) =>
        join
          .onRef(
            'collaboration.client_access_grant.engagement_id',
            '=',
            'collaboration.client_engagement.id',
          )
          .on('collaboration.client_access_grant.client_profile_id', '=', clientProfileId),
      )
      .select([
        'collaboration.client_engagement.id as engagement_id',
        'collaboration.client_engagement.state as engagement_state',
        'collaboration.client_access_grant.state as grant_state',
        'collaboration.publication_version.id as publication_version_id',
        'collaboration.client_update.state as publication_state',
      ])
      .where('collaboration.media_entitlement.media_record_id', '=', mediaRecordId)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return {
      engagementId: row.engagement_id,
      engagementState: row.engagement_state as ClientEngagementState,
      grantState: row.grant_state as ClientAccessGrantState,
      publicationVersionId: row.publication_version_id,
      publicationState: row.publication_state as PublicationState,
    };
  }
}
