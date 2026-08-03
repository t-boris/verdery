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
  'catalog.backToCatalog': 'Back to the catalog',
  'catalog.profileTitle': 'What is known about this plant',
  'catalog.profileDescription':
    'Facts assembled from reviewed external sources, each shown with where it came from.',
  'catalog.profileLoading': 'Loading what is known about this plant.',
  'catalog.profileMissing':
    'Nothing has been assembled about this plant yet. That is missing knowledge, not an error.',
  'catalog.profileNoFacts': 'This profile was assembled without any reviewed facts in it.',
  'catalog.profileAssembled': 'Assembled {date}',
  'catalog.profilePartialTitle': 'Incomplete profile',
  'catalog.profilePartial':
    'This profile is incomplete: at least one thing sources describe about this plant could not be resolved from a reviewed assertion.',
  'catalog.factProvider': 'Source: {provider}',
  'catalog.factScope': 'Applies to: {scope}',
};
