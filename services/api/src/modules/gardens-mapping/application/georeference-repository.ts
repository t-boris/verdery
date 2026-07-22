import type { Position, ProvenanceKind } from '@verdery/geometry-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface Georeference {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly coordinateSpaceId: Uuid;
  readonly localAnchor: Position;
  readonly geographicAnchor: Position;
  readonly rotationDegrees: number;
  readonly scaleCorrection: number;
  readonly accuracyMetres: number | null;
  readonly provenance: ProvenanceKind;
  readonly method: string;
  readonly revision: number;
}

/**
 * Read-only this pass: none of the thirteen map commands mutate
 * georeferencing (there is no `upsertGeoreference` command in
 * `packages/geometry-contracts`'s `MapCommandPayload`), so only the lookup
 * `GetGardenMap` needs exists here.
 */
export interface GeoreferenceRepository {
  /** The current georeference (`valid_until IS NULL`), or `null` when the garden has never been georeferenced. */
  findCurrentForGarden(gardenId: Uuid): Promise<Georeference | null>;
}
