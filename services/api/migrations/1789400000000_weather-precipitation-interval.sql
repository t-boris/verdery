-- Records what a stored precipitation figure is a sum OVER, so accumulated
-- rainfall can be computed without double counting.
--
-- WHY THIS COLUMN HAS TO EXIST. `weather_record.precipitation_mm` has always
-- been provider-defined in its accumulation interval — the domain's own
-- header says so explicitly ("Precipitation's accumulation interval is
-- provider-defined and deliberately NOT normalized here — no document
-- defines a canonical interval, and inventing one would misstate provider
-- data; a real vendor adapter documents its interval when it exists"). That
-- was the correct posture while no vendor was selected.
--
-- A vendor IS selected now, and it stores two genuinely different kinds of
-- precipitation figure under the SAME `record_kind = 'observation'`:
--
--   * the `current` block's `precipitation`, which Open-Meteo documents as
--     the preceding HOUR, and
--   * each `daily` block row's `precipitation_sum`, which is the whole DAY.
--
-- Summing those together to answer "how much rain has this garden had this
-- week" double counts the current hour inside the current day. Telling them
-- apart by which other measurements happen to be null would be a guess
-- about response shape; the interval is a fact the provider documents, so
-- it is stored as one.
--
-- NULLABLE, and null for every row written before this migration. Null means
-- "this row's accumulation interval was never recorded" — it is NOT a
-- licence to assume an hour or a day. The accumulation reader selects only
-- rows with a known interval, so historical rows are excluded from sums
-- rather than silently mis-added. This is the same "missing facts remain
-- missing" rule the rest of the weather model already follows.
--
-- The CHECK pins the correlation the domain also validates: an interval may
-- be recorded only where a precipitation figure exists to describe.
--
-- Source: architecture/external-integrations.md, section "5. Weather";
--         integrations/domain/weather-record.ts.

-- Up Migration

SET ROLE verdery_migration;

ALTER TABLE integrations.weather_record
  ADD COLUMN precipitation_interval_seconds integer;

ALTER TABLE integrations.weather_record
  ADD CONSTRAINT weather_record_precipitation_interval_check CHECK (
    precipitation_interval_seconds IS NULL
    OR (precipitation_interval_seconds > 0 AND precipitation_mm IS NOT NULL)
  );

-- The accumulation read is "this garden's observation rows of one interval
-- class, at or after a cutoff, newest first". Without this index it is a
-- scan of every row the garden ever stored, and the evaluation sweep runs it
-- once per garden per pass.
CREATE INDEX weather_record_precipitation_accumulation_idx
  ON integrations.weather_record (
    garden_id,
    record_kind,
    precipitation_interval_seconds,
    effective_at DESC
  )
  WHERE precipitation_mm IS NOT NULL;

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP INDEX IF EXISTS integrations.weather_record_precipitation_accumulation_idx;

ALTER TABLE integrations.weather_record
  DROP CONSTRAINT IF EXISTS weather_record_precipitation_interval_check;

ALTER TABLE integrations.weather_record
  DROP COLUMN IF EXISTS precipitation_interval_seconds;

RESET ROLE;
