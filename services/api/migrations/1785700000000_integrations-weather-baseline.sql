-- Integrations weather baseline: the `integrations` module's first tables —
-- normalized weather records and per-provider quota accounting — plus the
-- module schema itself and the foreign key
-- 1785600000000_recommendations-baseline.sql explicitly deferred on
-- `recommendation_evidence.source_weather_record_id` ("the real FK arrives
-- with P7-INT-01's own migration").
--
-- This is P7-INT-01: provider-AGNOSTIC machinery only. No real weather
-- vendor exists anywhere in this repository — provider selection is
-- P0-PROV-01, an undecided implementation-time selection
-- (technical-specification.md, section "14.2 Implementation-Time
-- Selections": "Initial commercial map, imagery, geocoding, weather,
-- plant-content, and transactional-email providers"). Nothing below names,
-- assumes, or fabricates a vendor: `provider_key` is the application-owned
-- registry key of whichever adapter produced a row, and with zero providers
-- configured (today's reality) no row is ever produced — the application
-- surfaces a typed no-provider outcome instead
-- (`modules/integrations/application/refresh-garden-weather.ts`).
--
-- Schema creation: the platform baseline
-- (1784710800000_platform-baseline.sql) created one schema per module that
-- existed then; `integrations` — backend-modular-monolith.md's own module
-- 6.9 ("Owns provider adapters, normalized external observations, quota
-- policy, licensing metadata, and provider-health reporting") — is first
-- materialized here, with the identical ownership/privilege posture that
-- baseline's loop applies: owned by `verdery_migration`, USAGE plus
-- default-privilege row access for `verdery_application`, nothing for
-- PUBLIC. `verdery_worker` deliberately gets NOTHING: no worker touches
-- weather — P7-ASYNC-01's scheduled refresh calls the API's own use case,
-- and that stage names exactly what its relay needs when it exists,
-- matching 1785200000000_media-processing-jobs.sql's posture.
--
-- Backfill posture: both tables are new, so no existing row is rewritten.
-- The single ALTER against an existing table adds one FK whose validation
-- scan is trivially empty in every real deployment: P7-DATA-01 shipped the
-- recommendation data model as domain logic only — no repository, command,
-- or route anywhere in this codebase writes `recommendation_evidence` rows
-- yet (its own migration's "No repository, no app.ts change" posture), so
-- no `source_weather_record_id` value exists to violate the new FK, and the
-- scan would fail loudly, not silently, if any environment disproved this.
--
-- Source: implementation-plan.md work package P7-INT-01;
--         architecture/external-integrations.md, sections "3. Adapter
--         Contract", "4. Provider Registry", "5. Weather", "11. Reliability",
--         "14. Cost and Quota";
--         architecture/backend-modular-monolith.md, section
--         "6.9 Integrations".

-- Up Migration

-- Schema creation and privilege wiring run as the CONNECTED migration
-- identity, not under SET ROLE: `verdery_migration` owns schemas by
-- AUTHORIZATION but was never granted CREATE on the database itself — the
-- platform baseline's own schema loop runs the same way, and the connected
-- identity holds `verdery_migration` membership (granted there), which the
-- ALTER DEFAULT PRIVILEGES FOR ROLE statements require.
CREATE SCHEMA IF NOT EXISTS integrations AUTHORIZATION verdery_migration;

REVOKE ALL ON SCHEMA integrations FROM PUBLIC;
GRANT USAGE ON SCHEMA integrations TO verdery_application;

ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA integrations
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verdery_application;
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA integrations
  GRANT USAGE, SELECT ON SEQUENCES TO verdery_application;

SET ROLE verdery_migration;

-- Normalized weather records — external-integrations.md section 5's own
-- field list, one column set per bullet:
--
--   "Location or grid reference"            -> garden_id + latitude/longitude
--   "Observation/forecast effective time"   -> record_kind + effective_at
--   "Retrieval time"                        -> fetched_at
--   "Provider"                              -> provider_key
--   "Temperature, precipitation, wind,
--    humidity, and approved derived values" -> the four measurement columns
--   "Units and conversion provenance"       -> unit_system + source_units
--   "Confidence or provider quality"        -> provider_confidence,
--                                              provider_quality_label
--   "License and redistribution constraints"-> license_note, attribution_text
--
-- Anchoring: weather is per GARDEN, because a garden's geographic location
-- is the only location this system has — the current
-- `gardens_mapping.georeference` row's WGS84 anchor
-- (data-and-geospatial-design.md section 9). `latitude`/`longitude`
-- snapshot the exact coordinates the fetch used, so a later georeference
-- change cannot silently re-attribute historical weather to a place it was
-- never fetched for. A garden with no georeference has no location and gets
-- no weather — a typed, user-visible degradation, never a guessed
-- coordinate.
--
-- Units: normalized internally to ONE documented system (`unit_system`,
-- CHECK-pinned to 'si'): temperature in degrees Celsius, precipitation
-- depth in millimetres, wind speed in metres per second, relative humidity
-- in percent. `source_units` is the conversion provenance the same bullet
-- requires: the provider's own unit label for every stored measurement,
-- recorded even when the provider already reported SI (provenance is about
-- what the provider said, not only about conversions performed). The
-- source-units consistency CHECK makes that pairing physical: a measurement
-- without its recorded source unit — or a recorded unit for a measurement
-- that is not there — cannot be inserted.
--
-- Measurements are individually nullable ("Missing facts remain missing" —
-- recommendations-and-ai.md section 4 — applies to provider data too), but
-- at least one must be present: a row with no reading at all records
-- nothing and is not a weather record. "Approved derived values" get no
-- columns: no approval process or approver exists yet, so there is nothing
-- honest to model — a future stage adds columns when values are actually
-- approved.
--
-- Append-only and immutable: a fetch result is a historical fact. No UPDATE
-- path exists (the same posture `observations_history.observation`
-- documents), and freshness is deliberately NOT a column — it decays with
-- wall-clock time, so a stored classification would rot; it is derived at
-- read time by `domain/weather-freshness.ts` from `fetched_at` against a
-- configured policy.
CREATE TABLE integrations.weather_record (
  id uuid PRIMARY KEY,
  garden_id uuid NOT NULL REFERENCES gardens_mapping.garden (id),
  provider_key text NOT NULL,
  record_kind text NOT NULL,
  effective_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  temperature_celsius double precision,
  precipitation_mm double precision,
  wind_speed_mps double precision,
  humidity_percent double precision,
  unit_system text NOT NULL DEFAULT 'si',
  source_units jsonb NOT NULL,
  provider_confidence double precision,
  provider_quality_label text,
  license_note text NOT NULL,
  attribution_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weather_record_provider_key_check CHECK (provider_key <> ''),
  CONSTRAINT weather_record_kind_check CHECK (record_kind IN ('observation', 'forecast')),
  -- One cannot observe the future: an observation's effective time is at or
  -- before its retrieval. No mirror-image forecast check: a forecast row
  -- whose effective moment has just passed in transit is still a forecast.
  CONSTRAINT weather_record_observation_not_future_check CHECK (
    record_kind <> 'observation' OR effective_at <= fetched_at
  ),
  CONSTRAINT weather_record_latitude_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT weather_record_longitude_check CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT weather_record_unit_system_check CHECK (unit_system = 'si'),
  CONSTRAINT weather_record_precipitation_check CHECK (
    precipitation_mm IS NULL OR precipitation_mm >= 0
  ),
  CONSTRAINT weather_record_wind_speed_check CHECK (
    wind_speed_mps IS NULL OR wind_speed_mps >= 0
  ),
  CONSTRAINT weather_record_humidity_check CHECK (
    humidity_percent IS NULL OR humidity_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT weather_record_measurement_present_check CHECK (
    temperature_celsius IS NOT NULL OR precipitation_mm IS NOT NULL
    OR wind_speed_mps IS NOT NULL OR humidity_percent IS NOT NULL
  ),
  -- Conversion provenance, physically: `source_units` is an object carrying
  -- exactly one non-blank provider unit label per PRESENT measurement and
  -- null (or absence) for each missing one.
  CONSTRAINT weather_record_source_units_consistency_check CHECK (
    jsonb_typeof(source_units) = 'object'
    AND ((temperature_celsius IS NULL) = (source_units ->> 'temperature' IS NULL))
    AND ((precipitation_mm IS NULL) = (source_units ->> 'precipitation' IS NULL))
    AND ((wind_speed_mps IS NULL) = (source_units ->> 'windSpeed' IS NULL))
    AND ((humidity_percent IS NULL) = (source_units ->> 'humidity' IS NULL))
    AND (source_units ->> 'temperature' IS DISTINCT FROM '')
    AND (source_units ->> 'precipitation' IS DISTINCT FROM '')
    AND (source_units ->> 'windSpeed' IS DISTINCT FROM '')
    AND (source_units ->> 'humidity' IS DISTINCT FROM '')
  ),
  CONSTRAINT weather_record_confidence_check CHECK (
    provider_confidence IS NULL OR provider_confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT weather_record_quality_label_check CHECK (
    provider_quality_label IS NULL OR provider_quality_label <> ''
  ),
  CONSTRAINT weather_record_license_note_check CHECK (license_note <> ''),
  CONSTRAINT weather_record_attribution_check CHECK (
    attribution_text IS NULL OR attribution_text <> ''
  )
);

-- Serves this stage's own two reads: the cache decision ("the latest
-- observation's fetch time against the freshness window") and the
-- rule-engine query ("the latest record of a kind for this garden") —
-- both are `(garden_id, record_kind, fetched_at DESC) LIMIT 1`. P7-RULE-01
-- adds effective-time indexes if its forecast-window queries need them; not
-- guessed here.
CREATE INDEX weather_record_garden_kind_fetched_idx
  ON integrations.weather_record (garden_id, record_kind, fetched_at DESC);

-- Per-provider call accounting — external-integrations.md section 14's
-- "Application-level quotas protect expensive integrations from abuse or
-- accidental loops", as one counter row per provider per bounded window.
-- Windows are UTC-truncated hours and days: quota budgets are
-- provider-billing concepts, not garden-local ones, so a garden's time zone
-- has no business here. The LIMITS are deliberately not stored: numeric
-- budgets are an undecided implementation-time selection
-- (technical-specification.md section 14.2, "Quotas"), so they live in
-- per-provider registry configuration
-- (`application/weather-provider-registry.ts`) and are enforced at consume
-- time — this table is the durable usage count that enforcement and
-- section 14's "quota state" telemetry both read.
--
-- Old windows are simply left behind (a bounded, tiny table: at most
-- 25 rows per provider per day); a cleanup sweep is a future operational
-- concern, not invented here.
CREATE TABLE integrations.provider_quota_usage (
  provider_key text NOT NULL,
  window_kind text NOT NULL,
  window_start timestamptz NOT NULL,
  call_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_quota_usage_pkey PRIMARY KEY (provider_key, window_kind, window_start),
  CONSTRAINT provider_quota_usage_provider_key_check CHECK (provider_key <> ''),
  CONSTRAINT provider_quota_usage_window_kind_check CHECK (window_kind IN ('hour', 'day')),
  CONSTRAINT provider_quota_usage_call_count_check CHECK (call_count >= 0)
);

-- Closes the deferral 1785600000000_recommendations-baseline.sql documented
-- on this exact column: "`source_weather_record_id` is a bare, FK-less
-- uuid: normalized weather records ... do not exist as a table anywhere in
-- this codebase yet — P7-INT-01 owns them. ... the real FK arrives with
-- P7-INT-01's own migration." The table now exists; weather evidence can no
-- longer point at nothing. See the header comment for why the validation
-- scan is trivially safe (no code path writes evidence rows yet).
ALTER TABLE tasks_recommendations.recommendation_evidence
  ADD CONSTRAINT recommendation_evidence_source_weather_record_fkey
  FOREIGN KEY (source_weather_record_id) REFERENCES integrations.weather_record (id);

-- Serves "which candidates does this weather record justify" reverse
-- lookups — the same reference-tracking judgment the sibling
-- `recommendation_evidence_source_*_idx` indexes already made for their own
-- newly-FK'd columns.
CREATE INDEX recommendation_evidence_source_weather_record_id_idx
  ON tasks_recommendations.recommendation_evidence (source_weather_record_id)
  WHERE source_weather_record_id IS NOT NULL;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS tasks_recommendations.recommendation_evidence_source_weather_record_id_idx;

ALTER TABLE tasks_recommendations.recommendation_evidence
  DROP CONSTRAINT IF EXISTS recommendation_evidence_source_weather_record_fkey;

DROP TABLE IF EXISTS integrations.provider_quota_usage CASCADE;
DROP TABLE IF EXISTS integrations.weather_record CASCADE;

RESET ROLE;

-- Mirror of the platform baseline's own down-loop posture for a module
-- schema, run as the connected identity like the up direction's schema
-- creation: revoke the default privileges this migration granted, then
-- drop the schema itself.
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA integrations
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM verdery_application;
ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA integrations
  REVOKE USAGE, SELECT ON SEQUENCES FROM verdery_application;

DROP SCHEMA IF EXISTS integrations CASCADE;
