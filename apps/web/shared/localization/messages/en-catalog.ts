/**
 * English messages for the plant-catalog feature: taxon browse and the
 * materialized knowledge profile (P11-WEB-01).
 *
 * A separate module spread into `en.ts`, the same posture `en-plants.ts` and
 * `en-observations.ts` already document.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const englishCatalogMessages = {
  'catalog.pageTitle': 'Plant catalog',
  'catalog.pageDescription':
    'Shared reference knowledge about plants, with the source behind every fact.',
  'catalog.searchLabel': 'Search by name',
  'catalog.searchPlaceholder': 'Scientific or common name',
  'catalog.searchEmpty': 'No taxa match that name.',
  'catalog.searchBounded':
    'Showing the first {limit} matches. Narrow the name to see different ones — this search has no further pages.',
  'catalog.matchedSynonym': 'Matched the synonym {name}',
  'catalog.matchedCultivar': 'Matched the cultivar {name}',
  'catalog.backToCatalog': 'Back to the catalog',
  'catalog.profileTitle': 'What is known about this plant',
  'catalog.profileDescription':
    'Source-backed and horticulturist-reviewed facts, with evidence shown beside every value.',
  'catalog.profileLoading': 'Loading what is known about this plant.',
  'catalog.profileMissing':
    'Nothing has been assembled about this plant yet. That is missing knowledge, not an error.',
  'catalog.profileNoFactsTitle': 'Connected sources returned no gardening facts',
  'catalog.profileNoFacts':
    'The botanical identity and reference photos are available, but the currently connected sources supplied no additional facts for this taxon.',
  'catalog.profileAssembled': 'Assembled {date}',
  'catalog.profilePartialTitle': 'Incomplete profile',
  'catalog.profilePartial':
    'This profile is incomplete: at least one thing sources describe about this plant could not be resolved from a reviewed assertion.',
  'catalog.factProvider': 'Source: {provider}',
  'catalog.factSourceBacked': 'Source-backed · not horticulturist-reviewed',
  'catalog.factReviewed': 'Horticulturist-reviewed',
  'catalog.factScope': 'Applies to: {scope}',
  'catalog.imageAlt': 'A reference photograph of this plant',
  'catalog.imageAltOrgan': 'A reference photograph of this plant: {organ}',
  'catalog.imageCredit': 'Photograph: {holder}',
  'catalog.imageOpenFullscreen': 'Open reference photo {number} full screen',
  'catalog.imageCloseFullscreen': 'Close full-screen photo',
  'catalog.imagePrevious': 'Previous photo',
  'catalog.imageNext': 'Next photo',
  'catalog.taxonomyLabel': 'Botanical identity',
  'catalog.familyLabel': 'Family',
  'catalog.genusLabel': 'Genus',
  'catalog.varietyLabel': 'Variety',
  'catalog.taxonomySourceLabel': 'Catalog source',
  'catalog.factHardinessMinimum': 'Minimum hardiness zone',
  'catalog.factHardinessMaximum': 'Maximum hardiness zone',
  'catalog.factSunExposure': 'Sun exposure',
  'catalog.factWaterNeeds': 'Water needs',
  'catalog.factSoilType': 'Preferred soil',
  'catalog.factSoilPhMinimum': 'Minimum soil pH',
  'catalog.factSoilPhMaximum': 'Maximum soil pH',
  'catalog.factDrainage': 'Drainage',
  'catalog.factMatureHeight': 'Mature height',
  'catalog.factMatureSpread': 'Mature spread',
  'catalog.factGrowthHabit': 'Growth habit',
  'catalog.factLifeCycle': 'Life cycle',
  'catalog.factBloomTime': 'Bloom time',
  'catalog.factHarvestTime': 'Harvest time',
  'catalog.factPruning': 'Pruning',
  'catalog.factPropagation': 'Propagation',
  'catalog.factWildlifeValue': 'Wildlife value',
  'catalog.factToxicity': 'Toxicity',
  'catalog.factEdibility': 'Edibility',
  'catalog.factInterestingFact': 'Interesting fact',
};
