/**
 * Cross-field configuration rules a flat zod object cannot express as
 * per-field schemas — split out of `configuration-schema.ts` for the same
 * 600-line reason every sibling split file gives (see `AGENTS.md`).
 *
 * Every function here reads the RAW, unparsed source rather than a
 * zod-validated result. A `superRefine` on the schema would only run once
 * every other field already parsed without issues, which would silently
 * hide a missing required variable whenever an unrelated variable was also
 * invalid — the opposite of `load-configuration.ts`'s stated goal of naming
 * every offending variable together. Reading raw presence has no such
 * dependency.
 */

export interface ConfigurationIssue {
  readonly variable: string;
  readonly message: string;
}

/** Finds "required in this connection mode" problems. */
export function findDatabaseModeIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  const mode = source['DATABASE_CONNECTION_MODE'] === 'cloudSqlIam' ? 'cloudSqlIam' : 'url';

  const requiredFields =
    mode === 'url'
      ? (['DATABASE_URL'] as const)
      : (['DATABASE_INSTANCE_CONNECTION_NAME', 'DATABASE_IAM_USER', 'DATABASE_NAME'] as const);

  return requiredFields
    .filter((field) => source[field] === undefined)
    .map((field) => ({
      variable: field,
      message: `Required when DATABASE_CONNECTION_MODE is "${mode}"`,
    }));
}

/**
 * Cross-field rule for the AI-explanation switch, the
 * `findDatabaseModeIssues` shape (and its same raw-source reasoning):
 * enabling the capability requires the Vertex project and an explicitly
 * chosen model — neither has a value code may invent.
 */
export function findAiExplanationIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  if (source['RECOMMENDATION_AI_EXPLANATION_ENABLED'] !== 'true') {
    return [];
  }

  return (['RECOMMENDATION_AI_VERTEX_PROJECT_ID', 'RECOMMENDATION_AI_MODEL'] as const)
    .filter((field) => source[field] === undefined)
    .map((field) => ({
      variable: field,
      message: 'Required when RECOMMENDATION_AI_EXPLANATION_ENABLED is "true"',
    }));
}

/**
 * Cross-field rule for the plant-species-identification switch (ADR-0015),
 * the `findAiExplanationIssues` shape exactly: enabling the capability
 * requires an explicitly chosen model, plus the shared Vertex project id —
 * `RECOMMENDATION_AI_VERTEX_PROJECT_ID` is reused across all three AI
 * capabilities (one GCP project, ADR-0008), so this switch requires it
 * directly rather than assuming `RECOMMENDATION_AI_EXPLANATION_ENABLED` is
 * also on — the two switches are independent.
 */
export function findPlantSpeciesAiIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  if (source['PLANT_SPECIES_AI_ENABLED'] !== 'true') {
    return [];
  }

  return (['RECOMMENDATION_AI_VERTEX_PROJECT_ID', 'PLANT_SPECIES_AI_MODEL'] as const)
    .filter((field) => source[field] === undefined)
    .map((field) => ({
      variable: field,
      message: 'Required when PLANT_SPECIES_AI_ENABLED is "true"',
    }));
}

/**
 * Cross-field rule for the plant-condition-analysis switch (ADR-0015), the
 * `findPlantSpeciesAiIssues` shape exactly (including the same shared-
 * project reasoning).
 */
export function findPlantConditionAiIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  if (source['PLANT_CONDITION_AI_ENABLED'] !== 'true') {
    return [];
  }

  return (['RECOMMENDATION_AI_VERTEX_PROJECT_ID', 'PLANT_CONDITION_AI_MODEL'] as const)
    .filter((field) => source[field] === undefined)
    .map((field) => ({
      variable: field,
      message: 'Required when PLANT_CONDITION_AI_ENABLED is "true"',
    }));
}

/**
 * Cross-field rule for the Open-Meteo tier, the `findDatabaseModeIssues`
 * shape (and its same raw-source reasoning): the paid host authenticates by
 * `apikey` and rejects every keyless request, so selecting it without a key
 * is a deployment mistake to name at startup, not at the first sweep.
 */
export function findWeatherProviderIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  if (source['WEATHER_OPEN_METEO_TIER'] !== 'customer') {
    return [];
  }
  if (source['WEATHER_OPEN_METEO_API_KEY'] !== undefined) {
    return [];
  }
  return [
    {
      variable: 'WEATHER_OPEN_METEO_API_KEY',
      message: 'Required when WEATHER_OPEN_METEO_TIER is "customer"',
    },
  ];
}

/** Cross-field rule for transactional email (P9C-INVITE-01), the `findWeatherProviderIssues` shape: a configured key with no sender/link base is a deployment mistake to name at startup. */
export function findTransactionalEmailIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  if (source['RESEND_API_KEY'] === undefined) {
    return [];
  }

  return (['RESEND_FROM_EMAIL', 'CLIENT_PORTAL_BASE_URL'] as const)
    .filter((field) => source[field] === undefined)
    .map((field) => ({
      variable: field,
      message: 'Required when RESEND_API_KEY is set',
    }));
}
