-- User-authored observation symptoms (P11-MEDIA-01, the piece
-- `1787900000000_visual-journal-observation-extensions.sql`'s own header
-- deferred: "structured symptoms ... needs its own design pass to keep
-- user-authored and AI-suggested symptom data from being confused").
--
-- THAT IS THE DESIGN PASS, AND ITS ANSWER IS SEPARATION. A symptom recorded
-- here is what a person saw and said. An `image_analysis_result` row is what a
-- model proposed and what a reviewer did with it. They are never the same
-- statement, they carry different weight in a health review, and one must
-- never be read as the other — so they live in different tables, with no
-- foreign key between them and no shared vocabulary. A single table with an
-- `authored_by` discriminator was the alternative and is rejected: every read
-- would have to remember to filter, and the first one that forgot would show a
-- model's guess as an observer's testimony.
--
-- `symptom_kind` is a closed vocabulary, for the same reason
-- `observation_measurement.kind` is: the value arrives in a client request
-- body, and an open column would let a client record a symptom nothing can
-- query or aggregate. The set below is deliberately small and describes what
-- is VISIBLE, not what caused it — `leaf_spots` is an observation, `blight` is
-- a diagnosis, and a gardener reporting the second is guessing. Widening the
-- set later is a pure additive CHECK change.
--
-- `severity` is likewise closed and is deliberately three values. A numeric
-- scale would invite precision nobody has: the difference between a 3 and a 4
-- out of ten is not something two people would report the same way about the
-- same leaf.
--
-- UNIQUE (observation_id, symptom_kind): one statement per symptom per
-- observation. Seeing the same symptom worse a week later is a new
-- observation, which is the same rule `observation_measurement` follows and
-- the same rule the observation table itself follows for corrections.
--
-- Source: implementation-plan.md work package P11-MEDIA-01;
-- architecture/plant-intelligence-and-visual-journal.md, section 8.1
-- ("Condition rating and structured symptoms").

-- Up Migration

SET ROLE verdery_migration;

CREATE TABLE observations_history.observation_symptom (
  id uuid PRIMARY KEY,
  observation_id uuid NOT NULL REFERENCES observations_history.observation (id),
  symptom_kind text NOT NULL,
  severity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT observation_symptom_kind_check CHECK (
    symptom_kind IN (
      'leaf_spots',
      'leaf_yellowing',
      'leaf_curling',
      'wilting',
      'holes_or_chewing',
      'mould_or_mildew',
      'dieback',
      'stunted_growth',
      'unusual_growth'
    )
  ),
  CONSTRAINT observation_symptom_severity_check CHECK (
    severity IN ('mild', 'moderate', 'severe')
  ),
  CONSTRAINT observation_symptom_unique_kind UNIQUE (observation_id, symptom_kind)
);

CREATE INDEX observation_symptom_observation_id_idx
  ON observations_history.observation_symptom (observation_id);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

DROP TABLE IF EXISTS observations_history.observation_symptom CASCADE;

RESET ROLE;
