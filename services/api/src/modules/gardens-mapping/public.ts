/**
 * Public interface of the gardens-mapping module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type { Garden, GardenLifecycleState } from './domain/garden.js';
export type { GardenCapability, GardenRole } from './domain/garden-role.js';
export type { MapObject, MapObjectLifecycleState, MapObjectSummary } from './domain/map-object.js';
export { GardenAuthorization } from './application/garden-authorization.js';
export { ArchiveGarden } from './application/archive-garden.js';
export { CreateGarden } from './application/create-garden.js';
export type { GardenRepository } from './application/garden-repository.js';
export { GetGarden } from './application/get-garden.js';
export type { GardensMappingUnitOfWork } from './application/gardens-mapping-unit-of-work.js';
export { ListGardens } from './application/list-gardens.js';
export type { MembershipRepository } from './application/membership-repository.js';
export { RenameGarden } from './application/rename-garden.js';
export { RequestGardenDeletion } from './application/request-garden-deletion.js';
export { KyselyGardenRepository } from './persistence/kysely-garden-repository.js';
export { KyselyGardensMappingUnitOfWork } from './persistence/kysely-gardens-mapping-unit-of-work.js';
export { KyselyMembershipRepository } from './persistence/kysely-membership-repository.js';
export type { GardensMappingDatabaseSchema } from './persistence/schema.js';
export { registerGardenRoutes } from './transport/garden-routes.js';

// Garden map (P3-BE-01, P3-BE-02).
export type {
  CalibrationRepository,
  Calibration,
  CalibrationReferencePoint,
} from './application/calibration-repository.js';
export type {
  CoordinateSpace,
  CoordinateSpaceRepository,
} from './application/coordinate-space-repository.js';
export type {
  Georeference,
  GeoreferenceRepository,
} from './application/georeference-repository.js';
export type {
  MapObjectRepository,
  ViewportBoundingBox,
} from './application/map-object-repository.js';
export type {
  GardenObjectResource,
  MapCommandResultResource,
} from './application/map-object-view.js';
export type {
  GardenMapDocumentResource,
  GeoreferenceResource,
  ValidationIssueResource,
} from './application/get-garden-map.js';
export type {
  RevisionJournalEntry,
  RevisionJournalWriter,
} from './application/revision-journal-writer.js';
export type { SyncChangeEntry, SyncChangeWriter } from './application/sync-change-writer.js';
export { AssignPlantToTarget } from './application/assign-plant-to-target.js';
export { ChangeMapObjectProperties } from './application/change-map-object-properties.js';
export { CreateMapObject } from './application/create-map-object.js';
export { DecideMapProposal } from './application/decide-map-proposal.js';
export { DeleteMapObject } from './application/delete-map-object.js';
export { DuplicateMapObject } from './application/duplicate-map-object.js';
export { EditMapObjectVertex } from './application/edit-map-object-vertex.js';
export { GetGardenMap } from './application/get-garden-map.js';
export { JoinMapObjectLinework } from './application/join-map-object-linework.js';
export { MoveMapObject } from './application/move-map-object.js';
export { ReplaceMapObjectGeometry } from './application/replace-map-object-geometry.js';
export { RestoreMapObject } from './application/restore-map-object.js';
export { SplitMapObjectLinework } from './application/split-map-object-linework.js';
export { UpsertMapCalibration } from './application/upsert-map-calibration.js';
export { KyselyCalibrationRepository } from './persistence/kysely-calibration-repository.js';
export { KyselyCoordinateSpaceRepository } from './persistence/kysely-coordinate-space-repository.js';
export { KyselyGeoreferenceRepository } from './persistence/kysely-georeference-repository.js';
export { KyselyMapObjectRepository } from './persistence/kysely-map-object-repository.js';
export { KyselyRevisionJournalWriter } from './persistence/kysely-revision-journal-writer.js';
export { KyselySyncChangeWriter } from './persistence/kysely-sync-change-writer.js';
export { registerMapRoutes } from './transport/map-routes.js';
export type { MapRoutesDependencies } from './transport/map-routes.js';
