/**
 * Kysely implementation of `ExportSnapshotReader` (P8-EXPORT-01).
 *
 * Opens ONE `REPEATABLE READ, READ ONLY` transaction and gathers the whole
 * structured snapshot inside it — the transaction's MVCC snapshot is the
 * export's consistency boundary (architecture/data-export-and-deletion.md
 * section 7): every table read sees the same instant, so cross-references
 * are coherent by construction and rows created after the boundary are
 * absent. `READ ONLY` makes the posture enforceable, not aspirational: a
 * write attempted through this transaction is a database error.
 *
 * SCOPE RESOLUTION (section 4):
 * - `garden`: the one garden. The REQUEST command verified `exportGarden`;
 *   this reader re-derives nothing about authorization.
 * - `account`: the requester's own account data plus every garden they
 *   actively OWN; gardens where they hold a lesser role are listed with
 *   `exclusionReason: 'not_owner'` — per-role garden export entitlement
 *   beyond ownership is a deferred product decision, disclosed rather than
 *   guessed.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ExportGardenListing,
  ExportMediaFileEntry,
  ExportNotificationPreferencesData,
  ExportProfileData,
  ExportSnapshotData,
  ExportSnapshotReader,
  ExportSnapshotScope,
} from '../application/export-snapshot-reader.js';
import { KyselyGardenContentReader } from './kysely-garden-content-reader.js';

export class KyselyExportSnapshotReader implements ExportSnapshotReader {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async readSnapshot(input: ExportSnapshotScope): Promise<ExportSnapshotData> {
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (trx) => {
        // The boundary instant is stamped inside the transaction: it is the
        // recorded name of THIS transaction's snapshot.
        const boundaryAt = this.clock.now();
        const content = new KyselyGardenContentReader(trx);

        const gardenListings = await this.resolveGardenListings(trx, input);
        const includedGardenIds = gardenListings
          .filter((listing) => listing.included)
          .map((listing) => listing.gardenId);

        const gardens = [];
        const mediaFiles: ExportMediaFileEntry[] = [];
        for (const gardenId of includedGardenIds) {
          gardens.push(await content.readGarden(gardenId));
          if (input.includeMedia) {
            mediaFiles.push(...(await content.readMediaFileEntries(gardenId)));
          }
        }

        const profile =
          input.scope === 'account' ? await this.readProfile(trx, input.requesterProfileId) : null;
        const notificationPreferences =
          input.scope === 'account'
            ? await this.readNotificationPreferences(trx, input.requesterProfileId)
            : null;

        return {
          boundaryAt,
          scope: input.scope,
          requesterProfileId: input.requesterProfileId,
          includeMedia: input.includeMedia,
          profile,
          notificationPreferences,
          gardenListings,
          gardens,
          mediaFiles,
        };
      });
  }

  private async resolveGardenListings(
    trx: Kysely<DatabaseSchema>,
    input: ExportSnapshotScope,
  ): Promise<ExportGardenListing[]> {
    if (input.scope === 'garden') {
      const garden = await trx
        .selectFrom('gardens_mapping.garden')
        .select(['id', 'name'])
        .where('id', '=', input.gardenId as Uuid)
        .executeTakeFirstOrThrow();
      return [
        {
          gardenId: garden.id,
          name: garden.name,
          role: 'owner',
          included: true,
          exclusionReason: null,
        },
      ];
    }

    const memberships = await trx
      .selectFrom('collaboration.membership')
      .innerJoin(
        'gardens_mapping.garden',
        'gardens_mapping.garden.id',
        'collaboration.membership.garden_id',
      )
      .select([
        'collaboration.membership.garden_id as garden_id',
        'collaboration.membership.role as role',
        'gardens_mapping.garden.name as name',
      ])
      .where('collaboration.membership.profile_id', '=', input.requesterProfileId)
      .where('collaboration.membership.state', '=', 'active')
      .orderBy('collaboration.membership.garden_id')
      .execute();

    return memberships.map((membership) => ({
      gardenId: membership.garden_id,
      name: membership.name,
      role: membership.role,
      included: membership.role === 'owner',
      exclusionReason: membership.role === 'owner' ? null : 'not_owner',
    }));
  }

  private async readProfile(
    trx: Kysely<DatabaseSchema>,
    profileId: Uuid,
  ): Promise<ExportProfileData> {
    const profile = await trx
      .selectFrom('identity_access.profile')
      .select(['id', 'account_state', 'locale', 'time_zone', 'created_at', 'updated_at'])
      .where('id', '=', profileId)
      .executeTakeFirstOrThrow();

    const providerLinks = await trx
      .selectFrom('identity_access.identity_provider_link')
      .select(['provider', 'verified_email', 'linked_at'])
      .where('profile_id', '=', profileId)
      .orderBy('id')
      .execute();

    const consents = await trx
      .selectFrom('identity_access.consent_record')
      .select(['consent_type', 'consent_version', 'granted_at'])
      .where('profile_id', '=', profileId)
      .orderBy('id')
      .execute();

    return {
      id: profile.id,
      accountState: profile.account_state,
      locale: profile.locale,
      timeZone: profile.time_zone,
      createdAt: profile.created_at.toISOString(),
      updatedAt: profile.updated_at.toISOString(),
      providerLinks: providerLinks.map((link) => ({
        provider: link.provider,
        verifiedEmail: link.verified_email,
        linkedAt: link.linked_at.toISOString(),
      })),
      consents: consents.map((consent) => ({
        consentType: consent.consent_type,
        consentVersion: consent.consent_version,
        grantedAt: consent.granted_at.toISOString(),
      })),
    };
  }

  private async readNotificationPreferences(
    trx: Kysely<DatabaseSchema>,
    profileId: Uuid,
  ): Promise<ExportNotificationPreferencesData> {
    const document = await trx
      .selectFrom('notifications.notification_preference_document')
      .select(['quiet_hours_start_minute', 'quiet_hours_end_minute', 'quiet_hours_time_zone'])
      .where('profile_id', '=', profileId)
      .executeTakeFirst();

    const entries = await trx
      .selectFrom('notifications.notification_preference')
      .select(['notification_type', 'garden_id', 'in_app_enabled', 'push_enabled'])
      .where('profile_id', '=', profileId)
      .orderBy('id')
      .execute();

    return {
      quietHours:
        document === undefined ||
        document.quiet_hours_start_minute === null ||
        document.quiet_hours_end_minute === null
          ? null
          : {
              startMinute: document.quiet_hours_start_minute,
              endMinute: document.quiet_hours_end_minute,
              timeZone: document.quiet_hours_time_zone,
            },
      entries: entries.map((entry) => ({
        notificationType: entry.notification_type,
        gardenId: entry.garden_id,
        inAppEnabled: entry.in_app_enabled,
        pushEnabled: entry.push_enabled,
      })),
    };
  }
}
