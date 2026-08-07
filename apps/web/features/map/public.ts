/**
 * Public surface of the map feature.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export { MapEditor } from './map-editor';
export { GardenLocationPanel } from './garden-location-panel';
export { AddressSearchField } from './address-search-field';
export { MapEmptyPrompt } from './map-empty-prompt';
export {
  useAddressCandidates,
  useGardenMap,
  useSetGardenGeoreference,
  useSubmitMapCommand,
  type MapDocumentData,
} from './queries';
export {
  osmStreetMapProvider,
  usgsNaipImageryProvider,
  zoomForMetresPerPixel,
} from './basemap-provider';
export type { BasemapProvider, BasemapSource, Georeference } from './basemap-provider';
