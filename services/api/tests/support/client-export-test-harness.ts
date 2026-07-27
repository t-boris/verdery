/**
 * Shared service wiring and scenario seeding for the P9C-EXPORT-01
 * integration suites (`client-export-manifest.test.ts`,
 * `client-export-manifest-lifecycle.test.ts`) — the same
 * `export-test-harness.ts`/`client-media-access-denial-matrix.test.ts`
 * precedent: real Kysely-backed application services against the migrated
 * database, direct `pg.Client` inserts for the client-publication fixture
 * rows the same way that denial matrix already does (no P9C-PUBLISH-01
 * command wiring needed to prove authorization/entitlement behavior).
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import {
  ClientPortalAuthorization,
  KyselyClientAccessGrantRepository,
  KyselyClientEngagementRepository,
  KyselyClientPublicationReadRepository,
} from '../../src/modules/collaboration/public.js';
import {
  KyselyCoordinateSpaceRepository,
  KyselyGardenRepository,
  KyselyGeoreferenceRepository,
  KyselyMapObjectRepository,
} from '../../src/modules/gardens-mapping/public.js';
import {
  FakeMediaStorageGateway,
  fixedClock as fixedMediaClock,
} from '../../src/modules/media/application/media-test-doubles.js';
import {
  GetClientMediaAccess,
  KyselyClientMediaEntitlementSource,
  KyselyMediaRepository,
} from '../../src/modules/media/public.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/public.js';
import { GetClientExportManifest } from '../../src/modules/exports/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { insertGarden, insertProfile } from './collaboration-fixtures.js';
import type { Row } from './collaboration-fixtures.js';
import { insertMapObject, insertPlant } from './export-test-harness.js';
import {
  insertClientAccessGrant,
  insertClientEngagement,
} from './service-organization-fixtures.js';
import {
  insertMediaEntitlement,
  insertMediaRecord,
  insertPublicationItem,
  insertPublicationMediaDetail,
  insertPublicationVersion,
  insertPublishedClientUpdate,
} from './client-publication-fixtures.js';

export function buildGetClientExportManifest(
  db: Kysely<DatabaseSchema>,
  clock: Clock,
  storage: FakeMediaStorageGateway = new FakeMediaStorageGateway(),
): GetClientExportManifest {
  const clientPortalAuthorization = new ClientPortalAuthorization(
    new KyselyClientAccessGrantRepository(db),
    new KyselyClientEngagementRepository(db),
  );
  const clientMediaAccess = new GetClientMediaAccess(
    new KyselyMediaRepository(db),
    new KyselyClientMediaEntitlementSource(db),
    storage,
    fixedMediaClock(clock.now()),
  );

  return new GetClientExportManifest(
    clientPortalAuthorization,
    new KyselyClientPublicationReadRepository(db),
    new KyselyGardenRepository(db),
    new KyselyCoordinateSpaceRepository(db),
    new KyselyGeoreferenceRepository(db),
    new KyselyMapObjectRepository(db),
    new KyselyPlantRepository(db),
    clientMediaAccess,
    clock,
  );
}

export interface ClientExportScenarioOverrides {
  readonly engagementState?: string;
  readonly engagementExtra?: Row;
  readonly grantState?: string;
  readonly grantExtra?: Row;
  readonly publicationState?: string;
  readonly publicationExtra?: Row;
  readonly skipEntitlement?: boolean;
  readonly skipGardenContent?: boolean;
}

export interface ClientExportScenario {
  readonly staffId: string;
  readonly clientProfileId: string;
  readonly gardenId: string;
  readonly engagementId: string;
  readonly mapObjectId: string;
  readonly plantId: string;
  readonly clientUpdateId: string;
  readonly publicationVersionId: string;
  readonly publicationItemId: string;
  readonly mediaId: string;
}

/**
 * A COMPLETE, genuinely valid scenario — a garden with one accepted map
 * object and one plant, an active engagement, an active grant, and one
 * published update whose one `media` item is explicitly entitled. Every
 * test starts here and breaks exactly ONE condition, mirroring
 * `client-media-access-denial-matrix.test.ts`'s own `seedValidScenario`
 * shape.
 */
export async function seedClientExportScenario(
  pgClient: pg.Client,
  db: Kysely<DatabaseSchema>,
  overrides: ClientExportScenarioOverrides = {},
): Promise<ClientExportScenario> {
  const staffId = await insertProfile(pgClient);
  const clientProfileId = await insertProfile(pgClient);
  const gardenId = await insertGarden(pgClient, staffId);

  const engagementId = await insertClientEngagement(pgClient, gardenId, staffId, {
    state: overrides.engagementState ?? 'active',
    activated_at: new Date('2026-06-01T09:00:00Z'),
    ...overrides.engagementExtra,
  });
  await insertClientAccessGrant(pgClient, engagementId, {
    client_profile_id: clientProfileId,
    state: overrides.grantState ?? 'active',
    granted_at: new Date('2026-06-01T09:00:00Z'),
    ...overrides.grantExtra,
  });

  let mapObjectId = '';
  let plantId = '';
  let clientUpdateId = '';
  let publicationVersionId = '';
  let publicationItemId = '';
  let mediaId = '';

  // `skipGardenContent` builds the MINIMAL scenario a "the garden itself is
  // gone" test needs: engagement + grant only. `media.media_record.garden_id`
  // carries a REAL foreign key to `gardens_mapping.garden` (unlike
  // `client_engagement`/`publication_version`/`publication_item`, which
  // deliberately carry none) — inserting one here would make a later
  // `DELETE FROM gardens_mapping.garden` fail with a foreign-key violation,
  // so garden content, media, and publications are all skipped together.
  if (overrides.skipGardenContent !== true) {
    const mapObject = await insertMapObject(db, gardenId, staffId, 'North bed');
    mapObjectId = mapObject.objectId;
    plantId = await insertPlant(db, gardenId, staffId, 'Tomato row');

    const publicationExtra = overrides.publicationExtra ?? {};
    clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      engagementId,
      gardenId,
      staffId,
      staffId,
      {
        state: overrides.publicationState ?? 'published',
        title: 'June visit summary',
        // `client_update_withdrawn_by_linkage_check` requires
        // `withdrawn_by_profile_id` set exactly when `withdrawn_at` is.
        ...('withdrawn_at' in publicationExtra ? { withdrawn_by_profile_id: staffId } : {}),
        ...publicationExtra,
      },
    );
    publicationVersionId = await insertPublicationVersion(
      pgClient,
      clientUpdateId,
      engagementId,
      gardenId,
      staffId,
    );

    mediaId = await insertMediaRecord(pgClient, staffId, {
      garden_id: gardenId,
      processing_state: 'processed',
      bucket_name: 'test-user-media',
      object_key: `ab/client-export/${randomUUID()}`,
    });
    publicationItemId = await insertPublicationItem(
      pgClient,
      publicationVersionId,
      gardenId,
      'media',
    );
    await insertPublicationMediaDetail(pgClient, publicationItemId, mediaId);

    if (overrides.skipEntitlement !== true) {
      await insertMediaEntitlement(pgClient, engagementId, publicationVersionId, mediaId);
    }
  }

  return {
    staffId,
    clientProfileId,
    gardenId,
    engagementId,
    mapObjectId,
    plantId,
    clientUpdateId,
    publicationVersionId,
    publicationItemId,
    mediaId,
  };
}
