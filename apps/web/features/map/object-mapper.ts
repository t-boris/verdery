/**
 * Conversions between the wire `GardenObject` shape and this feature's local
 * `MapObjectRecord`, and from a record to the `ObjectSnapshot` shape
 * `deriveInverseCommand` (`@verdery/geometry-contracts`) expects.
 */

import type { ObjectSnapshot } from '@verdery/geometry-contracts';

import { fromWireCategoryDetails, type WireGardenObject } from '@/core/api/public';

import type { MapObjectRecord } from './types';

export function toMapObjectRecord(wire: WireGardenObject): MapObjectRecord {
  return {
    id: wire.id,
    gardenId: wire.gardenId,
    category: wire.category,
    geometry: wire.geometryEnvelope.geometry,
    ...(wire.label === undefined ? {} : { label: wire.label }),
    ...(wire.details === undefined
      ? {}
      : { categoryDetails: fromWireCategoryDetails(wire.details) }),
    lifecycleState: wire.lifecycleState,
    revision: wire.revision,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

/** The snapshot form `deriveInverseCommand` needs, captured just before a command mutates this object. */
export function toObjectSnapshot(record: MapObjectRecord): ObjectSnapshot {
  return {
    objectId: record.id,
    category: record.category,
    geometry: record.geometry,
    ...(record.label === undefined ? {} : { label: record.label }),
    ...(record.categoryDetails === undefined ? {} : { categoryDetails: record.categoryDetails }),
    lifecycleState: record.lifecycleState,
  };
}
