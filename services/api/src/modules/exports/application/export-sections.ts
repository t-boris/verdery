/**
 * The export package's section set (P8-EXPORT-01): pure functions from one
 * structured snapshot to every text entry the worker stages — the
 * top-level manifest, README, account files, media manifests, and (via
 * `export-garden-sections.ts`) each garden's own files. The FORMAT is
 * decided entirely here and versioned by `EXPORT_FORMAT_VERSION`;
 * everything downstream (staging, ZIP assembly) treats sections as opaque
 * bytes.
 *
 * Two files the worker ADDS at assembly time are deliberately absent:
 * `checksums.txt` (covers every packaged file including media bytes only
 * the worker streams) and `missing-media.json` (media present at the
 * boundary but gone from storage at assembly — an assembly-time fact).
 * The README documents both so a package always explains itself.
 */

import type { ExportSnapshotSection } from '@verdery/api-contracts';
import { EXPORT_MEDIA_TRANSFER_ENTRY_PATH } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { buildGardenSections } from './export-garden-sections.js';
import type { ExportSnapshotData } from './export-snapshot-reader.js';

const JSON_CONTENT_TYPE = 'application/json';
const MARKDOWN_CONTENT_TYPE = 'text/markdown';

export interface ExportSectionBuildContext {
  readonly exportRequestId: Uuid;
  readonly formatVersion: string;
  readonly serviceVersion: string;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function section(
  entryPath: string,
  disposition: 'package' | 'transfer',
  contentType: string,
  content: string,
): ExportSnapshotSection {
  return { entryPath, disposition, contentType, content };
}

/**
 * `export.json` — the package's own manifest: schema and application
 * versions (section 3's "Export schema and application version"), scope,
 * the recorded boundary, per-garden inclusion/exclusion, and the honest
 * disclosures section 7 requires ("Changes after that boundary may be
 * excluded and are disclosed in the manifest").
 */
function buildManifest(snapshot: ExportSnapshotData, context: ExportSectionBuildContext): string {
  return json({
    formatVersion: context.formatVersion,
    generator: { service: 'verdery-api', serviceVersion: context.serviceVersion },
    exportRequestId: context.exportRequestId,
    scope: snapshot.scope,
    includeMedia: snapshot.includeMedia,
    boundaryAt: snapshot.boundaryAt.toISOString(),
    gardens: snapshot.gardenListings,
    counts: {
      gardensIncluded: snapshot.gardens.length,
      mediaFilesListed: snapshot.mediaFiles.length,
    },
    disclosures: [
      'Records created after boundaryAt are not included; every structured record was read in one repeatable-read database snapshot taken at boundaryAt, so cross-references inside this package are internally consistent.',
      'Media files listed in media-manifest.json but deleted from storage before packaging are listed in missing-media.json rather than silently omitted.',
      'Raw scan artifacts (raw_capture) are not included: they require a separate sensitive-media permission that does not exist yet.',
      'Server-side derived media (previews, tiles) are rebuildable pipeline artifacts and are not included; originals are.',
      'Internal audit journals (per-revision command history) and provider-cached weather data are not part of the user data surface and are not included.',
    ],
  });
}

const README_TEMPLATE = `# Verdery data export

This package is a machine-readable copy of your Verdery garden data.

## Structure

- \`export.json\` — this package's manifest: format and application
  versions, scope, the consistency boundary (\`boundaryAt\`), which gardens
  are included or excluded and why, and disclosure notes.
- \`account/profile.json\` — your own profile, sign-in provider links, and
  recorded consents (account-wide exports only).
- \`account/notification-preferences.json\` — your notification preferences
  and quiet hours (account-wide exports only).
- \`gardens/<gardenId>/garden.json\` — the garden, its memberships
  (collaborator profile ids and roles only — never their personal account
  data), coordinate spaces, georeferences, and plan calibrations.
- \`gardens/<gardenId>/map-objects.geojson\` — the garden map as GeoJSON.
- \`gardens/<gardenId>/plants.json\` / \`plants.csv\` — plant inventory.
- \`gardens/<gardenId>/observations.json\` / \`observations.csv\` — the
  append-only observation history.
- \`gardens/<gardenId>/tasks.json\` / \`tasks.csv\` — care tasks.
- \`gardens/<gardenId>/recommendations.json\` / \`recommendations.csv\` —
  recommendations, their evidence, and your feedback.
- \`gardens/<gardenId>/media-records.json\` — media metadata and checksums.
- \`media-manifest.json\` — every media file included in this package.
- \`media/<gardenId>/<file>\` — your original photos and imported plans,
  when media inclusion was requested.
- \`missing-media.json\` — media listed at the boundary but no longer in
  storage at packaging time (deleted in between); explicitly listed, never
  silently omitted.
- \`checksums.txt\` — \`<sha256>  <path>\` for every file in this package.

## Units and coordinates

Distances and sizes are SI (metres) unless a field says otherwise. Map
geometry is in GARDEN-LOCAL metres within the coordinate space each feature
names (\`coordinateSpaceId\`); the GeoJSON document carries the coordinate
spaces and any georeference parameters (WGS84 anchor, rotation, scale) as
\`verdery:*\` members. WGS84-transformed coordinates are not emitted.

## Uncertainty and limitations

Positions, boundaries, and measurements derive from phone capture, photo
analysis, and manual editing. They carry the recorded provenance,
confidence, and accuracy fields — and they are NOT legal survey data.
Boundary lines in particular must not be used to resolve property disputes.

Recommendations reflect the rule versions recorded with them and the
evidence available at generation time.

## Consistency

Every structured record was read in one repeatable-read database snapshot
taken at \`boundaryAt\` (see \`export.json\`). Changes made after that
instant are not in this package.
`;

/** `media-manifest.json` (packaged) and `media-transfer.json` (worker-only) — the same list, split by audience: the manifest names files and checksums; the transfer carries the internal storage locations the worker streams from, which never enter the package. */
function buildMediaSections(snapshot: ExportSnapshotData): ExportSnapshotSection[] {
  const manifest = json({
    includeMedia: snapshot.includeMedia,
    files: snapshot.mediaFiles.map((file) => ({
      mediaId: file.mediaId,
      gardenId: file.gardenId,
      entryPath: file.entryPath,
      displayFilename: file.displayFilename,
      mediaClass: file.mediaClass,
      contentType: file.contentType,
      byteSize: file.byteSize,
      checksumSha256: file.checksumSha256,
    })),
  });

  const transfer = json({
    files: snapshot.mediaFiles.map((file) => ({
      mediaId: file.mediaId,
      entryPath: file.entryPath,
      bucketName: file.bucketName,
      objectKey: file.objectKey,
      contentType: file.contentType,
      expectedByteSize: file.byteSize,
      expectedChecksumSha256: file.checksumSha256,
    })),
  });

  return [
    section('media-manifest.json', 'package', JSON_CONTENT_TYPE, manifest),
    section(EXPORT_MEDIA_TRANSFER_ENTRY_PATH, 'transfer', JSON_CONTENT_TYPE, transfer),
  ];
}

/** The full ordered section set for one snapshot — the package's table of contents in code. */
export function buildExportSections(
  snapshot: ExportSnapshotData,
  context: ExportSectionBuildContext,
): ExportSnapshotSection[] {
  const sections: ExportSnapshotSection[] = [
    section('export.json', 'package', JSON_CONTENT_TYPE, buildManifest(snapshot, context)),
    section('README.md', 'package', MARKDOWN_CONTENT_TYPE, README_TEMPLATE),
  ];

  if (snapshot.profile !== null) {
    sections.push(
      section('account/profile.json', 'package', JSON_CONTENT_TYPE, json(snapshot.profile)),
    );
  }
  if (snapshot.notificationPreferences !== null) {
    sections.push(
      section(
        'account/notification-preferences.json',
        'package',
        JSON_CONTENT_TYPE,
        json(snapshot.notificationPreferences),
      ),
    );
  }

  for (const garden of snapshot.gardens) {
    sections.push(...buildGardenSections(garden));
  }

  sections.push(...buildMediaSections(snapshot));

  return sections;
}
