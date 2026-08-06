import type { Position } from './geometry.js';

/** Minimum georeference shape needed by the shared local/WGS84 transform. */
export interface LocalGeoreferenceTransform {
  readonly localAnchor: Position;
  readonly geographicAnchor: Position;
  readonly rotationDegrees: number;
  readonly scaleCorrection: number;
}

const METRES_PER_DEGREE_LATITUDE = 111_320;
const DEGREES_TO_RADIANS = Math.PI / 180;

function metresPerDegreeLongitude(latitudeDegrees: number): number {
  return METRES_PER_DEGREE_LATITUDE * Math.cos(latitudeDegrees * DEGREES_TO_RADIANS);
}

function rotate(x: number, y: number, degrees: number): Position {
  const radians = degrees * DEGREES_TO_RADIANS;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** Garden-local metres to WGS84 using the garden-sized equirectangular approximation. */
export function localMetresToGeographic(
  local: Position,
  georeference: LocalGeoreferenceTransform,
): Position {
  const dx = (local[0] - georeference.localAnchor[0]) * georeference.scaleCorrection;
  const dy = (local[1] - georeference.localAnchor[1]) * georeference.scaleCorrection;
  const [eastMetres, northMetres] = rotate(dx, dy, georeference.rotationDegrees);
  const [anchorLongitude, anchorLatitude] = georeference.geographicAnchor;
  return [
    anchorLongitude + eastMetres / metresPerDegreeLongitude(anchorLatitude),
    anchorLatitude + northMetres / METRES_PER_DEGREE_LATITUDE,
  ];
}

/** Exact inverse used by both basemap rendering and aerial proposal extraction. */
export function geographicToLocalMetres(
  geographic: Position,
  georeference: LocalGeoreferenceTransform,
): Position {
  const [anchorLongitude, anchorLatitude] = georeference.geographicAnchor;
  const eastMetres = (geographic[0] - anchorLongitude) * metresPerDegreeLongitude(anchorLatitude);
  const northMetres = (geographic[1] - anchorLatitude) * METRES_PER_DEGREE_LATITUDE;
  const [dx, dy] = rotate(eastMetres, northMetres, -georeference.rotationDegrees);
  return [
    georeference.localAnchor[0] + dx / georeference.scaleCorrection,
    georeference.localAnchor[1] + dy / georeference.scaleCorrection,
  ];
}
