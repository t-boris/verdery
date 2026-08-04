/**
 * Public surface of the map feature.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export { MapEditor } from './map-editor';
export { GardenLocationPanel } from './garden-location-panel';
export {
  useGardenMap,
  useSetGardenGeoreference,
  useSubmitMapCommand,
  type MapDocumentData,
} from './queries';
export { openFreeMapProvider, zoomForMetresPerPixel } from './basemap-provider';
export type { BasemapProvider, Georeference } from './basemap-provider';
