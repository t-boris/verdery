import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * Direct-SQL seeding of recommendation candidates for the care-loop E2E.
 *
 * WHY DIRECT SQL: candidates are generated exclusively by the server-side
 * rule engine, whose evaluation sweep is triggered through
 * `/internal/recommendation-evaluation/sweep` — a machine-to-machine
 * endpoint that verifies a Google-signed Cloud Tasks OIDC identity token
 * (`GoogleOidcInvocationVerifier`), which no local test can mint. The
 * engine's natural triggers therefore cannot run inside this harness, and
 * seeding the rows the engine WOULD have written — states, evidence,
 * factors, and explanations shaped exactly like the launch rules' own
 * output, against rule versions the running build's catalog really ships —
 * is the deterministic alternative. Everything downstream of generation
 * (presentation marking, priority re-derivation, every feedback command,
 * task conversion) still runs through the real API against these rows.
 *
 * MECHANISM: `docker exec` into the harness's own throwaway Postgres
 * container and pipe SQL to `psql` over stdin, in one transaction — no new
 * database-client dependency for the web package. The connection constants
 * mirror `run-e2e.sh` (which owns them) the same way `auth-emulator.ts`
 * mirrors that script's emulator constants.
 */

/** Must match `run-e2e.sh`'s `DB_CONTAINER_NAME` / `DB_USER` / `DB_NAME`. */
const DB_CONTAINER_NAME = 'verdery-e2e-postgres';
const DB_USER = 'verdery';
const DB_NAME = 'verdery_e2e';

/**
 * UUIDv7, not `randomUUID()`'s v4: every id in this codebase is UUIDv7, and
 * the API's route validation (`UUID_PATTERN` in `garden-routes.ts`) pins
 * the version nibble — a seeded v4 candidate id would 400 on every command.
 */
function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((ms >> BigInt(8 * (5 - index))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Runs SQL in the harness Postgres, in a single transaction, and returns stdout. */
export function runSql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      [
        'exec',
        '-i',
        DB_CONTAINER_NAME,
        'psql',
        '-U',
        DB_USER,
        '-d',
        DB_NAME,
        '-v',
        'ON_ERROR_STOP=1',
        '--no-psqlrc',
        '--single-transaction',
        '-qAt',
      ],
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`psql failed: ${stderr || error.message}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
    child.stdin?.end(sql);
  });
}

/** The one plant this spec creates through the UI, read back by garden. */
export async function fetchPlantId(gardenId: string): Promise<string> {
  const plantId = await runSql(
    `SELECT id FROM plants_inventory.plant WHERE garden_id = '${gardenId}';`,
  );
  if (plantId === '') {
    throw new Error(`No plant found for garden ${gardenId}.`);
  }
  return plantId;
}

interface EvidenceSeed {
  readonly kind: string;
  readonly sourcePlantId?: string;
  readonly sourceWeatherRecordId?: string;
  readonly factKey: string;
  readonly factValue: Readonly<Record<string, unknown>> | null;
}

interface FactorSeed {
  readonly kind: string;
  readonly contribution: number;
  readonly basis: Readonly<Record<string, unknown>>;
}

type TargetSeed =
  { readonly kind: 'garden' } | { readonly kind: 'plant'; readonly plantId: string };

interface CandidateSeed {
  readonly ruleKey: string;
  readonly ruleVersion: number;
  readonly safetyTier: 'ordinary_care' | 'elevated_risk';
  readonly careCategory: string;
  readonly urgency: 'low' | 'normal' | 'high' | 'urgent';
  readonly target: TargetSeed;
  readonly windowEndInterval: string;
  readonly explanation: string;
  readonly evidence: readonly EvidenceSeed[];
  readonly factors: readonly FactorSeed[];
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlJson(value: Readonly<Record<string, unknown>>): string {
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

function candidateStatements(gardenId: string, seed: CandidateSeed): string {
  const candidateId = uuidv7();
  const evidenceIds = seed.evidence.map(() => uuidv7());
  const targetPlantId = seed.target.kind === 'plant' ? sqlLiteral(seed.target.plantId) : 'NULL';
  // Resolved by key rather than a pre-generated id so re-seeding within one
  // harness run (a CI retry) reuses the existing immutable identity row.
  const ruleVersionId = `(SELECT id FROM tasks_recommendations.rule_version
     WHERE rule_key = ${sqlLiteral(seed.ruleKey)} AND version = ${String(seed.ruleVersion)})`;

  const candidateInsert = `
INSERT INTO tasks_recommendations.recommendation_candidate
  (id, garden_id, target_kind, target_garden_area_id, target_plant_id, care_category,
   rule_version_id, safety_tier, state, urgency, window_start, window_end,
   primary_evidence_id, explanation)
VALUES
  (${sqlLiteral(candidateId)}, ${sqlLiteral(gardenId)}, ${sqlLiteral(seed.target.kind)}, NULL,
   ${targetPlantId}, ${sqlLiteral(seed.careCategory)}, ${ruleVersionId},
   ${sqlLiteral(seed.safetyTier)}, 'eligible', ${sqlLiteral(seed.urgency)},
   now() - interval '1 hour', now() + interval ${sqlLiteral(seed.windowEndInterval)},
   ${sqlLiteral(evidenceIds[0]!)}, ${sqlLiteral(seed.explanation)});`;

  const evidenceInserts = seed.evidence.map((evidence, index) => {
    const factValue = evidence.factValue === null ? 'NULL' : sqlJson(evidence.factValue);
    return `
INSERT INTO tasks_recommendations.recommendation_evidence
  (id, candidate_id, evidence_kind, source_observation_id, source_task_id, source_plant_id,
   source_weather_record_id, fact_key, fact_value)
VALUES
  (${sqlLiteral(evidenceIds[index]!)}, ${sqlLiteral(candidateId)}, ${sqlLiteral(evidence.kind)},
   NULL, NULL, ${evidence.sourcePlantId === undefined ? 'NULL' : sqlLiteral(evidence.sourcePlantId)},
   ${evidence.sourceWeatherRecordId === undefined ? 'NULL' : sqlLiteral(evidence.sourceWeatherRecordId)},
   ${sqlLiteral(evidence.factKey)}, ${factValue});`;
  });

  const factorInserts = seed.factors.map(
    (factor) => `
INSERT INTO tasks_recommendations.recommendation_priority_factor
  (id, candidate_id, factor_kind, factor_value)
VALUES
  (${sqlLiteral(uuidv7())}, ${sqlLiteral(candidateId)}, ${sqlLiteral(factor.kind)},
   ${sqlJson({ contribution: factor.contribution, basis: factor.basis })});`,
  );

  return [candidateInsert, ...evidenceInserts, ...factorInserts].join('\n');
}

/**
 * One `integrations.weather_record` row for the weather-referencing
 * evidence to point at — `recommendation_evidence.source_weather_record_id`
 * gained a real FK with P7-INT-01. A stale forecast (fetched 26 hours ago),
 * satisfying every CHECK: forecast kind, SI units, one source-unit label
 * per present measurement.
 */
function weatherRecordInsert(id: string, gardenId: string): string {
  return `
INSERT INTO integrations.weather_record
  (id, garden_id, provider_key, record_kind, effective_at, fetched_at, latitude, longitude,
   temperature_celsius, precipitation_mm, source_units, license_note, attribution_text)
VALUES
  (${sqlLiteral(id)}, ${sqlLiteral(gardenId)}, 'e2e-fixture', 'forecast',
   now() + interval '6 hours', now() - interval '26 hours', 52.1, 21.0,
   -2, 0, '{"temperature": "celsius", "precipitation": "mm"}'::jsonb,
   'E2E fixture data', 'E2E fixture');`;
}

/**
 * Seeds four `eligible` candidates — one per launch rule, shaped like each
 * rule's own output (evidence kinds, factor bases, explanation style), with
 * factor contributions chosen so the server's re-derived priority order is
 * deterministic: frost watch (75) > harvest check (65) > observation
 * reminder (40) > watering check (25).
 */
export async function seedCareLoopCandidates(gardenId: string, plantId: string): Promise<void> {
  const weatherRecordId = uuidv7();

  const candidates: readonly CandidateSeed[] = [
    {
      ruleKey: 'watering.dry-spell-check',
      ruleVersion: 1,
      safetyTier: 'ordinary_care',
      careCategory: 'watering',
      urgency: 'normal',
      target: { kind: 'plant', plantId },
      windowEndInterval: '3 days',
      explanation: 'No rain or watering has been recorded for 9 days. Check the soil moisture.',
      evidence: [
        {
          kind: 'plant_identity',
          sourcePlantId: plantId,
          factKey: 'plant.watering_recency',
          factValue: { daysSinceRain: 9 },
        },
        {
          kind: 'weather',
          sourceWeatherRecordId: weatherRecordId,
          factKey: 'weather.recent_precipitation',
          factValue: { freshness: 'stale', precipitationMm: 0 },
        },
      ],
      factors: [
        {
          kind: 'urgency_window',
          contribution: 15,
          basis: { urgency: 'normal', validityWindowDays: 3 },
        },
        { kind: 'confidence', contribution: 10, basis: { weatherFreshness: 'stale' } },
      ],
    },
    {
      ruleKey: 'observation.routine-check-reminder',
      ruleVersion: 1,
      safetyTier: 'ordinary_care',
      careCategory: 'observation',
      urgency: 'low',
      target: { kind: 'plant', plantId },
      windowEndInterval: '7 days',
      explanation: 'This plant has not been observed for 16 days. Record a quick check.',
      evidence: [
        {
          kind: 'plant_identity',
          sourcePlantId: plantId,
          factKey: 'plant.observation_recency',
          factValue: { lastObservedAt: null, baseline: 'plant_created_at', daysSince: 16 },
        },
      ],
      factors: [
        { kind: 'urgency_window', contribution: 10, basis: { urgency: 'low' } },
        { kind: 'plant_impact', contribution: 10, basis: { lifecycleStage: 'seed' } },
        { kind: 'confidence', contribution: 20, basis: { source: 'own_records', daysSince: 16 } },
      ],
    },
    {
      ruleKey: 'lifecycle.harvest-readiness-check',
      ruleVersion: 1,
      safetyTier: 'ordinary_care',
      careCategory: 'harvest',
      urgency: 'high',
      target: { kind: 'plant', plantId },
      windowEndInterval: '5 days',
      explanation: 'This plant is in its fruiting stage. Check ripeness before quality declines.',
      evidence: [
        {
          kind: 'lifecycle_stage',
          sourcePlantId: plantId,
          factKey: 'plant.lifecycle_stage',
          factValue: { stage: 'fruiting' },
        },
      ],
      factors: [
        { kind: 'urgency_window', contribution: 25, basis: { urgency: 'high' } },
        { kind: 'plant_impact', contribution: 20, basis: { lifecycleStage: 'fruiting' } },
        {
          kind: 'confidence',
          contribution: 20,
          basis: { source: 'user_declared_lifecycle_stage' },
        },
      ],
    },
    {
      ruleKey: 'weather.frost-watch',
      ruleVersion: 1,
      safetyTier: 'elevated_risk',
      careCategory: 'weather_protection',
      urgency: 'urgent',
      target: { kind: 'garden' },
      windowEndInterval: '1 day',
      explanation: 'The forecast expects a low of -2 C tonight. Consider protective cover.',
      evidence: [
        {
          kind: 'weather',
          sourceWeatherRecordId: weatherRecordId,
          factKey: 'weather.forecast_low',
          factValue: { forecastLowCelsius: -2, freshness: 'fresh' },
        },
        {
          kind: 'garden_context',
          factKey: 'garden.season',
          factValue: { season: 'growing' },
        },
      ],
      factors: [
        { kind: 'urgency_window', contribution: 40, basis: { urgency: 'urgent' } },
        {
          kind: 'weather_opportunity_or_risk',
          contribution: 25,
          basis: { risk: 'frost', forecastLowCelsius: -2 },
        },
        {
          kind: 'confidence',
          contribution: 10,
          basis: { safetyTier: 'elevated_risk', source: 'forecast' },
        },
      ],
    },
  ];

  const ruleVersionRows = candidates
    .map(
      (candidate) =>
        `(${sqlLiteral(uuidv7())}, ${sqlLiteral(candidate.ruleKey)}, ${String(candidate.ruleVersion)}, ${sqlLiteral(candidate.safetyTier)})`,
    )
    .join(',\n');

  const sql = [
    `INSERT INTO tasks_recommendations.rule_version (id, rule_key, version, safety_tier) VALUES
${ruleVersionRows}
ON CONFLICT (rule_key, version) DO NOTHING;`,
    weatherRecordInsert(weatherRecordId, gardenId),
    ...candidates.map((candidate) => candidateStatements(gardenId, candidate)),
  ].join('\n');

  await runSql(sql);
}
