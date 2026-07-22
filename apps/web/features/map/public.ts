/**
 * Public surface of the map feature.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export { MapEditor } from './map-editor';
export { useGardenMap, useSubmitMapCommand, type MapDocumentData } from './queries';
export { openFreeMapProvider, zoomForMetresPerPixel } from './basemap-provider';
export type { BasemapProvider, Georeference } from './basemap-provider';
