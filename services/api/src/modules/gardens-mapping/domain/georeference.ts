/**
 * What a georeference means, independent of how it is stored or requested.
 *
 * A georeference relates a garden's whole local coordinate space to the
 * Earth. It is not garden content: changing it moves nothing, because local
 * metres are measured between local points and stay exactly as they were.
 * What it does change is every geographic capability reading it — weather
 * refresh, hemisphere and season, and later solar context.
 *
 * Source: architecture/data-and-geospatial-design.md, section
 * "9. Georeferencing".
 */

import type { GeoreferenceMethod } from '@verdery/api-contracts';
import type { ProvenanceKind } from '@verdery/geometry-contracts';

/**
 * How each authoring method is classified as provenance.
 *
 * The client sends the method — the concrete account of what it did — and
 * this derives the provenance from it. Accepting both from a client would
 * let two fields describing one fact disagree, and no reader could then say
 * which of them the record actually meant.
 */
const PROVENANCE_BY_METHOD: Readonly<Record<GeoreferenceMethod, ProvenanceKind>> = {
  // A device sensor reading is a measurement the user took, with its own
  // reported accuracy — not a drawing, and not an import.
  deviceLocation: 'userMeasurement',
  // Both of these are read off provider imagery or a basemap, which is what
  // `importedMapImagery` names.
  mapPin: 'importedMapImagery',
  imageryAlignment: 'importedMapImagery',
  // Typed coordinates are the user asserting a position directly.
  manualCoordinates: 'manualDrawing',
  // Matching known real-world points to local ones is measurement, however
  // the real-world points themselves were obtained.
  controlPoints: 'userMeasurement',
};

export function provenanceForGeoreferenceMethod(method: GeoreferenceMethod): ProvenanceKind {
  return PROVENANCE_BY_METHOD[method];
}

/**
 * The revision a new record takes when it supersedes `currentRevision`.
 *
 * Georeferencing is append-only: each write closes the current record and
 * inserts a new one, so a garden's geographic history stays readable and an
 * anchor moved by mistake can be seen to have moved. `null` means the garden
 * has never been georeferenced, and the first record is revision 1 — the
 * same base the `revision` column defaults to.
 */
export function nextGeoreferenceRevision(currentRevision: number | null): number {
  return (currentRevision ?? 0) + 1;
}

/** Scale correction applied when a caller does not state one: no correction at all. */
export const DEFAULT_SCALE_CORRECTION = 1;
