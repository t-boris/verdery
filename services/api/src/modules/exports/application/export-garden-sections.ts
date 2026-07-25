/**
 * Per-garden section builders (P8-EXPORT-01): pure functions from one
 * garden's snapshot data to the package's `gardens/<id>/…` entries — JSON
 * records, the four CSV tabular views the doc names (plants, observations,
 * tasks, recommendations — architecture/data-export-and-deletion.md
 * section 3), and the GeoJSON map document with explicit coordinate-space
 * metadata (section 8). Split from `export-sections.ts` for the 600-line
 * file rule; the orchestrator there is the only caller.
 */

import type { ExportSnapshotSection } from '@verdery/api-contracts';
import type { ExportGardenData } from './export-snapshot-reader.js';
import { toCsv, type CsvValue } from './export-csv.js';

const JSON_CONTENT_TYPE = 'application/json';
const CSV_CONTENT_TYPE = 'text/csv';
const GEOJSON_CONTENT_TYPE = 'application/geo+json';

function packageSection(
  entryPath: string,
  contentType: string,
  content: string,
): ExportSnapshotSection {
  return { entryPath, disposition: 'package', contentType, content };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function scalar(value: unknown): CsvValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * `gardens/<id>/map-objects.geojson`: one Feature per map object, geometry
 * in GARDEN-LOCAL metres. GeoJSON alone cannot say which space coordinates
 * live in, so the document carries the coordinate spaces, units, and
 * georeference parameters as `verdery:*` foreign members (RFC 7946
 * section 6.1 permits them), and every feature names its
 * `coordinateSpaceId`. WGS84-TRANSFORMED geometry is NOT emitted: the doc
 * calls it "Optional … when a valid georeference exists" (section 8), and
 * applying the anchor/rotation/scale transform server-side is a deferred
 * capability — the parameters travel instead, so a consumer holding a
 * georeference can perform the documented transform losslessly.
 */
function buildMapObjectsGeoJson(garden: ExportGardenData): string {
  const features = garden.mapObjects.map((object) => ({
    type: 'Feature' as const,
    id: object.id,
    geometry: object.geometry,
    properties: {
      coordinateSpaceId: object.coordinateSpaceId,
      category: object.category,
      label: object.label,
      provenance: object.provenance,
      confidence: object.confidence,
      lifecycleState: object.lifecycleState,
      revision: object.revision,
      createdAt: object.createdAt,
      updatedAt: object.updatedAt,
      details: object.details,
    },
  }));

  return json({
    type: 'FeatureCollection',
    features,
    'verdery:units': 'metres',
    'verdery:coordinateSpaces': garden.coordinateSpaces,
    'verdery:georeferences': garden.georeferences,
    'verdery:warning':
      'Coordinates are garden-local metres in the named coordinate space, derived from phone capture and manual editing. They are not legal survey data.',
  });
}

function buildPlantsCsv(garden: ExportGardenData): string {
  const headers = [
    'id',
    'displayName',
    'groupingKind',
    'quantity',
    'lifecycleStage',
    'status',
    'varietyLabel',
    'acquisitionDate',
    'gardenAreaMapObjectId',
    'placementMapObjectId',
    'conditionNote',
    'careGuidanceNote',
    'createdAt',
  ];
  const rows = garden.plants.map((plant) => headers.map((header) => scalar(plant[header])));
  return toCsv(headers, rows);
}

function buildObservationsCsv(garden: ExportGardenData): string {
  const headers = [
    'id',
    'plantId',
    'gardenObjectId',
    'actorType',
    'noteText',
    'conditionSummary',
    'correctionKind',
    'correctsObservationId',
    'observedAt',
    'recordedAt',
  ];
  const rows = garden.observations.map((observation) =>
    headers.map((header) => scalar(observation[header])),
  );
  return toCsv(headers, rows);
}

function buildTasksCsv(garden: ExportGardenData): string {
  const headers = [
    'id',
    'title',
    'status',
    'targetKind',
    'targetPlantId',
    'targetGardenAreaId',
    'dueDate',
    'timeWindowStart',
    'timeWindowEnd',
    'recurrenceRule',
    'urgency',
    'source',
    'notes',
    'createdAt',
    'completedAt',
  ];
  const rows = garden.tasks.map((task) => headers.map((header) => scalar(task[header])));
  return toCsv(headers, rows);
}

function buildRecommendationsCsv(garden: ExportGardenData): string {
  const headers = [
    'id',
    'careCategory',
    'state',
    'urgency',
    'targetKind',
    'targetPlantId',
    'targetGardenAreaId',
    'ruleKey',
    'ruleVersion',
    'safetyTier',
    'windowStart',
    'windowEnd',
    'explanation',
    'createdAt',
  ];
  const rows = garden.recommendations.map((recommendation) =>
    headers.map((header) => scalar(recommendation[header])),
  );
  return toCsv(headers, rows);
}

/** Every `gardens/<id>/…` entry for one included garden. */
export function buildGardenSections(garden: ExportGardenData): ExportSnapshotSection[] {
  const prefix = `gardens/${garden.garden.id}`;

  return [
    packageSection(
      `${prefix}/garden.json`,
      JSON_CONTENT_TYPE,
      json({
        garden: garden.garden,
        memberships: garden.memberships,
        coordinateSpaces: garden.coordinateSpaces,
        georeferences: garden.georeferences,
        calibrations: garden.calibrations,
      }),
    ),
    packageSection(
      `${prefix}/map-objects.geojson`,
      GEOJSON_CONTENT_TYPE,
      buildMapObjectsGeoJson(garden),
    ),
    packageSection(
      `${prefix}/plants.json`,
      JSON_CONTENT_TYPE,
      json({
        plants: garden.plants,
        photos: garden.plantPhotos,
        identifications: garden.plantIdentifications,
      }),
    ),
    packageSection(`${prefix}/plants.csv`, CSV_CONTENT_TYPE, buildPlantsCsv(garden)),
    packageSection(
      `${prefix}/observations.json`,
      JSON_CONTENT_TYPE,
      json({
        observations: garden.observations,
        photos: garden.observationPhotos,
        imageAnalysisResults: garden.imageAnalysisResults,
      }),
    ),
    packageSection(`${prefix}/observations.csv`, CSV_CONTENT_TYPE, buildObservationsCsv(garden)),
    packageSection(
      `${prefix}/tasks.json`,
      JSON_CONTENT_TYPE,
      json({ tasks: garden.tasks, attachments: garden.taskAttachments }),
    ),
    packageSection(`${prefix}/tasks.csv`, CSV_CONTENT_TYPE, buildTasksCsv(garden)),
    packageSection(
      `${prefix}/recommendations.json`,
      JSON_CONTENT_TYPE,
      json({
        recommendations: garden.recommendations,
        evidence: garden.recommendationEvidence,
        priorityFactors: garden.recommendationPriorityFactors,
        feedback: garden.recommendationFeedback,
        aiExplanations: garden.recommendationAiExplanations,
      }),
    ),
    packageSection(
      `${prefix}/recommendations.csv`,
      CSV_CONTENT_TYPE,
      buildRecommendationsCsv(garden),
    ),
    packageSection(
      `${prefix}/media-records.json`,
      JSON_CONTENT_TYPE,
      json({ mediaRecords: garden.mediaRecords }),
    ),
  ];
}
