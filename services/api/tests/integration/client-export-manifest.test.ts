/**
 * THE CLIENT EXPORT MANIFEST — P9C-EXPORT-01's own completion evidence:
 * "Export manifest, entitlement, engagement-end, and deletion tests."
 *
 * This suite covers the first two: the MANIFEST (accepted garden model plus
 * currently published deliverables, with provider-internal operational
 * records and unpublished/withdrawn content genuinely absent — not merely
 * undocumented) and ENTITLEMENT (a media item the client is not entitled to
 * never appears, proven the same way `client-media-access-denial-matrix.
 * test.ts` proves it for the live media-access route). Engagement-end and
 * deletion consistency live in `client-export-manifest-lifecycle.test.ts` —
 * split for the same 600-line reason every `*.test.ts` file in this
 * codebase already respects.
 *
 * Every scenario runs against REAL PostgreSQL and the REAL Kysely adapters
 * `GetClientExportManifest` is composed from in production
 * (`compose-exports.ts`) — never fakes, and never through
 * `GardenAuthorization`'s operational (garden-role) path, which this
 * command never touches at all.
 *
 * Source: implementation-plan.md work package P9C-EXPORT-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "18. Data Stewardship, Export, and Engagement End".
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  insertObservation,
  insertRecommendation,
  insertTask,
} from '../support/export-test-harness.js';
import {
  insertPublicationGardenSnapshotDetail,
  insertPublicationItem,
} from '../support/client-publication-fixtures.js';
import {
  buildGetClientExportManifest,
  seedClientExportScenario,
} from '../support/client-export-test-harness.js';
import { auditEventFor } from '../support/collaboration-integration-harness.js';

const SUITE_NAME = 'client export manifest';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const NOW = new Date('2026-07-21T09:00:00Z');

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
  });

  afterAll(async () => {
    await pgClient.end();
    await db.destroy();
    await container?.stop();
  });

  it('includes the accepted garden model and every currently published deliverable, with a genuinely entitled media item, when every condition holds', async () => {
    const scenario = await seedClientExportScenario(pgClient, db);
    const storage = new FakeMediaStorageGateway();
    const useCase = buildGetClientExportManifest(db, fixedClock(NOW), storage);

    const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

    expect(manifest.clientGardenId).toBe(scenario.engagementId);
    expect(manifest.gardenModel.id).toBe(scenario.gardenId);
    expect(manifest.gardenModel.mapObjects.map((object) => object.id)).toContain(
      scenario.mapObjectId,
    );
    expect(manifest.gardenModel.plants.map((plant) => plant.id)).toContain(scenario.plantId);
    expect(manifest.publications).toHaveLength(1);
    expect(manifest.publications[0]?.id).toBe(scenario.publicationVersionId);
    expect(manifest.media).toHaveLength(1);
    expect(manifest.media[0]?.mediaId).toBe(scenario.mediaId);
    expect(manifest.media[0]?.access.url).toContain('test-user-media');
    expect(storage.createSignedUrlCalls).toHaveLength(1);

    // P9C-OBS-01: "export" is its own required audit category (section
    // 19) — a real `platform.audit_event` row, distinct from (and in
    // addition to) the per-media `client_media.access_granted` row
    // `GetClientMediaAccess` already writes for the one entitled item.
    const exportAudit = await auditEventFor(
      db,
      scenario.engagementId,
      'client_export.manifest_generated',
    );
    expect(exportAudit).toBeDefined();
    expect(exportAudit?.details).toMatchObject({ publicationCount: 1, mediaCount: 1 });
    // Prohibited-content telemetry: never the garden model, media id, or
    // signed URL — only counts.
    const serializedExportAudit = JSON.stringify(exportAudit?.details);
    expect(serializedExportAudit).not.toContain(scenario.mediaId);
    expect(serializedExportAudit).not.toContain(scenario.gardenId);
    expect(serializedExportAudit).not.toContain(manifest.media[0]?.access.url);

    const mediaAudit = await auditEventFor(db, scenario.mediaId, 'client_media.access_granted');
    expect(mediaAudit).toBeDefined();
    expect(JSON.stringify(mediaAudit?.details)).not.toContain(manifest.media[0]?.access.url);
  });

  it('excludes provider-internal operational records — observations, tasks, and recommendations never appear, genuinely absent from the wire response', async () => {
    const scenario = await seedClientExportScenario(pgClient, db);
    await insertObservation(
      db,
      scenario.gardenId,
      scenario.plantId,
      scenario.staffId,
      'INTERNAL-NOTE-marker: aphids spotted on the north bed roses',
    );
    await insertTask(
      db,
      scenario.gardenId,
      scenario.plantId,
      scenario.staffId,
      'INTERNAL-TASK-marker: schedule a follow-up spray',
    );
    await insertRecommendation(db, scenario.gardenId, scenario.plantId, 'INTERNAL-RULE-marker');

    const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('INTERNAL-NOTE-marker');
    expect(serialized).not.toContain('INTERNAL-TASK-marker');
    expect(serialized).not.toContain('INTERNAL-RULE-marker');
  });

  it('excludes a soft-deleted map object — the accepted CURRENT state, never history', async () => {
    const scenario = await seedClientExportScenario(pgClient, db);
    await db
      .updateTable('gardens_mapping.garden_object')
      .set({ lifecycle_state: 'deleted' })
      .where('id', '=', scenario.mapObjectId)
      .execute();

    const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

    expect(manifest.gardenModel.mapObjects.map((object) => object.id)).not.toContain(
      scenario.mapObjectId,
    );
  });

  it('excludes a WITHDRAWN publication — "published deliverables" means CURRENTLY published, not ever published', async () => {
    const scenario = await seedClientExportScenario(pgClient, db, {
      publicationExtra: {
        title: 'WITHDRAWN-marker visit summary',
        state: 'withdrawn',
        withdrawn_at: new Date('2026-06-20T09:00:00Z'),
      },
    });

    const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

    expect(manifest.publications).toHaveLength(0);
    expect(JSON.stringify(manifest)).not.toContain('WITHDRAWN-marker');
  });

  it('excludes unpublished work — a publication_version whose OWNING client_update is internal_draft never appears, even though the version row itself physically exists', async () => {
    // The seed helper's `publication_version`/`publication_item`/
    // `media_entitlement` rows are inserted regardless of `state` (the
    // schema permits it; nothing links a version row's existence to its
    // client_update's CURRENT state — the identical fact section 10 relies
    // on for withdrawal: "does not erase the publication identity"). What
    // must hold is that `listVisibleForEngagement`'s join reads the LIVE
    // `client_update.state`, not the version's presence, to decide
    // visibility — proven here with `internal_draft` exactly as the
    // withdrawn test above proves it with `withdrawn`.
    const scenario = await seedClientExportScenario(pgClient, db, {
      publicationState: 'internal_draft',
      publicationExtra: {
        title: 'DRAFT-marker visit summary',
        summary: null,
        submitted_at: null,
        published_at: null,
        published_by_profile_id: null,
      },
    });

    const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

    expect(manifest.publications).toHaveLength(0);
    expect(JSON.stringify(manifest)).not.toContain('DRAFT-marker');
  });

  it('entitlement: a media item with NO media_entitlement row is silently absent from `media`, even though the publication item still names it', async () => {
    const scenario = await seedClientExportScenario(pgClient, db, { skipEntitlement: true });

    const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

    expect(manifest.publications[0]?.items.some((item) => item.mediaId === scenario.mediaId)).toBe(
      true,
    );
    expect(manifest.media).toHaveLength(0);
  });

  it("scopes publication content to exactly one engagement — a garden_snapshot item published for a DIFFERENT engagement never appears in this one's manifest", async () => {
    const scenarioA = await seedClientExportScenario(pgClient, db);
    const snapshotItemId = await insertPublicationItem(
      pgClient,
      scenarioA.publicationVersionId,
      scenarioA.gardenId,
      'garden_snapshot',
    );
    await insertPublicationGardenSnapshotDetail(pgClient, snapshotItemId, {
      overview_text: 'SNAPSHOT-A-marker overview',
    });
    const scenarioB = await seedClientExportScenario(pgClient, db);

    const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifestB = await useCase.execute(scenarioB.clientProfileId, scenarioB.engagementId);

    expect(JSON.stringify(manifestB)).not.toContain('SNAPSHOT-A-marker');
  });
});
