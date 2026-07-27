/**
 * ENGAGEMENT-END AND DELETION CONSISTENCY — the second half of
 * P9C-EXPORT-01's completion evidence ("Export manifest, entitlement,
 * engagement-end, and deletion tests"); manifest/entitlement coverage lives
 * in `client-export-manifest.test.ts`, split for the same 600-line reason.
 *
 * ENGAGEMENT-END: proves `ClientPortalAuthorization.
 * requireExportableGardenAccess`'s one deliberate widening beyond every
 * other `ClientPortal` read — `ended` remains exportable (section 18 step
 * 2's handoff promise), `revoked` and `draft` do not (section 8's blanket
 * rule) — and, in the same breath, the GENUINE GAP this package's own
 * instructions ask to be flagged rather than invented around: an ended
 * engagement's MEDIA becomes unavailable immediately (no configured
 * "handoff window" exists anywhere in this codebase yet), even though its
 * structured garden-model/publication content stays fully producible.
 *
 * DELETION: proves the client export behaves consistently with the
 * EXISTING export system's own retention posture — never a different one
 * invented for the client-facing copy of the same underlying data. Section
 * 10.1's own schema fact makes this provable directly: `client_engagement.
 * garden_id` carries NO foreign key specifically so the engagement record
 * survives a garden purge, but this command still refuses once
 * `GardenRepository.findById` can no longer resolve a live garden row (or
 * once the garden reaches `purging`, mirroring the operational
 * `exportGarden` capability's own refusal at that exact state).
 *
 * Source: architecture/collaboration-and-client-sharing.md, sections
 * "8. Client Engagement", "18. Data Stewardship, Export, and Engagement
 * End"; architecture/data-export-and-deletion.md, section "10. Garden
 * Deletion"; implementation-plan.md work package P9C-EXPORT-01.
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertProfile } from '../support/collaboration-fixtures.js';
import {
  buildGetClientExportManifest,
  seedClientExportScenario,
} from '../support/client-export-test-harness.js';

const SUITE_NAME = 'client export manifest — engagement-end and deletion';
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

  describe('engagement-end', () => {
    it('an ENDED engagement remains exportable — garden model and publications still returned', async () => {
      const scenario = await seedClientExportScenario(pgClient, db, {
        engagementState: 'ended',
        engagementExtra: { ended_at: new Date('2026-06-25T09:00:00Z') },
      });

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
      const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

      expect(manifest.gardenModel.mapObjects.map((object) => object.id)).toContain(
        scenario.mapObjectId,
      );
      expect(manifest.publications).toHaveLength(1);
    });

    it("the GENUINE GAP: an ENDED engagement's media is unavailable immediately — no configured handoff window softens this yet", async () => {
      const scenario = await seedClientExportScenario(pgClient, db, {
        engagementState: 'ended',
        engagementExtra: { ended_at: new Date('2026-06-25T09:00:00Z') },
      });

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
      const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

      // The publication ITEM still names the media id (structured content
      // is unaffected); only the `media` entitlement list goes empty,
      // because `GetClientMediaAccess` itself requires an `active`
      // engagement with no exception yet for a recently-ended one.
      expect(
        manifest.publications[0]?.items.some((item) => item.mediaId === scenario.mediaId),
      ).toBe(true);
      expect(manifest.media).toHaveLength(0);
    });

    it('a REVOKED engagement is refused — the blanket "ended or revoked cannot authorize new access" rule, unrelaxed for revocation', async () => {
      const scenario = await seedClientExportScenario(pgClient, db, {
        engagementState: 'revoked',
        engagementExtra: { revoked_at: new Date('2026-06-25T09:00:00Z') },
      });

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));

      await expect(
        useCase.execute(scenario.clientProfileId, scenario.engagementId),
      ).rejects.toMatchObject({ category: 'notFound' });
    });

    it('a DRAFT (never activated) engagement is refused', async () => {
      const scenario = await seedClientExportScenario(pgClient, db, {
        engagementState: 'draft',
        engagementExtra: { activated_at: null },
      });

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));

      await expect(
        useCase.execute(scenario.clientProfileId, scenario.engagementId),
      ).rejects.toMatchObject({ category: 'notFound' });
    });

    it('a caller with no active grant on this engagement at all is refused — the concealed not-found, never a distinguishable answer', async () => {
      const scenario = await seedClientExportScenario(pgClient, db);
      const strangerProfileId = await insertProfile(pgClient);

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));

      await expect(useCase.execute(strangerProfileId, scenario.engagementId)).rejects.toMatchObject(
        { category: 'notFound' },
      );
    });

    it("cross-client: client B's own active grant does not authorize client A's engagement", async () => {
      const scenarioA = await seedClientExportScenario(pgClient, db);
      const scenarioB = await seedClientExportScenario(pgClient, db);

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));

      await expect(
        useCase.execute(scenarioB.clientProfileId, scenarioA.engagementId),
      ).rejects.toMatchObject({ category: 'notFound' });
      // B's own engagement is unaffected.
      await expect(
        useCase.execute(scenarioB.clientProfileId, scenarioB.engagementId),
      ).resolves.toBeDefined();
    });
  });

  describe('deletion consistency', () => {
    it('refuses once the underlying garden row no longer exists — the same posture a genuinely unknown clientGardenId gets', async () => {
      const scenario = await seedClientExportScenario(pgClient, db, { skipGardenContent: true });
      // `client_engagement.garden_id` deliberately carries no foreign key
      // (section 10.1's own migration note), so this delete succeeds even
      // though the engagement/grant rows keep pointing at the now-gone id —
      // exactly the shape a completed purge leaves behind.
      await db.deleteFrom('gardens_mapping.garden').where('id', '=', scenario.gardenId).execute();

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));

      await expect(
        useCase.execute(scenario.clientProfileId, scenario.engagementId),
      ).rejects.toMatchObject({ category: 'notFound' });
    });

    it("refuses while the garden is `purging` — mirrors the operational exportGarden capability's own refusal at that exact state", async () => {
      const scenario = await seedClientExportScenario(pgClient, db);
      // `garden_recovery_deadline_linkage_check` requires
      // `recovery_deadline_at` set exactly when `lifecycle_state` is
      // `deletion_requested`/`purging` — the real deletion workflow's own
      // invariant, reproduced here rather than bypassed.
      await db
        .updateTable('gardens_mapping.garden')
        .set({ lifecycle_state: 'purging', recovery_deadline_at: new Date('2026-07-01T09:00:00Z') })
        .where('id', '=', scenario.gardenId)
        .execute();

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));

      await expect(
        useCase.execute(scenario.clientProfileId, scenario.engagementId),
      ).rejects.toMatchObject({ category: 'notFound' });
    });

    it("stays available while the garden is `deletion_requested` — mirrors the operational exportGarden capability's own posture exactly, never a different retention rule for the client-facing copy", async () => {
      const scenario = await seedClientExportScenario(pgClient, db);
      await db
        .updateTable('gardens_mapping.garden')
        .set({
          lifecycle_state: 'deletion_requested',
          recovery_deadline_at: new Date('2026-08-20T09:00:00Z'),
        })
        .where('id', '=', scenario.gardenId)
        .execute();

      const useCase = buildGetClientExportManifest(db, fixedClock(NOW));
      const manifest = await useCase.execute(scenario.clientProfileId, scenario.engagementId);

      expect(manifest.gardenModel.lifecycleState).toBe('deletionRequested');
      expect(manifest.gardenModel.mapObjects.map((object) => object.id)).toContain(
        scenario.mapObjectId,
      );
    });
  });
});
