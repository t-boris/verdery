/**
 * `ProcessExportGenerationJob` unit tests over the in-memory doubles: the
 * checkpointed stage/assemble/complete pipeline, the resume path that
 * never re-stages, boundary-frozen content, missing-media listing, the
 * worker-only transfer manifest staying out of the package, terminal
 * versus retryable failure classification, and the no-op redelivery path.
 */

import { createHash } from 'node:crypto';
import type {
  ExportGenerationManifest,
  ExportSectionCheckpoint,
  ExportSnapshotResponse,
} from '@verdery/api-contracts';
import {
  EXPORT_GENERATION_JOB_KIND,
  EXPORT_MEDIA_TRANSFER_ENTRY_PATH,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';
import { FakeExportApiClient, FakeExportObjectStore, silentLogger } from './export-test-doubles.js';
import { ProcessExportGenerationJob } from './process-export-generation-job.js';
import { readZipEntries } from './zip-reading.test-support.js';

const EXPORT_REQUEST_ID = '01890000-0000-7000-8000-000000000001';
const BUCKET = 'test-exports';
const PACKAGE_KEY = 'ab/01890000-0000-7000-8000-00000000000e/01890000-0000-7000-8000-00000000000f';
const STAGING_PREFIX = `staging/${EXPORT_REQUEST_ID}/`;
const MEDIA_BUCKET = 'test-user-media';
const MEDIA_KEY = 'cd/media-1/object-1';
const MEDIA_ENTRY_PATH = 'media/garden-1/media-1-rose.jpg';
const MEDIA_CONTENT = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const MANIFEST: ExportGenerationManifest = {
  jobId: '01890000-0000-7000-8000-0000000000aa',
  jobKind: EXPORT_GENERATION_JOB_KIND,
  exportRequestId: EXPORT_REQUEST_ID,
};

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

const TRANSFER_CONTENT = `${JSON.stringify({
  files: [
    {
      mediaId: 'media-1',
      entryPath: MEDIA_ENTRY_PATH,
      bucketName: MEDIA_BUCKET,
      objectKey: MEDIA_KEY,
      contentType: 'image/jpeg',
      expectedByteSize: MEDIA_CONTENT.length,
      expectedChecksumSha256: sha256(MEDIA_CONTENT),
    },
  ],
})}\n`;

function firstAttemptSnapshot(): ExportSnapshotResponse {
  return {
    exportRequestId: EXPORT_REQUEST_ID,
    state: 'running',
    scope: 'account',
    includeMedia: true,
    formatVersion: '1',
    boundaryAt: '2026-07-25T09:00:00.000Z',
    packageTarget: { bucketName: BUCKET, objectKey: PACKAGE_KEY },
    stagingObjectKeyPrefix: STAGING_PREFIX,
    checkpoints: [],
    sections: [
      {
        entryPath: 'export.json',
        disposition: 'package',
        contentType: 'application/json',
        content: '{"formatVersion":"1"}\n',
      },
      {
        entryPath: 'gardens/garden-1/plants.csv',
        disposition: 'package',
        contentType: 'text/csv',
        content: 'id,displayName\r\nplant-1,Rose\r\n',
      },
      {
        entryPath: EXPORT_MEDIA_TRANSFER_ENTRY_PATH,
        disposition: 'transfer',
        contentType: 'application/json',
        content: TRANSFER_CONTENT,
      },
    ],
  };
}

function checkpointFor(entryPath: string, content: string, disposition: 'package' | 'transfer') {
  const buffer = Buffer.from(content, 'utf8');
  return {
    entryPath,
    disposition,
    bucketName: BUCKET,
    objectKey: `${STAGING_PREFIX}${entryPath}`,
    contentType: 'application/json',
    checksumSha256: sha256(buffer),
    byteSize: buffer.length,
  } satisfies ExportSectionCheckpoint;
}

function resumeSnapshot(): ExportSnapshotResponse {
  return {
    ...firstAttemptSnapshot(),
    boundaryAt: '2026-07-25T09:00:00.000Z',
    sections: [],
    checkpoints: [
      checkpointFor('export.json', '{"formatVersion":"1"}\n', 'package'),
      checkpointFor(EXPORT_MEDIA_TRANSFER_ENTRY_PATH, TRANSFER_CONTENT, 'transfer'),
    ],
  };
}

function build() {
  const api = new FakeExportApiClient();
  const objects = new FakeExportObjectStore();
  objects.seed(MEDIA_BUCKET, MEDIA_KEY, MEDIA_CONTENT);
  const job = new ProcessExportGenerationJob(api, objects, silentLogger());
  return { api, objects, job };
}

describe('ProcessExportGenerationJob', () => {
  it('stages every section, records checkpoints with the boundary, assembles the ZIP, and records completion', async () => {
    const { api, objects, job } = build();
    api.snapshots = [firstAttemptSnapshot()];

    await job.execute(MANIFEST);

    // Staged objects exist under the staging prefix, transfer included.
    expect(objects.objects.has(`${BUCKET}/${STAGING_PREFIX}export.json`)).toBe(true);
    expect(
      objects.objects.has(`${BUCKET}/${STAGING_PREFIX}${EXPORT_MEDIA_TRANSFER_ENTRY_PATH}`),
    ).toBe(true);

    // One checkpoint call carrying ALL sections and the snapshot's boundary.
    expect(api.checkpointCalls).toHaveLength(1);
    expect(api.checkpointCalls[0]?.body.boundaryAt).toBe('2026-07-25T09:00:00.000Z');
    expect(
      api.checkpointCalls[0]?.body.sections.map((section) => section.entryPath).sort(),
    ).toEqual(
      ['export.json', 'gardens/garden-1/plants.csv', EXPORT_MEDIA_TRANSFER_ENTRY_PATH].sort(),
    );

    // The package: sections + media + missing-media + checksums, and the
    // transfer manifest NEVER inside it.
    const zipContent = objects.objects.get(`${BUCKET}/${PACKAGE_KEY}`);
    expect(zipContent).toBeDefined();
    const entries = await readZipEntries(zipContent as Buffer);
    expect([...entries.keys()].sort()).toEqual(
      [
        'export.json',
        'gardens/garden-1/plants.csv',
        MEDIA_ENTRY_PATH,
        'missing-media.json',
        'checksums.txt',
      ].sort(),
    );
    expect(entries.has(EXPORT_MEDIA_TRANSFER_ENTRY_PATH)).toBe(false);
    expect(entries.get(MEDIA_ENTRY_PATH)?.equals(MEDIA_CONTENT)).toBe(true);

    // checksums.txt covers every other entry with correct digests.
    const checksumLines = (entries.get('checksums.txt') as Buffer)
      .toString('utf8')
      .trim()
      .split('\n');
    expect(checksumLines).toHaveLength(4);
    for (const line of checksumLines) {
      const [digest, path] = line.split(/\s{2}/u);
      expect(sha256(entries.get(path as string) as Buffer)).toBe(digest);
    }

    // Completion carries the ZIP's own figures.
    expect(api.completionCalls).toHaveLength(1);
    const completion = api.completionCalls[0]?.body;
    expect(completion?.outcome).toBe('succeeded');
    expect(completion?.package?.objectKey).toBe(PACKAGE_KEY);
    expect(completion?.package?.checksumSha256).toBe(sha256(zipContent as Buffer));
    expect(completion?.package?.byteSize).toBe((zipContent as Buffer).length);
    expect(completion?.package?.mediaFileCount).toBe(1);
    expect(completion?.package?.missingMediaCount).toBe(0);
  });

  it('a retried attempt with recorded checkpoints resumes: no re-staging, no second checkpoint call, assembly from the staged bytes', async () => {
    const { api, objects, job } = build();
    const snapshot = resumeSnapshot();
    api.snapshots = [snapshot];
    for (const checkpoint of snapshot.checkpoints) {
      const content =
        checkpoint.entryPath === EXPORT_MEDIA_TRANSFER_ENTRY_PATH
          ? TRANSFER_CONTENT
          : '{"formatVersion":"1"}\n';
      objects.seed(checkpoint.bucketName, checkpoint.objectKey, Buffer.from(content, 'utf8'));
    }

    await job.execute(MANIFEST);

    expect(api.checkpointCalls).toHaveLength(0);
    expect(api.completionCalls).toHaveLength(1);
    const entries = await readZipEntries(objects.objects.get(`${BUCKET}/${PACKAGE_KEY}`) as Buffer);
    expect(entries.get('export.json')?.toString('utf8')).toBe('{"formatVersion":"1"}\n');
  });

  it('media deleted between boundary and assembly is LISTED in missing-media.json, never silently omitted', async () => {
    const { api, objects, job } = build();
    api.snapshots = [firstAttemptSnapshot()];
    objects.delete(MEDIA_BUCKET, MEDIA_KEY);

    await job.execute(MANIFEST);

    const entries = await readZipEntries(objects.objects.get(`${BUCKET}/${PACKAGE_KEY}`) as Buffer);
    expect(entries.has(MEDIA_ENTRY_PATH)).toBe(false);
    const missing = JSON.parse((entries.get('missing-media.json') as Buffer).toString('utf8')) as {
      missing: { mediaId: string; reason: string }[];
    };
    expect(missing.missing).toEqual([
      { mediaId: 'media-1', entryPath: MEDIA_ENTRY_PATH, reason: 'object_missing' },
    ]);
    expect(api.completionCalls[0]?.body.package?.missingMediaCount).toBe(1);
    expect(api.completionCalls[0]?.body.package?.mediaFileCount).toBe(0);
  });

  it('a redelivered task against an already-terminal request is a no-op', async () => {
    const { api, objects, job } = build();
    api.snapshots = [{ ...resumeSnapshot(), state: 'completed', checkpoints: [], sections: [] }];

    await job.execute(MANIFEST);

    expect(api.checkpointCalls).toHaveLength(0);
    expect(api.completionCalls).toHaveLength(0);
    expect(objects.objects.has(`${BUCKET}/${PACKAGE_KEY}`)).toBe(false);
  });

  it('a staged section that no longer hashes to its checkpoint fails TERMINALLY — a retry cannot repair storage damage', async () => {
    const { api, objects, job } = build();
    const snapshot = resumeSnapshot();
    api.snapshots = [snapshot];
    for (const checkpoint of snapshot.checkpoints) {
      objects.seed(checkpoint.bucketName, checkpoint.objectKey, Buffer.from('tampered', 'utf8'));
    }

    await job.execute(MANIFEST);

    expect(api.completionCalls).toHaveLength(1);
    expect(api.completionCalls[0]?.body).toEqual({
      outcome: 'failed_terminal',
      failureCode: 'staged_section_corrupt',
    });
    expect(objects.objects.has(`${BUCKET}/${PACKAGE_KEY}`)).toBe(false);
  });

  it('a ZIP sink failure propagates as a retryable throw without recording any completion', async () => {
    const { api, objects, job } = build();
    api.snapshots = [firstAttemptSnapshot()];
    objects.failNextZipWrite = new Error('stream lost');

    await expect(job.execute(MANIFEST)).rejects.toThrow('stream lost');
    expect(api.completionCalls).toHaveLength(0);
  });
});
