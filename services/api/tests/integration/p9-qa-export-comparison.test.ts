/**
 * P9-QA-01 (Batch A), matrix 7 — OPERATIONAL EXPORT vs. CLIENT EXPORT,
 * COMPARED AGAINST THE SAME FIXTURE.
 *
 * `exports-privacy.test.ts` already proves the operational export's own
 * privacy boundaries in isolation; `client-export-manifest.test.ts` already
 * proves the client manifest excludes provider-internal and unpublished
 * content, also in isolation. This file's value is running BOTH exports
 * against the SAME garden, the SAME realistic mix of published and
 * unpublished content, in ONE test — so "operational is not wrongly
 * restricted to published-only" and "client never leaks unpublished/
 * internal content" are proven as one comparative claim over one fixture,
 * not two independently-trusted assumptions that happened to each pass
 * their own separate suite.
 *
 * Source: implementation-plan.md work packages P8-EXPORT-01, P9C-EXPORT-01;
 * architecture/data-export-and-deletion.md; architecture/collaboration-and-
 * client-sharing.md, section "18. Data Stewardship, Export, and Engagement
 * End".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  actorFor,
  addMember,
  buildExportHarness,
  insertObservation,
  insertRecommendation,
  insertTask,
  runFullExport,
} from '../support/export-test-harness.js';
import { insertMediaRecord } from '../support/client-publication-fixtures.js';
import {
  buildGetClientExportManifest,
  seedClientExportScenario,
} from '../support/client-export-test-harness.js';

const SUITE_NAME = 'p9-qa: export comparison (operational vs. client, same fixture)';
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
  }, 120_000);

  afterAll(async () => {
    await pgClient.end();
    await db.destroy();
    await container?.stop();
  });

  it('operational export includes provider-internal, never-published content the client export manifest excludes — both directions proven against the SAME fixture', async () => {
    // One fixture: an accepted garden model, an active engagement, and one
    // PUBLISHED update with a client-safe garden snapshot — plus provider-
    // internal operational records (observation/task/recommendation) that
    // were never published, and never will be.
    const scenario = await seedClientExportScenario(pgClient, db);
    // The operational export authorizes through ordinary `exportGarden`
    // (owner-only) — `seedClientExportScenario`'s own `staffId` is only the
    // garden's `created_by_profile_id`, not yet an operational member, so a
    // real owner membership is added here for the operational half of this
    // comparison.
    await addMember(db, scenario.gardenId, scenario.staffId, 'owner');
    await insertObservation(
      db,
      scenario.gardenId,
      scenario.plantId,
      scenario.staffId,
      'P9-QA-INTERNAL-NOTE: aphids on the north bed roses',
    );
    await insertTask(
      db,
      scenario.gardenId,
      scenario.plantId,
      scenario.staffId,
      'P9-QA-INTERNAL-TASK: schedule a follow-up spray',
    );
    await insertRecommendation(db, scenario.gardenId, scenario.plantId, 'P9-QA-INTERNAL-RULE');

    // --- Operational export (P8) -----------------------------------------
    const exportHarness = buildExportHarness(db, fixedClock(NOW));
    const requested = await exportHarness.requestExport.execute(
      actorFor(scenario.staffId, NOW),
      { scope: 'garden', gardenId: scenario.gardenId, includeMedia: true },
      randomUUID(),
    );
    const snapshot = await runFullExport(exportHarness, requested.id);
    const operationalContent = snapshot.sections.map((section) => section.content).join('\n');

    // --- Client export manifest (P9C-EXPORT-01) --------------------------
    const clientExportManifest = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifest = await clientExportManifest.execute(
      scenario.clientProfileId,
      scenario.engagementId,
    );
    const clientContent = JSON.stringify(manifest);

    // DIRECTION 1: the operational export is NOT wrongly restricted to
    // published-only content — every provider-internal record appears,
    // exactly as an owner reviewing their own garden's full operational
    // history expects.
    expect(operationalContent).toContain('P9-QA-INTERNAL-NOTE');
    expect(operationalContent).toContain('P9-QA-INTERNAL-TASK');
    expect(operationalContent).toContain('P9-QA-INTERNAL-RULE');

    // DIRECTION 2: the client export NEVER includes internal/unpublished
    // material — the identical markers, entirely absent from the client's
    // own manifest of the SAME garden.
    expect(clientContent).not.toContain('P9-QA-INTERNAL-NOTE');
    expect(clientContent).not.toContain('P9-QA-INTERNAL-TASK');
    expect(clientContent).not.toContain('P9-QA-INTERNAL-RULE');

    // And the client manifest is not simply empty — it genuinely includes
    // the published deliverable, proving direction 2 is a real exclusion,
    // not an accident of an empty response.
    expect(manifest.publications).toHaveLength(1);
    expect(manifest.gardenModel.plants.map((plant) => plant.id)).toContain(scenario.plantId);
  });

  it('the SAME garden’s media: operational export includes every media record regardless of publish state; client export includes ONLY the published, entitled one', async () => {
    const scenario = await seedClientExportScenario(pgClient, db);
    await addMember(db, scenario.gardenId, scenario.staffId, 'owner');

    // A SECOND media record on the same garden, never entitled to the
    // client at all — a photo the professional uploaded but never selected
    // for any publication.
    const unpublishedMediaId = await insertMediaRecord(pgClient, scenario.staffId, {
      garden_id: scenario.gardenId,
      processing_state: 'processed',
      bucket_name: 'test-user-media',
      object_key: `ab/p9-qa-export-comparison/${randomUUID()}`,
    });

    const exportHarness = buildExportHarness(db, fixedClock(NOW));
    const requested = await exportHarness.requestExport.execute(
      actorFor(scenario.staffId, NOW),
      { scope: 'garden', gardenId: scenario.gardenId, includeMedia: true },
      randomUUID(),
    );
    const snapshot = await runFullExport(exportHarness, requested.id);
    const mediaSection = snapshot.sections.find((section) =>
      section.entryPath.endsWith('media-records.json'),
    );
    expect(mediaSection?.content).toContain(scenario.mediaId);
    expect(mediaSection?.content).toContain(unpublishedMediaId);

    const clientExportManifest = buildGetClientExportManifest(db, fixedClock(NOW));
    const manifest = await clientExportManifest.execute(
      scenario.clientProfileId,
      scenario.engagementId,
    );
    const manifestMediaIds = manifest.media.map((entry) => entry.mediaId);
    expect(manifestMediaIds).toContain(scenario.mediaId);
    expect(manifestMediaIds).not.toContain(unpublishedMediaId);
  });
});
