/**
 * Canonical geometry semantics shared by the backend, the Apple client, and the
 * web client.
 *
 * This package owns coordinate rounding, tolerances, validation, and curve
 * densification so that every runtime produces identical results for identical
 * input. The Swift equivalent lives in `apps/ios` and is verified against the
 * same fixtures in `packages/test-fixtures`.
 */

export {
  COORDINATE_DECIMAL_PLACES,
  COORDINATE_PRECISION_METRES,
  MAXIMUM_CHORD_DEVIATION_METRES,
  MAXIMUM_COORDINATE_MAGNITUDE_METRES,
  MINIMUM_LINE_LENGTH_METRES,
  MINIMUM_LINE_VERTEX_COUNT,
  MINIMUM_POLYGON_AREA_SQUARE_METRES,
  MINIMUM_RING_VERTEX_COUNT,
  SNAP_TOLERANCE_SCREEN_PIXELS,
  VERTEX_EPSILON_METRES,
} from './tolerances.js';

export {
  CoordinateRangeError,
  coordinatesEqual,
  roundCoordinate,
  roundPosition,
} from './rounding.js';

export {
  GEOGRAPHIC_SRID,
  LOCAL_PLANAR_SRID,
  isLocalPlanarSrid,
  sridForKind,
} from './coordinate-space.js';
export type {
  AxisConvention,
  CoordinateSpaceKind,
  LocalCoordinateSpace,
} from './coordinate-space.js';

export { positionsOf, roundGeometry } from './geometry.js';
export type {
  Geometry,
  GeometryEnvelope,
  GeometryType,
  LineStringGeometry,
  MultiLineStringGeometry,
  MultiPolygonGeometry,
  PointGeometry,
  PolygonGeometry,
  Position,
  ProvenanceKind,
} from './geometry.js';

export { densifyCubicChain, isValidControlPointCount, segmentCount } from './curve.js';
export type { CurveKind, CurveMetadata } from './curve.js';

export {
  distanceBetween,
  isGeometryValid,
  lineLength,
  ringArea,
  ringSelfIntersects,
  signedRingArea,
  validateGeometry,
} from './validation.js';
export type { ValidationIssue, ValidationSeverity } from './validation.js';

export { GARDEN_OBJECT_CATEGORIES, isGeometryTypeAllowedForCategory } from './object-category.js';
export type {
  AnnotationDetails,
  BedDetails,
  BedKind,
  FenceDetails,
  FenceKind,
  GardenObjectCategory,
  GardenObjectDetails,
  GateDetails,
  PlantPlacementDetails,
  StructureDetails,
  StructureKind,
  TreeDetails,
  UtilityExclusionDetails,
  UtilityExclusionKind,
  ZoneDetails,
  ZoneKind,
} from './object-category.js';

export type { Measurement, MeasurementAcquisitionMethod, MeasurementUnit } from './measurement.js';

export type {
  AssignPlantPayload,
  ChangePropertiesPayload,
  CreateObjectPayload,
  DecideProposalPayload,
  DeleteObjectPayload,
  DuplicateObjectPayload,
  EditVertexPayload,
  JoinLineworkPayload,
  MapCommand,
  MapCommandActorType,
  MapCommandEnvelope,
  MapCommandPayload,
  MapCommandType,
  MoveObjectPayload,
  ProposalDecision,
  ReplaceGeometryPayload,
  RestoreObjectPayload,
  SplitLineworkPayload,
  UpsertCalibrationPayload,
  VertexOperation,
} from './command.js';

export { deriveInverseCommand } from './inverse-command.js';
export type { ObjectLifecycleState, ObjectSnapshot } from './inverse-command.js';
