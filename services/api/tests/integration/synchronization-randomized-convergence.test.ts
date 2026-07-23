/**
 * Randomized convergence — the one genuinely new mechanism this work package
 * (P5-QA-01) adds, not a gap-fill for existing coverage: architecture/
 * offline-synchronization.md, section "14.1 Independent Objects" ("Changes
 * to different object IDs merge naturally through independent revisions")
 * and section "24. Testing Matrix"'s implicit requirement that a client's
 * exact batching/ordering choices never change the server's converged final
 * state for operations with no real dependency between them.
 *
 * ## Mechanism: seeded manual randomization, not a property-testing library
 *
 * Neither `package.json` (root, `services/api`, or `apps/web`) nor
 * `apps/ios/Package.swift` declares `fast-check`, `SwiftCheck`, or any other
 * property-based testing dependency anywhere in this repository today
 * (confirmed by inspection before writing this file — this repository's own
 * rule requires checking for an adequate existing tool before adding a new
 * third-party dependency, and none exists here to reuse). A property-testing
 * library would only really buy shrinking on failure; this file's own
 * mulberry32 PRNG, seeded per trial, gives the same "many random orderings,
 * fully reproducible from a logged seed" property this concern actually
 * needs, with no new dependency and no ADR to write — the same "manually-
 * randomized-but-seeded test loop" the work package's own instructions name
 * as an acceptable, simpler substitute.
 *
 * ## What "independent" means here
 *
 * Ten operations, each targeting a DIFFERENT record: one `gardens.rename` on
 * the garden itself, and nine `plants.addPlant` creates, each a brand-new
 * plant id. None declares `dependsOnOperationIds`; none shares a target
 * record with another. Every trial reuses the identical ten fixed record ids
 * (generated once, outside the trial loop) against a FRESH garden, so each
 * trial's own final state is directly comparable to every other trial's —
 * only the SUBMISSION order and the BATCH GROUPING (how the ten operations
 * are split across a random number of `pushSyncOperations.execute` calls)
 * differ, per-trial, drawn from that trial's own seed.
 *
 * Twenty trials, seeds 1 through 20 — enough distinct random orderings/
 * groupings to make a real ordering-dependent bug likely to surface, while
 * keeping total runtime bounded (ten cheap creates/one rename per trial,
 * against one already-started container).
 */

import type { SyncOperation, SyncPushRequest } from '@verdery/api-contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { buildSyncTestHarness } from '../support/sync-test-harness.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'synchronization randomized convergence (independent objects)';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const TRIAL_SEEDS = Array.from({ length: 20 }, (_unused, index) => index + 1);

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

async function insertProfile(db: Kysely<DatabaseSchema>, id: string): Promise<void> {
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
}

/**
 * mulberry32 — a small, fast, fully deterministic 32-bit PRNG. Any fixed
 * seed always produces the identical sequence, which is the only property
 * this file needs (reproducibility from a logged seed on failure), not
 * cryptographic or statistical quality.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/** Splits `items` into a random number (1..items.length) of non-empty, order-preserving groups — this trial's own batching choice. */
function randomBatches<T>(items: readonly T[], random: () => number): T[][] {
  const batchCount = 1 + Math.floor(random() * items.length);
  const cutPoints = new Set<number>();
  while (cutPoints.size < batchCount - 1) {
    cutPoints.add(1 + Math.floor(random() * (items.length - 1)));
  }
  const sortedCuts = [...cutPoints].sort((a, b) => a - b);

  const batches: T[][] = [];
  let start = 0;
  for (const cut of [...sortedCuts, items.length]) {
    batches.push(items.slice(start, cut));
    start = cut;
  }
  return batches;
}

function pushRequest(operations: readonly SyncOperation[]): SyncPushRequest {
  return {
    clientInstallationId: generateUuidV7(),
    protocolVersion: 1,
    operationPayloadVersion: 1,
    operations: [...operations],
  };
}

interface ConvergedState {
  readonly gardenName: string;
  readonly gardenRevision: number;
  // Deliberately no `id`: each trial creates its own fresh garden and its
  // own fresh plant ids (a global `plants_inventory.plant.id` primary key
  // rules out reusing the same id across the 20 concurrently-running
  // trials' own gardens). `displayName` is this test's own stand-in for
  // "the same logical operation" across trials — deterministic from each
  // operation's fixed index, independent of the random id generated for it
  // — so sorting and comparing by `displayName` is what makes every trial's
  // resulting set directly comparable to every other's.
  readonly plants: readonly { readonly displayName: string; readonly revision: number }[];
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  /**
   * Builds this trial's own ten independent operations. Each plant create
   * gets a FRESH, trial-local id (`plants_inventory.plant.id` is a global
   * primary key, so the same id can never be reused across two different
   * gardens) — what stays fixed across every trial is each operation's own
   * logical index, which fully determines its `displayName`, so trials
   * remain comparable by content even though no id is shared between them.
   */
  function buildIndependentOperations(gardenId: string, plantCount: number): SyncOperation[] {
    const rename: SyncOperation = {
      operationId: generateUuidV7(),
      localSequence: 0,
      dependsOnOperationIds: [],
      mediaPrerequisites: [],
      payload: {
        recordType: 'garden',
        gardenId,
        command: {
          commandType: 'gardens.rename',
          expectedRevision: 1,
          request: { name: 'Converged Yard' },
        },
      },
    };
    const plantCreates: SyncOperation[] = Array.from({ length: plantCount }, (_unused, index) => ({
      operationId: generateUuidV7(),
      localSequence: index + 1,
      dependsOnOperationIds: [],
      mediaPrerequisites: [],
      payload: {
        recordType: 'plant',
        gardenId,
        command: {
          commandType: 'plants.addPlant',
          plantId: generateUuidV7(),
          request: { displayName: `Convergence plant ${index}`, groupingKind: 'individual' },
        },
      },
    }));
    return [rename, ...plantCreates];
  }

  async function runTrial(seed: number, plantCount: number): Promise<ConvergedState> {
    const now = new Date('2026-07-21T11:30:00Z');
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);
    const harness = buildSyncTestHarness(db, fixedClock(now));
    const garden = await harness.createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    const random = mulberry32(seed);
    const operations = shuffled(buildIndependentOperations(garden.id, plantCount), random);
    const batches = randomBatches(operations, random);

    for (const batch of batches) {
      const result = await harness.pushSyncOperations.execute(ownerId, pushRequest(batch));
      for (const entry of result.results) {
        // Every operation here is genuinely independent and well-formed —
        // any non-`accepted` outcome means either this test's own batching
        // logic is broken or a real convergence bug exists; either way the
        // trial itself must fail loudly, not silently produce a partial
        // state that then "coincidentally" still compares equal.
        expect(entry.outcome).toBe('accepted');
      }
    }

    const gardenRow = await harness.gardenRepository.findById(garden.id);
    if (gardenRow === null) {
      throw new Error('expected the garden to still exist after the trial');
    }
    const plantRows = await db
      .selectFrom('plants_inventory.plant')
      .select(['display_name', 'revision'])
      .where('garden_id', '=', garden.id)
      .execute();

    return {
      gardenName: gardenRow.name,
      gardenRevision: gardenRow.revision,
      plants: plantRows
        .map((row) => ({ displayName: row.display_name, revision: row.revision }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    };
  }

  it('converges to the identical final state across 20 random operation orderings and batch groupings', async () => {
    const PLANT_COUNT = 9;
    const states = await Promise.all(TRIAL_SEEDS.map((seed) => runTrial(seed, PLANT_COUNT)));

    const [reference, ...rest] = states;
    if (reference === undefined) {
      throw new Error('expected at least one trial');
    }

    expect(reference.gardenName).toBe('Converged Yard');
    expect(reference.gardenRevision).toBe(2);
    expect(reference.plants).toHaveLength(9);

    for (const [index, state] of rest.entries()) {
      // A per-trial, seed-labeled assertion: a failure here names exactly
      // which seed's ordering/batching diverged from the reference trial,
      // reproducible by rerunning that one seed alone.
      expect(
        state,
        `trial seed ${TRIAL_SEEDS[index + 1]} diverged from trial seed ${TRIAL_SEEDS[0]}`,
      ).toEqual(reference);
    }
  }, 120_000);
});
