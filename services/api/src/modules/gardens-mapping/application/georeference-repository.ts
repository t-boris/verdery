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
  /** Human-readable label for the anchor; never used as geometric authority. */
  readonly displayAddress: string | null;
  readonly provenance: ProvenanceKind;
  readonly method: string;
  readonly revision: number;
}

/** A georeference about to be written. Identical to `Georeference` minus the id this repository assigns. */
export interface NewGeoreference {
  readonly gardenId: Uuid;
  readonly coordinateSpaceId: Uuid;
  readonly localAnchor: Position;
  readonly geographicAnchor: Position;
  readonly rotationDegrees: number;
  readonly scaleCorrection: number;
  readonly accuracyMetres: number | null;
  readonly displayAddress: string | null;
  readonly provenance: ProvenanceKind;
  readonly method: string;
  readonly revision: number;
  readonly createdByProfileId: Uuid;
}

/**
 * What every module OUTSIDE gardens-mapping needs of a georeference: to read
 * the one that is current.
 *
 * Integrations (weather refresh) and tasks-recommendations (hemisphere,
 * seasonal plan) consume geography; none of them authors it. Narrowing what
 * they depend on keeps that true by construction rather than by convention —
 * and keeps their test doubles honest, since a fake that cannot write is
 * exactly right for a caller that never writes.
 */
export interface GeoreferenceReader {
  /** The current georeference (`valid_until IS NULL`), or `null` when the garden has never been georeferenced. */
  findCurrentForGarden(gardenId: Uuid): Promise<Georeference | null>;
}

/**
 * Georeferencing is still not one of the thirteen map commands — there is no
 * `upsertGeoreference` in `packages/geometry-contracts`'s
 * `MapCommandPayload`, and there should not be: those commands mutate
 * objects INSIDE a coordinate space, while this record defines that space's
 * relationship to the Earth. `PUT /gardens/{gardenId}/georeference`
 * (P12-GEO-01) is its own revisioned resource for that reason.
 */
export interface GeoreferenceRepository extends GeoreferenceReader {
  /**
   * Closes the garden's current record at `now` and inserts `next` as the
   * new current one, returning what was written.
   *
   * One method rather than a `close` plus an `insert`, because the partial
   * outcome — a garden whose georeference is closed and not replaced — is
   * not a state this domain has any meaning for. The table's partial unique
   * index (one row per garden with `valid_until IS NULL`) would reject the
   * inverse ordering anyway; this keeps the pair inseparable in the port,
   * not only in the schema.
   */
  supersedeCurrent(next: NewGeoreference, now: Date): Promise<Georeference>;
}
