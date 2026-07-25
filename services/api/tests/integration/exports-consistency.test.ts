/**
 * P8-EXPORT-01 consistency acceptance evidence on real PostgreSQL: the
 * recorded boundary is real. Mutations after the checkpointed snapshot
 * never enter the export (a redelivered snapshot serves checkpoints, not
 * fresh reads); a retry BEFORE any checkpoint re-reads everything as one
 * NEW consistent set (never a mix of two boundaries); and the sections'
 * internal cross-references are closed — every referenced row travels in
 * the same package, because every read shared one repeatable-read
 * snapshot.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ExportSnapshotResponse } from '@verdery/api-contracts';
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
  buildExportHarness,
  buildMediaUploadHarness,
  createGardenOwnedBy,
  createProfile,
  fixedClock,
  insertMapObject,
  insertObservation,
  insertPlant,
  insertRecommendation,
  insertTask,
  runFullExport,
  stageSections,
  uploadAvailableMedia,
} from '../support/export-test-harness.js';

const SUITE_NAME = 'exports consistency integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const NOW = new Date('2026-07-25T09:00:00Z');

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function sectionContent(snapshot: ExportSnapshotResponse, entryPath: string): string {
  return snapshot.sections.find((section) => section.entryPath === entryPath)?.content ?? '';
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  it('rows created after the checkpointed boundary never enter the export — a redelivered snapshot serves the frozen checkpoints', async () => {
    const clock = fixedClock(NOW);
    const harness = buildExportHarness(db, clock);
    const owner = await createProfile(db);
    const gardenId = await createGardenOwnedBy(db, owner, 'Boundary garden', clock);
    await insertPlant(db, gardenId, owner, 'Plant before boundary');

    const requested = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );

    const snapshot = await harness.runExportSnapshot.execute(requested.id);
    const plantsBefore = sectionContent(snapshot, `gardens/${gardenId}/plants.json`);
    expect(plantsBefore).toContain('Plant before boundary');
    await harness.recordExportCheckpoints.execute(requested.id, {
      boundaryAt: snapshot.boundaryAt as string,
      sections: stageSections(snapshot),
    });

    // CONCURRENT MUTATION while the export is mid-generation.
    await insertPlant(db, gardenId, owner, 'Plant after boundary');
    await insertObservation(db, gardenId, null, owner, 'Observation after boundary');

    // A retried/redelivered snapshot re-reads NOTHING: the checkpointed
    // section set — and therefore the eventual ZIP — is frozen at the
    // recorded boundary, so the post-boundary rows are absent by
    // construction, not by luck.
    const redelivered = await harness.runExportSnapshot.execute(requested.id);
    expect(redelivered.sections).toHaveLength(0);
    expect(redelivered.boundaryAt).toBe(snapshot.boundaryAt);
    expect(redelivered.checkpoints.map((checkpoint) => checkpoint.entryPath).sort()).toEqual(
      snapshot.sections.map((section) => section.entryPath).sort(),
    );
    // The frozen checkpoint checksums are the FIRST snapshot's — bytes
    // containing 'Plant after boundary' would hash differently.
    const stagedPlants = stageSections(snapshot).find(
      (section) => section.entryPath === `gardens/${gardenId}/plants.json`,
    );
    expect(
      redelivered.checkpoints.find(
        (checkpoint) => checkpoint.entryPath === `gardens/${gardenId}/plants.json`,
      )?.checksumSha256,
    ).toBe(stagedPlants?.checksumSha256);

    // The manifest disclosed exactly this boundary to the user.
    const manifest = JSON.parse(sectionContent(snapshot, 'export.json')) as {
      boundaryAt: string;
      disclosures: string[];
    };
    expect(manifest.boundaryAt).toBe(snapshot.boundaryAt);
    expect(manifest.disclosures.join(' ')).toContain('boundaryAt');

    await harness.completeExport.execute(requested.id, {
      outcome: 'failed_terminal',
      failureCode: 'test_cleanup',
    });
  });

  it('a retry BEFORE any checkpoint re-reads everything as one NEW snapshot — never a mix of two boundaries', async () => {
    const laterClock = {
      at: NOW,
      now(): Date {
        return this.at;
      },
    };
    const harness = buildExportHarness(db, laterClock);
    const owner = await createProfile(db);
    const gardenId = await createGardenOwnedBy(db, owner, 'Retry garden', laterClock);
    await insertPlant(db, gardenId, owner, 'Plant in first attempt');

    const requested = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'account', gardenId: null, includeMedia: true },
      randomUUID(),
    );

    const firstAttempt = await harness.runExportSnapshot.execute(requested.id);
    expect(sectionContent(firstAttempt, `gardens/${gardenId}/plants.json`)).not.toContain(
      'Plant in second attempt',
    );

    // The first attempt crashes before checkpointing; a mutation lands.
    await insertPlant(db, gardenId, owner, 'Plant in second attempt');
    laterClock.at = new Date(NOW.getTime() + 60_000);

    const secondAttempt = await harness.runExportSnapshot.execute(requested.id);
    // The retry served a FULL fresh section set under a NEW boundary…
    expect(secondAttempt.sections.length).toBeGreaterThan(0);
    expect(secondAttempt.boundaryAt).not.toBe(firstAttempt.boundaryAt);
    // …that includes the mutation consistently in BOTH the data section
    // and the manifest (one snapshot, not a mix).
    const plants = sectionContent(secondAttempt, `gardens/${gardenId}/plants.json`);
    expect(plants).toContain('Plant in first attempt');
    expect(plants).toContain('Plant in second attempt');
    const manifest = JSON.parse(sectionContent(secondAttempt, 'export.json')) as {
      boundaryAt: string;
    };
    expect(manifest.boundaryAt).toBe(secondAttempt.boundaryAt);

    // The attempt count reports both begins honestly.
    const row = await db
      .selectFrom('exports.export_request')
      .select(['attempt_count'])
      .where('id', '=', requested.id)
      .executeTakeFirstOrThrow();
    expect(row.attempt_count).toBe(2);

    await harness.completeExport.execute(requested.id, {
      outcome: 'failed_terminal',
      failureCode: 'test_cleanup',
    });
  });

  it("the sections' internal cross-references are closed: every referenced row travels in the same package", async () => {
    const clock = fixedClock(NOW);
    const harness = buildExportHarness(db, clock);
    const owner = await createProfile(db);
    const gardenId = await createGardenOwnedBy(db, owner, 'Coherence garden', clock);
    const plantId = await insertPlant(db, gardenId, owner, 'Referenced plant');
    await insertObservation(db, gardenId, plantId, owner, 'Observation referencing the plant');
    await insertTask(db, gardenId, plantId, owner, 'Task referencing the plant');
    const { objectId, coordinateSpaceId } = await insertMapObject(db, gardenId, owner, 'Bed');
    await insertRecommendation(db, gardenId, plantId, 'coherence_rule');
    const media = buildMediaUploadHarness(db, clock);
    const mediaId = await uploadAvailableMedia(media, gardenId, owner, 'referenced.jpg');
    await db
      .insertInto('plants_inventory.plant_photo')
      .values({ id: randomUUID(), plant_id: plantId, media_id: mediaId })
      .execute();

    const requested = await harness.requestExport.execute(
      actorFor(owner, NOW),
      { scope: 'garden', gardenId, includeMedia: true },
      randomUUID(),
    );
    const snapshot = await runFullExport(harness, requested.id);
    const prefix = `gardens/${gardenId}`;

    const plants = JSON.parse(sectionContent(snapshot, `${prefix}/plants.json`)) as {
      plants: { id: string }[];
      photos: { plantId: string; mediaId: string }[];
    };
    const observations = JSON.parse(sectionContent(snapshot, `${prefix}/observations.json`)) as {
      observations: { plantId: string | null }[];
    };
    const tasks = JSON.parse(sectionContent(snapshot, `${prefix}/tasks.json`)) as {
      tasks: { targetPlantId: string | null }[];
    };
    const recommendations = JSON.parse(
      sectionContent(snapshot, `${prefix}/recommendations.json`),
    ) as {
      recommendations: { id: string; targetPlantId: string | null }[];
      evidence: { candidateId: string; sourcePlantId: string | null }[];
    };
    const geojson = JSON.parse(sectionContent(snapshot, `${prefix}/map-objects.geojson`)) as {
      features: { id: string; properties: { coordinateSpaceId: string } }[];
      'verdery:coordinateSpaces': { id: string }[];
    };
    const mediaRecords = JSON.parse(sectionContent(snapshot, `${prefix}/media-records.json`)) as {
      mediaRecords: { id: string }[];
    };

    const plantIds = new Set(plants.plants.map((plant) => plant.id));
    const candidateIds = new Set(
      recommendations.recommendations.map((recommendation) => recommendation.id),
    );
    const spaceIds = new Set(geojson['verdery:coordinateSpaces'].map((space) => space.id));
    const mediaIds = new Set(mediaRecords.mediaRecords.map((record) => record.id));

    for (const observation of observations.observations) {
      if (observation.plantId !== null) expect(plantIds.has(observation.plantId)).toBe(true);
    }
    for (const task of tasks.tasks) {
      if (task.targetPlantId !== null) expect(plantIds.has(task.targetPlantId)).toBe(true);
    }
    for (const evidence of recommendations.evidence) {
      expect(candidateIds.has(evidence.candidateId)).toBe(true);
      if (evidence.sourcePlantId !== null) expect(plantIds.has(evidence.sourcePlantId)).toBe(true);
    }
    for (const feature of geojson.features) {
      expect(spaceIds.has(feature.properties.coordinateSpaceId)).toBe(true);
    }
    for (const photo of plants.photos) {
      expect(plantIds.has(photo.plantId)).toBe(true);
      expect(mediaIds.has(photo.mediaId)).toBe(true);
    }
    expect(geojson.features.some((feature) => feature.id === objectId)).toBe(true);
    expect(spaceIds.has(coordinateSpaceId)).toBe(true);
  });
});
