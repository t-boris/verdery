-- Seeds a starting catalogue of common vegetable taxa and their northern-
-- hemisphere seasonal timing, so the three seasonal rules have something to
-- read once a reviewer signs it off.
--
-- WHY THIS EXISTS. `plants_inventory.taxonomy_seasonal_fact` has had a
-- schema, a repository and three consuming rules since P9D-SEASON-01, and
-- not one row. No seed, no authoring command and no import path existed, so
-- `seasonal.sowing-window-check`, `succession.replanting-reminder` and
-- `rotation.crop-rotation-caution` were structurally incapable of firing in
-- any environment. This closes the data half of that gap; the review half
-- is closed by `ListTaxonomySeasonalFactsAwaitingReview` /
-- `ApproveTaxonomySeasonalFactReview`.
--
-- PROVENANCE, AND WHY IT IS THE EXTRACTION LANE. Every row is
-- `authoring_method = 'ai_extracted_from_source'` with a real
-- `source_citation`, which ADR-0013 permits explicitly: "A model may parse a
-- text we are licensed to use — a Wikipedia article under CC BY-SA, a USDA
-- document in the public domain — and emit the structured fields the rule
-- engine consumes: sunlight, water, hardiness range, mature size, growth
-- habit, bloom and harvest timing." The cited sources are United States
-- federal and land-grant extension publications, which are public domain or
-- freely reusable. In this mode the model is a parser, not an author, and
-- the record's source stays the underlying text.
--
-- EVERY ROW SHIPS `awaiting_horticultural_review`, DELIBERATELY. That is not
-- a placeholder to be tidied up later — it is the control. ADR-0013 and
-- docs/development/recommendation-safety-catalog.md both require a NAMED
-- human reviewer, and `findReviewedForTaxonomyAndHemisphere` treats an
-- unreviewed row as absent, so these rows change no recommendation until a
-- reviewer signs them off through the review surface. Seeding them as
-- reviewed would forge a sign-off nobody performed and defeat the only
-- control standing between a plausible-looking window and somebody's garden.
--
-- A field the source does not support is left NULL. ADR-0013 again: "A field
-- the source text does not support must be left empty; the model may not
-- supply a value the text does not contain." Several crops here therefore
-- carry no transplant window, no succession interval, or no rotation rest.
--
-- NORTHERN HEMISPHERE ONLY. Hemisphere is part of the natural key because
-- sowing months genuinely differ, and the cited sources are United States
-- publications describing northern timing. Mirroring the months six across
-- would be inventing southern content from a source that does not contain
-- it — the same prohibition as above, applied to a whole hemisphere.
--
-- TAXA ARE SEEDED AS `system_catalog`. `resolveProviderSuggestion` already
-- prefers a `system_catalog` row over a `provider_sourced` one for the same
-- scientific name, so a later provider identification of any of these crops
-- resolves onto the row seeded here and inherits its family and timing.
--
-- IDEMPOTENT: every insert is guarded on the scientific name, so re-running
-- against an environment that already has these taxa adds nothing.
--
-- Source: docs/architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md;
--         docs/development/recommendation-safety-catalog.md;
--         migrations/1787100000000_taxonomy-seasonal-facts-and-bed-history.sql.

-- Up Migration

SET ROLE verdery_migration;

-- `gen_random_uuid()` rather than the application's UUIDv7: these rows are
-- catalogue content created by a migration, not records whose creation order
-- carries meaning, and the pgcrypto function is available without adding a
-- dependency on the application's own identifier generator.
INSERT INTO plants_inventory.taxonomy_reference
  (id, scientific_name, common_name, variety_name, family, genus, source, created_by_profile_id)
SELECT
  gen_random_uuid(), seed.scientific_name, seed.common_name, NULL,
  seed.family, seed.genus, 'system_catalog', NULL
FROM (VALUES
  ('Solanum lycopersicum', 'Tomato',      'Solanaceae', 'Solanum'),
  ('Solanum tuberosum',    'Potato',      'Solanaceae', 'Solanum'),
  ('Capsicum annuum',      'Pepper',      'Solanaceae', 'Capsicum'),
  ('Lactuca sativa',       'Lettuce',     'Asteraceae', 'Lactuca'),
  ('Daucus carota',        'Carrot',      'Apiaceae',   'Daucus'),
  ('Raphanus sativus',     'Radish',      'Brassicaceae', 'Raphanus'),
  ('Brassica oleracea',    'Cabbage',     'Brassicaceae', 'Brassica'),
  ('Cucumis sativus',      'Cucumber',    'Cucurbitaceae', 'Cucumis'),
  ('Cucurbita pepo',       'Summer squash', 'Cucurbitaceae', 'Cucurbita'),
  ('Phaseolus vulgaris',   'Bush bean',   'Fabaceae',   'Phaseolus'),
  ('Pisum sativum',        'Garden pea',  'Fabaceae',   'Pisum'),
  ('Allium cepa',          'Onion',       'Amaryllidaceae', 'Allium'),
  ('Spinacia oleracea',    'Spinach',     'Amaranthaceae', 'Spinacia'),
  ('Beta vulgaris',        'Beetroot',    'Amaranthaceae', 'Beta'),
  ('Ocimum basilicum',     'Basil',       'Lamiaceae',  'Ocimum')
) AS seed(scientific_name, common_name, family, genus)
WHERE NOT EXISTS (
  SELECT 1 FROM plants_inventory.taxonomy_reference AS existing
  WHERE lower(existing.scientific_name) = lower(seed.scientific_name)
);

-- Northern-hemisphere timing, extracted from the cited publications.
-- Months are 1-12. A NULL is an absence in the source, never a default.
INSERT INTO plants_inventory.taxonomy_seasonal_fact (
  id, taxonomy_reference_id, hemisphere,
  sow_indoors_start_month, sow_indoors_end_month,
  sow_outdoors_start_month, sow_outdoors_end_month,
  transplant_start_month, transplant_end_month,
  harvest_start_month, harvest_end_month,
  days_to_maturity_min, days_to_maturity_max,
  succession_interval_days, rotation_rest_seasons,
  authoring_method, source_citation, review_status
)
SELECT
  gen_random_uuid(), reference.id, 'northern',
  seed.sow_in_start, seed.sow_in_end,
  seed.sow_out_start, seed.sow_out_end,
  seed.transplant_start, seed.transplant_end,
  seed.harvest_start, seed.harvest_end,
  seed.maturity_min, seed.maturity_max,
  seed.succession_days, seed.rotation_rest,
  'ai_extracted_from_source', seed.citation, 'awaiting_horticultural_review'
FROM (VALUES
  ('Solanum lycopersicum', 2, 3, NULL, NULL, 5, 6, 7, 10, 60, 90, NULL, 3,
   'USDA NRCS Plant Guide and USDA National Agricultural Library, Home Gardening: Tomatoes (public domain, United States federal publication)'),
  ('Solanum tuberosum', NULL, NULL, 3, 5, NULL, NULL, 7, 10, 90, 120, NULL, 3,
   'USDA National Agricultural Library, Home Gardening: Potatoes (public domain, United States federal publication)'),
  ('Capsicum annuum', 2, 3, NULL, NULL, 5, 6, 7, 10, 60, 90, NULL, 3,
   'USDA National Agricultural Library, Home Gardening: Peppers (public domain, United States federal publication)'),
  ('Lactuca sativa', 2, 3, 3, 9, 4, 5, 5, 11, 45, 70, 14, 1,
   'USDA National Agricultural Library, Home Gardening: Lettuce (public domain, United States federal publication)'),
  ('Daucus carota', NULL, NULL, 3, 7, NULL, NULL, 6, 11, 70, 80, 21, 2,
   'USDA National Agricultural Library, Home Gardening: Carrots (public domain, United States federal publication)'),
  ('Raphanus sativus', NULL, NULL, 3, 9, NULL, NULL, 4, 11, 22, 30, 10, 2,
   'USDA National Agricultural Library, Home Gardening: Radishes (public domain, United States federal publication)'),
  ('Brassica oleracea', 1, 3, NULL, NULL, 3, 5, 6, 11, 70, 120, NULL, 3,
   'USDA National Agricultural Library, Home Gardening: Cabbage and Cole Crops (public domain, United States federal publication)'),
  ('Cucumis sativus', 4, 5, 5, 6, 5, 6, 7, 9, 50, 70, 21, 2,
   'USDA National Agricultural Library, Home Gardening: Cucumbers (public domain, United States federal publication)'),
  ('Cucurbita pepo', 4, 5, 5, 6, 5, 6, 7, 9, 45, 60, 21, 2,
   'USDA National Agricultural Library, Home Gardening: Squash (public domain, United States federal publication)'),
  ('Phaseolus vulgaris', NULL, NULL, 5, 7, NULL, NULL, 7, 9, 50, 65, 14, 1,
   'USDA National Agricultural Library, Home Gardening: Beans (public domain, United States federal publication)'),
  ('Pisum sativum', NULL, NULL, 2, 4, NULL, NULL, 5, 7, 55, 70, 14, 1,
   'USDA National Agricultural Library, Home Gardening: Peas (public domain, United States federal publication)'),
  ('Allium cepa', 1, 2, 3, 4, 4, 5, 7, 9, 90, 120, NULL, 3,
   'USDA National Agricultural Library, Home Gardening: Onions (public domain, United States federal publication)'),
  ('Spinacia oleracea', NULL, NULL, 3, 9, NULL, NULL, 4, 11, 37, 50, 14, 2,
   'USDA National Agricultural Library, Home Gardening: Spinach (public domain, United States federal publication)'),
  ('Beta vulgaris', NULL, NULL, 3, 7, NULL, NULL, 6, 10, 50, 70, 21, 2,
   'USDA National Agricultural Library, Home Gardening: Beets (public domain, United States federal publication)'),
  ('Ocimum basilicum', 3, 4, 5, 6, 5, 6, 6, 9, 60, 90, NULL, NULL,
   'USDA National Agricultural Library, Home Gardening: Herbs (public domain, United States federal publication)')
) AS seed(
  scientific_name, sow_in_start, sow_in_end, sow_out_start, sow_out_end,
  transplant_start, transplant_end, harvest_start, harvest_end,
  maturity_min, maturity_max, succession_days, rotation_rest, citation
)
JOIN plants_inventory.taxonomy_reference AS reference
  ON lower(reference.scientific_name) = lower(seed.scientific_name)
WHERE NOT EXISTS (
  SELECT 1 FROM plants_inventory.taxonomy_seasonal_fact AS existing
  WHERE existing.taxonomy_reference_id = reference.id
    AND existing.hemisphere = 'northern'
);

RESET ROLE;

-- Down Migration

SET ROLE verdery_migration;

-- Removes only the rows this migration seeded, identified by their own
-- extraction provenance and pending review. A row a reviewer has since
-- signed off is left alone: rolling back a schema change must not silently
-- discard somebody's review work.
DELETE FROM plants_inventory.taxonomy_seasonal_fact
WHERE authoring_method = 'ai_extracted_from_source'
  AND review_status = 'awaiting_horticultural_review'
  AND source_citation LIKE 'USDA%';

RESET ROLE;
