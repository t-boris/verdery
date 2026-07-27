/**
 * P9-QA-01 (Batch A), matrix 6 — MEDIA CROSS-PATH: THE SAME OBJECT, THREE
 * INDEPENDENT AUTHORIZATION PATHS.
 *
 * `media-attachment-authorization.test.ts`, `client-media-access-denial-
 * matrix.test.ts`, and `exports.test.ts`/`client-export-manifest.test.ts`
 * each already prove their OWN path's authorization is correct, in
 * isolation. This file's value is reaching the SAME media object through
 * ALL of `GetMediaAccess` (operational), `GetClientMediaAccess` (client),
 * and both export manifests AT ONCE, against the SAME garden — proving each
 * path's own gate is independently correct (never a shortcut through
 * another path), and then the genuinely novel claim: REVOCATION ISOLATION —
 * ending a client engagement removes the client's OWN path to the media
 * while the SAME media object remains fully reachable via the operational
 * path to the garden's own team, unaffected. Revoking one path must never
 * leave a stale grant reachable through a different one, and must never
 * accidentally sever an unrelated one either.
 *
 * Source: implementation-plan.md work packages P6-API-01, P9C-MEDIA-01,
 * P8-EXPORT-01, P9C-EXPORT-01; architecture/media-storage-and-processing.md,
 * section "12. Download Flow"; architecture/collaboration-and-client-
 * sharing.md, section "16. Media Access".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  EndClientEngagement,
  KyselyCollaborationUnitOfWork,
  KyselyOrganizationMembershipRepository,
  OrganizationAuthorization,
} from '../../src/modules/collaboration/public.js';
import {
  GardenAuthorization,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import {
  GetClientMediaAccess,
  GetMediaAccess,
  KyselyClientMediaEntitlementSource,
  KyselyMediaRepository,
} from '../../src/modules/media/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyAuditLogger } from '../../src/platform/audit/kysely-audit-logger.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertProfile } from '../support/collaboration-fixtures.js';
import { insertMembership as insertMembershipDb } from '../support/publication-integration-harness.js';
import {
  insertClientAccessGrant,
  insertClientEngagement,
} from '../support/service-organization-fixtures.js';
import {
  insertMediaEntitlement,
  insertMediaRecord,
  insertPublicationItem,
  insertPublicationMediaDetail,
  insertPublicationVersion,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';
import { buildGetClientExportManifest } from '../support/client-export-test-harness.js';
import { actorFor, buildExportHarness, runFullExport } from '../support/export-test-harness.js';

const SUITE_NAME = 'p9-qa: media cross-path (operational, client, export)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const NOW = new Date('2026-07-21T09:00:00Z');
const BUCKET = 'test-user-media';

function fixedClock(at: Date) {
  return { now: () => at };
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let pgClient: pg.Client;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });

    pgClient = new pg.Client({ connectionString: databaseUrl });
    await pgClient.connect();
  }, 120_000);

  afterAll(async () => {
    await pgClient.end();
    await db.destroy();
    await container?.stop();
  });

  function operationalMediaAccess(): GetMediaAccess {
    return new GetMediaAccess(
      new KyselyMediaRepository(db),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      new FakeMediaStorageGateway(),
      new KyselyAuditLogger(db, fixedClock(NOW)),
      fixedClock(NOW),
    );
  }

  function clientMediaAccess(): GetClientMediaAccess {
    return new GetClientMediaAccess(
      new KyselyMediaRepository(db),
      new KyselyClientMediaEntitlementSource(db),
      new FakeMediaStorageGateway(),
      new KyselyAuditLogger(db, fixedClock(NOW)),
      fixedClock(NOW),
    );
  }

  /** Owner/editor/viewer team, a standard-classified entitled media object, and a restricted-classified, never-published one — on ONE garden. */
  async function seedGardenWithTeamAndMedia() {
    const ownerId = await insertProfile(pgClient);
    const editorId = await insertProfile(pgClient);
    const viewerId = await insertProfile(pgClient);
    const gardenId = await insertGarden(pgClient, ownerId);
    await insertMembershipDb(db, gardenId, ownerId, 'owner');
    await insertMembershipDb(db, gardenId, editorId, 'editor');
    await insertMembershipDb(db, gardenId, viewerId, 'viewer');

    const standardMediaId = await insertMediaRecord(pgClient, ownerId, {
      garden_id: gardenId,
      sensitivity_classification: 'standard',
      processing_state: 'processed',
      bucket_name: BUCKET,
      object_key: `ab/p9-qa-cross-path/${randomUUID()}`,
    });
    // `media_class` deliberately stays the default, exportable
    // `garden_photo` — only `sensitivity_classification` varies here. Mixing
    // in `media_class: 'raw_capture'` would ALSO trip
    // `EXPORTABLE_MEDIA_CLASSES`'s own pre-existing, documented exclusion
    // (`kysely-garden-content-reader.ts`'s header: "never `raw_capture`
    // (separate sensitive-media permission, not implemented)") — a genuine
    // but UNRELATED P8-EXPORT-01 boundary this file does not mean to
    // exercise, so this fixture isolates the ONE axis (`sensitivity_
    // classification`) `GetMediaAccess`'s own viewer-restriction check
    // actually reads.
    const restrictedMediaId = await insertMediaRecord(pgClient, ownerId, {
      garden_id: gardenId,
      sensitivity_classification: 'restricted',
      processing_state: 'processed',
      bucket_name: BUCKET,
      object_key: `ab/p9-qa-cross-path/${randomUUID()}`,
    });

    const clientProfileId = await insertProfile(pgClient);
    const engagementId = await insertClientEngagement(pgClient, gardenId, ownerId, {
      state: 'active',
      activated_at: NOW,
    });
    await insertClientAccessGrant(pgClient, engagementId, {
      client_profile_id: clientProfileId,
      state: 'active',
      granted_at: NOW,
    });
    const clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      engagementId,
      gardenId,
      ownerId,
      ownerId,
    );
    const publicationVersionId = await insertPublicationVersion(
      pgClient,
      clientUpdateId,
      engagementId,
      gardenId,
      ownerId,
    );
    // Only the STANDARD media is ever entitled — the restricted one is
    // never selected for publication, exactly as section 11 requires
    // ("raw scans" excluded from publication contents). A real
    // `publication_item`(kind: media) is required too — `GetClientExport
    // Manifest.buildEntitledMedia` collects candidate media ids from the
    // publication's own ITEMS, then re-checks each through
    // `GetClientMediaAccess`; a bare `media_entitlement` row with no owning
    // item is not what a real `PublishClientUpdate` ever produces.
    const mediaItemId = await insertPublicationItem(
      pgClient,
      publicationVersionId,
      gardenId,
      'media',
    );
    await insertPublicationMediaDetail(pgClient, mediaItemId, standardMediaId);
    await insertMediaEntitlement(pgClient, engagementId, publicationVersionId, standardMediaId);

    return {
      ownerId,
      editorId,
      viewerId,
      gardenId,
      standardMediaId,
      restrictedMediaId,
      clientProfileId,
      engagementId,
    };
  }

  it('operational path: owner/editor read both standard and restricted media; a viewer reads standard but is refused restricted (gated differently, forbidden not notFound)', async () => {
    const scenario = await seedGardenWithTeamAndMedia();
    const access = operationalMediaAccess();

    await expect(
      access.execute(scenario.gardenId, scenario.standardMediaId, scenario.ownerId),
    ).resolves.toBeDefined();
    await expect(
      access.execute(scenario.gardenId, scenario.standardMediaId, scenario.editorId),
    ).resolves.toBeDefined();
    await expect(
      access.execute(scenario.gardenId, scenario.standardMediaId, scenario.viewerId),
    ).resolves.toBeDefined();

    await expect(
      access.execute(scenario.gardenId, scenario.restrictedMediaId, scenario.ownerId),
    ).resolves.toBeDefined();
    await expect(
      access.execute(scenario.gardenId, scenario.restrictedMediaId, scenario.editorId),
    ).resolves.toBeDefined();
    await expect(
      access.execute(scenario.gardenId, scenario.restrictedMediaId, scenario.viewerId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('client path: the entitled client reaches the STANDARD media; the RESTRICTED media (never published, never entitled) is unreachable regardless of its sensitivity classification — a different gate than the operational viewer restriction, never consulted', async () => {
    const scenario = await seedGardenWithTeamAndMedia();
    const access = clientMediaAccess();

    await expect(
      access.execute(scenario.clientProfileId, scenario.standardMediaId),
    ).resolves.toBeDefined();
    await expect(
      access.execute(scenario.clientProfileId, scenario.restrictedMediaId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('export path: the operational export includes BOTH media records regardless of publish state; the client export manifest includes only the entitled STANDARD one', async () => {
    const scenario = await seedGardenWithTeamAndMedia();

    const exportHarness = buildExportHarness(db, fixedClock(NOW));
    const requested = await exportHarness.requestExport.execute(
      actorFor(scenario.ownerId, NOW),
      { scope: 'garden', gardenId: scenario.gardenId, includeMedia: true },
      randomUUID(),
    );
    const snapshot = await runFullExport(exportHarness, requested.id);
    const mediaSection = snapshot.sections.find((section) =>
      section.entryPath.endsWith('media-records.json'),
    );
    expect(mediaSection).toBeDefined();
    expect(mediaSection?.content).toContain(scenario.standardMediaId);
    expect(mediaSection?.content).toContain(scenario.restrictedMediaId);

    const clientExportManifest = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifest = await clientExportManifest.execute(
      scenario.clientProfileId,
      scenario.engagementId,
    );
    const manifestMediaIds = manifest.media.map((entry) => entry.mediaId);
    expect(manifestMediaIds).toContain(scenario.standardMediaId);
    expect(manifestMediaIds).not.toContain(scenario.restrictedMediaId);
  });

  it('revocation isolation: ending the client engagement removes the client’s OWN path to the standard media, while the SAME media object remains fully accessible via the operational path to owner/editor/viewer', async () => {
    const scenario = await seedGardenWithTeamAndMedia();
    const operational = operationalMediaAccess();
    const client = clientMediaAccess();

    // Before: both paths genuinely work.
    await expect(
      operational.execute(scenario.gardenId, scenario.standardMediaId, scenario.ownerId),
    ).resolves.toBeDefined();
    await expect(
      client.execute(scenario.clientProfileId, scenario.standardMediaId),
    ).resolves.toBeDefined();

    const endEngagement = new EndClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(NOW)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(NOW)),
      new OrganizationAuthorization(new KyselyOrganizationMembershipRepository(db)),
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      fixedClock(NOW),
    );
    await endEngagement.execute(scenario.engagementId, scenario.ownerId, randomUUID());

    // After: the CLIENT path is cut off...
    await expect(
      client.execute(scenario.clientProfileId, scenario.standardMediaId),
    ).rejects.toBeInstanceOf(NotFoundError);

    // ...but the SAME media object, via the OPERATIONAL path, is entirely
    // unaffected for every operational role — ending a client engagement
    // never touches `collaboration.membership` at all.
    await expect(
      operational.execute(scenario.gardenId, scenario.standardMediaId, scenario.ownerId),
    ).resolves.toBeDefined();
    await expect(
      operational.execute(scenario.gardenId, scenario.standardMediaId, scenario.editorId),
    ).resolves.toBeDefined();
    await expect(
      operational.execute(scenario.gardenId, scenario.standardMediaId, scenario.viewerId),
    ).resolves.toBeDefined();
  });
});
