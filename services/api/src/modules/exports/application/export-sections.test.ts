/**
 * Pure section-builder tests (P8-EXPORT-01): the package's table of
 * contents, the manifest's disclosures, the CSV escaping rule, the GeoJSON
 * document's coordinate-space metadata, and — the privacy-critical split —
 * internal storage keys appearing ONLY in the worker-only `transfer`
 * section, never in any packaged entry.
 */

import { EXPORT_MEDIA_TRANSFER_ENTRY_PATH } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import { toCsv } from './export-csv.js';
import { buildExportSections } from './export-sections.js';
import type {
  ExportGardenData,
  ExportMediaFileEntry,
  ExportSnapshotData,
} from './export-snapshot-reader.js';

const GARDEN_ID = '01890000-0000-7000-8000-0000000000a1';

function gardenData(overrides: Partial<ExportGardenData> = {}): ExportGardenData {
  return {
    garden: {
      id: GARDEN_ID,
      name: 'Backyard',
      lifecycleState: 'active',
      revision: 3,
      createdAt: '2026-07-01T09:00:00.000Z',
      updatedAt: '2026-07-20T09:00:00.000Z',
    },
    memberships: [
      {
        profileId: '01890000-0000-7000-8000-0000000000b1',
        role: 'owner',
        state: 'active',
        createdAt: '2026-07-01T09:00:00.000Z',
      },
    ],
    coordinateSpaces: [],
    georeferences: [],
    calibrations: [],
    mapObjects: [
      {
        id: '01890000-0000-7000-8000-0000000000c1',
        coordinateSpaceId: '01890000-0000-7000-8000-0000000000c2',
        category: 'bed',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
        label: 'North bed',
        provenance: 'manual',
        confidence: null,
        lifecycleState: 'active',
        revision: 2,
        createdAt: '2026-07-01T09:00:00.000Z',
        updatedAt: '2026-07-02T09:00:00.000Z',
        details: { bedKind: 'raised', soilNotes: 'clay' },
      },
    ],
    plants: [{ id: 'plant-1', displayName: 'Rose, "Peace"', quantity: null }],
    plantPhotos: [],
    plantIdentifications: [],
    observations: [],
    observationPhotos: [],
    imageAnalysisResults: [],
    tasks: [],
    taskAttachments: [],
    recommendations: [],
    recommendationEvidence: [],
    recommendationPriorityFactors: [],
    recommendationFeedback: [],
    recommendationAiExplanations: [],
    mediaRecords: [],
    ...overrides,
  };
}

function mediaFile(): ExportMediaFileEntry {
  return {
    mediaId: 'media-1',
    gardenId: GARDEN_ID,
    entryPath: `media/${GARDEN_ID}/media-1-rose.jpg`,
    displayFilename: 'rose.jpg',
    mediaClass: 'garden_photo',
    contentType: 'image/jpeg',
    byteSize: 123,
    checksumSha256: 'a'.repeat(64),
    bucketName: 'test-user-media',
    objectKey: 'ab/media-1/object-1',
  };
}

function snapshot(overrides: Partial<ExportSnapshotData> = {}): ExportSnapshotData {
  return {
    boundaryAt: new Date('2026-07-25T09:00:00Z'),
    scope: 'account',
    requesterProfileId: '01890000-0000-7000-8000-0000000000b1',
    includeMedia: true,
    profile: {
      id: '01890000-0000-7000-8000-0000000000b1',
      accountState: 'active',
      locale: 'en',
      timeZone: 'America/New_York',
      createdAt: '2026-06-01T09:00:00.000Z',
      updatedAt: '2026-07-01T09:00:00.000Z',
      providerLinks: [],
      consents: [],
    },
    notificationPreferences: { quietHours: null, entries: [] },
    gardenListings: [
      {
        gardenId: GARDEN_ID,
        name: 'Backyard',
        role: 'owner',
        included: true,
        exclusionReason: null,
      },
      {
        gardenId: '01890000-0000-7000-8000-0000000000a2',
        name: 'Shared plot',
        role: 'editor',
        included: false,
        exclusionReason: 'not_owner',
      },
    ],
    gardens: [gardenData()],
    mediaFiles: [mediaFile()],
    ...overrides,
  };
}

const CONTEXT = {
  exportRequestId: '01890000-0000-7000-8000-0000000000f1',
  formatVersion: '1',
  serviceVersion: '1.0.0-test',
};

describe('toCsv', () => {
  it('escapes commas, quotes, and newlines per RFC 4180 and writes null as the empty field', () => {
    const csv = toCsv(
      ['id', 'name', 'note'],
      [
        ['a', 'Rose, "Peace"', 'line one\nline two'],
        ['b', null, 7],
      ],
    );

    expect(csv).toBe(
      'id,name,note\r\n' + 'a,"Rose, ""Peace""","line one\nline two"\r\n' + 'b,,7\r\n',
    );
  });
});

describe('buildExportSections', () => {
  it('emits the full table of contents: manifest, README, account files, per-garden files, and both media manifests', () => {
    const sections = buildExportSections(snapshot(), CONTEXT);
    const paths = sections.map((section) => section.entryPath);

    expect(paths).toEqual([
      'export.json',
      'README.md',
      'account/profile.json',
      'account/notification-preferences.json',
      `gardens/${GARDEN_ID}/garden.json`,
      `gardens/${GARDEN_ID}/map-objects.geojson`,
      `gardens/${GARDEN_ID}/plants.json`,
      `gardens/${GARDEN_ID}/plants.csv`,
      `gardens/${GARDEN_ID}/observations.json`,
      `gardens/${GARDEN_ID}/observations.csv`,
      `gardens/${GARDEN_ID}/tasks.json`,
      `gardens/${GARDEN_ID}/tasks.csv`,
      `gardens/${GARDEN_ID}/recommendations.json`,
      `gardens/${GARDEN_ID}/recommendations.csv`,
      `gardens/${GARDEN_ID}/media-records.json`,
      'media-manifest.json',
      EXPORT_MEDIA_TRANSFER_ENTRY_PATH,
    ]);
  });

  it('a garden-scoped snapshot (no profile, no preferences) carries no account files', () => {
    const sections = buildExportSections(
      snapshot({ scope: 'garden', profile: null, notificationPreferences: null }),
      CONTEXT,
    );

    expect(sections.some((section) => section.entryPath.startsWith('account/'))).toBe(false);
  });

  it('internal storage keys travel ONLY in the transfer-disposition manifest, never in any packaged entry', () => {
    const sections = buildExportSections(snapshot(), CONTEXT);

    const transfer = sections.find(
      (section) => section.entryPath === EXPORT_MEDIA_TRANSFER_ENTRY_PATH,
    );
    expect(transfer?.disposition).toBe('transfer');
    expect(transfer?.content).toContain('ab/media-1/object-1');
    expect(transfer?.content).toContain('test-user-media');

    for (const section of sections.filter((candidate) => candidate.disposition === 'package')) {
      expect(section.content).not.toContain('ab/media-1/object-1');
      expect(section.content).not.toContain('test-user-media');
    }
  });

  it("the manifest disclosures name the boundary rule, exclusions, and the requester's non-owned gardens", () => {
    const sections = buildExportSections(snapshot(), CONTEXT);
    const manifest = JSON.parse(
      sections.find((section) => section.entryPath === 'export.json')?.content ?? '{}',
    ) as {
      boundaryAt: string;
      gardens: { gardenId: string; included: boolean; exclusionReason: string | null }[];
      disclosures: string[];
      generator: { serviceVersion: string };
    };

    expect(manifest.boundaryAt).toBe('2026-07-25T09:00:00.000Z');
    expect(manifest.generator.serviceVersion).toBe('1.0.0-test');
    expect(manifest.gardens).toHaveLength(2);
    expect(manifest.gardens[1]).toMatchObject({ included: false, exclusionReason: 'not_owner' });
    expect(manifest.disclosures.join(' ')).toContain('boundaryAt');
    expect(manifest.disclosures.join(' ')).toContain('raw_capture');
  });

  it('the GeoJSON document carries per-feature coordinate spaces, detail attributes, and the non-survey warning', () => {
    const sections = buildExportSections(snapshot(), CONTEXT);
    const geojson = JSON.parse(
      sections.find((section) => section.entryPath.endsWith('map-objects.geojson'))?.content ??
        '{}',
    ) as {
      type: string;
      features: {
        id: string;
        geometry: { type: string };
        properties: Record<string, unknown>;
      }[];
      'verdery:units': string;
      'verdery:warning': string;
    };

    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson['verdery:units']).toBe('metres');
    expect(geojson['verdery:warning']).toContain('not legal survey data');
    expect(geojson.features[0]?.geometry.type).toBe('Polygon');
    expect(geojson.features[0]?.properties).toMatchObject({
      coordinateSpaceId: '01890000-0000-7000-8000-0000000000c2',
      category: 'bed',
      provenance: 'manual',
      revision: 2,
      details: { bedKind: 'raised', soilNotes: 'clay' },
    });
  });

  it('membership rows expose facts only — no collaborator profile fields beyond the profile id', () => {
    const sections = buildExportSections(snapshot(), CONTEXT);
    const gardenJson = JSON.parse(
      sections.find((section) => section.entryPath === `gardens/${GARDEN_ID}/garden.json`)
        ?.content ?? '{}',
    ) as { memberships: Record<string, unknown>[] };

    expect(Object.keys(gardenJson.memberships[0] ?? {}).sort()).toEqual([
      'createdAt',
      'profileId',
      'role',
      'state',
    ]);
  });

  it('includeMedia false still lists media metadata but no transfer files', () => {
    const sections = buildExportSections(
      snapshot({ includeMedia: false, mediaFiles: [] }),
      CONTEXT,
    );

    const manifest = JSON.parse(
      sections.find((section) => section.entryPath === 'media-manifest.json')?.content ?? '{}',
    ) as { includeMedia: boolean; files: unknown[] };
    const transfer = JSON.parse(
      sections.find((section) => section.entryPath === EXPORT_MEDIA_TRANSFER_ENTRY_PATH)?.content ??
        '{}',
    ) as { files: unknown[] };

    expect(manifest.includeMedia).toBe(false);
    expect(manifest.files).toHaveLength(0);
    expect(transfer.files).toHaveLength(0);
  });
});
