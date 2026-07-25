/**
 * The `export_generation` job (P8-EXPORT-01): the worker half of the
 * checkpointed export pipeline, per delivered manifest —
 *
 * 1. SNAPSHOT: `fetchSnapshot` — the API either serves the full structured
 *    section set (first attempt) or only the recorded checkpoints (a
 *    retried attempt resumes; the snapshot is never re-read once
 *    checkpointed). A terminal request state is an honest no-op: Cloud
 *    Tasks redelivery after completion converges here.
 * 2. STAGE + CHECKPOINT: each returned section is written to the exports
 *    bucket under the request's staging prefix, then ALL staged sections
 *    are recorded in one checkpoint call with the boundary — atomic, so
 *    the recorded set is always one snapshot's.
 * 3. ASSEMBLE: staged `package` sections (verified against their recorded
 *    checksums), entitled media originals (streamed from their buckets;
 *    ones deleted since the boundary are LISTED in `missing-media.json`,
 *    never silently omitted — section 7), `missing-media.json`, and
 *    `checksums.txt` are streamed into the final ZIP at the pre-computed
 *    package target, hashed and counted as written.
 * 4. COMPLETE: `recordCompletion` — the API registers the media record,
 *    completes the request, and emits the notification event, atomically.
 *
 * FAILURE POSTURE: any thrown error propagates to the HTTP server's 503 →
 *    Cloud Tasks retries → this job resumes at step 1 (checkpoints make
 *    the retry skip the snapshot; ZIP assembly restarts and overwrites the
 *    same target object — per-media-file resume inside one assembly pass
 *    is a recorded deferred capability, not silently absent). A staged
 *    section whose bytes no longer match its checkpoint is TERMINAL
 *    (`failed_terminal`, a stable failure code): retrying cannot repair
 *    storage-level corruption, and a failed export never exposes a partial
 *    package.
 *
 * Staged objects are left for the exports bucket's own 7-day lifecycle
 * rule — a completed package's staging is dead weight for at most the
 * window the bucket already enforces, and deleting eagerly would add a
 * failure mode after the completion call for zero privacy gain (the
 * staging prefix is as private as the package itself).
 */

import { createHash } from 'node:crypto';
import type {
  ExportGenerationManifest,
  ExportMediaTransferManifest,
  ExportSectionCheckpoint,
  ExportSnapshotResponse,
} from '@verdery/api-contracts';
import { EXPORT_MEDIA_TRANSFER_ENTRY_PATH } from '@verdery/api-contracts';
import type { Logger } from '../logger.js';
import type { ExportApiClient } from './export-api-client.js';
import type { ExportObjectStore } from './export-object-store.js';
import { ZipPackageWriter, type FinalizedZipPackage } from './zip-package-writer.js';

const ZIP_CONTENT_TYPE = 'application/zip';

const TERMINAL_STATES: readonly string[] = ['completed', 'failed'];

/** Raised for conditions a retry cannot repair; reported as `failed_terminal` with this stable code. */
class TerminalExportError extends Error {
  constructor(
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'TerminalExportError';
  }
}

interface MissingMediaEntry {
  readonly mediaId: string;
  readonly entryPath: string;
  readonly reason: 'object_missing';
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export class ProcessExportGenerationJob {
  constructor(
    private readonly api: ExportApiClient,
    private readonly objects: ExportObjectStore,
    private readonly logger: Logger,
  ) {}

  async execute(manifest: ExportGenerationManifest): Promise<void> {
    const snapshot = await this.api.fetchSnapshot(manifest.exportRequestId);

    if (TERMINAL_STATES.includes(snapshot.state)) {
      this.logger.info(
        {
          event: 'export_generation.already_terminal',
          exportRequestId: manifest.exportRequestId,
          state: snapshot.state,
        },
        'Export request already terminal; redelivered task is a no-op',
      );
      return;
    }

    try {
      const checkpoints =
        snapshot.sections.length > 0
          ? await this.stageAndCheckpoint(snapshot)
          : [...snapshot.checkpoints];

      await this.assembleAndComplete(snapshot, checkpoints);
    } catch (error) {
      if (error instanceof TerminalExportError) {
        await this.api.recordCompletion(snapshot.exportRequestId, {
          outcome: 'failed_terminal',
          failureCode: error.failureCode,
        });
        this.logger.error(
          {
            err: error,
            event: 'export_generation.failed_terminal',
            exportRequestId: snapshot.exportRequestId,
            failureCode: error.failureCode,
          },
          'Export generation failed terminally',
        );
        return;
      }
      throw error;
    }
  }

  /** Stages every returned section and records the whole set with its boundary — step 2. */
  private async stageAndCheckpoint(
    snapshot: ExportSnapshotResponse,
  ): Promise<ExportSectionCheckpoint[]> {
    const bucketName = snapshot.packageTarget.bucketName;
    const staged: ExportSectionCheckpoint[] = [];

    for (const section of snapshot.sections) {
      const objectKey = `${snapshot.stagingObjectKeyPrefix}${section.entryPath}`;
      const stored = await this.objects.write(
        bucketName,
        objectKey,
        Buffer.from(section.content, 'utf8'),
        section.contentType,
      );
      staged.push({
        entryPath: section.entryPath,
        disposition: section.disposition,
        bucketName: stored.bucketName,
        objectKey: stored.objectKey,
        contentType: section.contentType,
        checksumSha256: stored.checksumSha256,
        byteSize: stored.byteSize,
      });
    }

    // `boundaryAt` is non-null exactly when sections were served — the
    // contract's own pairing; a violation is a defect between trusted
    // components, surfaced loudly.
    if (snapshot.boundaryAt === null) {
      throw new Error('The snapshot served sections without a boundary.');
    }
    await this.api.recordCheckpoints(snapshot.exportRequestId, {
      boundaryAt: snapshot.boundaryAt,
      sections: staged,
    });

    return staged;
  }

  /** Streams sections and media into the final ZIP and records completion — steps 3-4. */
  private async assembleAndComplete(
    snapshot: ExportSnapshotResponse,
    checkpoints: readonly ExportSectionCheckpoint[],
  ): Promise<void> {
    const checksumLines: string[] = [];
    const missing: MissingMediaEntry[] = [];

    const sink = this.objects.openWriteStream(
      snapshot.packageTarget.bucketName,
      snapshot.packageTarget.objectKey,
      ZIP_CONTENT_TYPE,
    );
    const zip = new ZipPackageWriter(sink.writable);

    for (const checkpoint of checkpoints) {
      if (checkpoint.disposition !== 'package') {
        continue;
      }
      const content = await this.readVerifiedSection(checkpoint);
      zip.addEntry(checkpoint.entryPath, content);
      checksumLines.push(`${checkpoint.checksumSha256}  ${checkpoint.entryPath}`);
    }

    const transfer = await this.readTransferManifest(snapshot, checkpoints);
    let mediaFileCount = 0;
    for (const file of transfer.files) {
      const content = await this.objects.read(file.bucketName, file.objectKey);
      if (content === null) {
        missing.push({
          mediaId: file.mediaId,
          entryPath: file.entryPath,
          reason: 'object_missing',
        });
        continue;
      }
      zip.addEntry(file.entryPath, content);
      checksumLines.push(`${sha256(content)}  ${file.entryPath}`);
      mediaFileCount += 1;
    }

    const missingContent = Buffer.from(`${JSON.stringify({ missing }, null, 2)}\n`, 'utf8');
    zip.addEntry('missing-media.json', missingContent);
    checksumLines.push(`${sha256(missingContent)}  missing-media.json`);

    // Last, covering every other entry (it cannot cover itself).
    zip.addEntry('checksums.txt', Buffer.from(`${checksumLines.join('\n')}\n`, 'utf8'));

    // Settled pair, not sequential awaits — on a sink failure both promises
    // reject and the second would otherwise go unhandled (the
    // `ZipPackageWriter.finalize` reasoning, applied to the store's own
    // completion promise).
    const settled = await Promise.allSettled([zip.finalize(), sink.whenStored()]);
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (rejected !== undefined) {
      throw rejected.reason;
    }
    const finalized = (settled[0] as PromiseFulfilledResult<FinalizedZipPackage>).value;

    await this.api.recordCompletion(snapshot.exportRequestId, {
      outcome: 'succeeded',
      package: {
        bucketName: snapshot.packageTarget.bucketName,
        objectKey: snapshot.packageTarget.objectKey,
        contentType: ZIP_CONTENT_TYPE,
        byteSize: finalized.byteSize,
        checksumSha256: finalized.checksumSha256,
        mediaFileCount,
        missingMediaCount: missing.length,
      },
    });

    this.logger.info(
      {
        event: 'export_generation.package_completed',
        exportRequestId: snapshot.exportRequestId,
        packageByteSize: finalized.byteSize,
        sectionCount: checkpoints.length,
        mediaFileCount,
        missingMediaCount: missing.length,
      },
      'Export package assembled and completion recorded',
    );
  }

  /** A staged section must still exist and still hash to its recorded checksum — anything else is storage-level damage a retry cannot repair. */
  private async readVerifiedSection(checkpoint: ExportSectionCheckpoint): Promise<Buffer> {
    const content = await this.objects.read(checkpoint.bucketName, checkpoint.objectKey);
    if (content === null) {
      throw new TerminalExportError(
        'staged_section_missing',
        `Staged section '${checkpoint.entryPath}' no longer exists.`,
      );
    }
    if (sha256(content) !== checkpoint.checksumSha256) {
      throw new TerminalExportError(
        'staged_section_corrupt',
        `Staged section '${checkpoint.entryPath}' does not match its recorded checksum.`,
      );
    }
    return content;
  }

  private async readTransferManifest(
    snapshot: ExportSnapshotResponse,
    checkpoints: readonly ExportSectionCheckpoint[],
  ): Promise<ExportMediaTransferManifest> {
    const transferCheckpoint = checkpoints.find(
      (checkpoint) => checkpoint.entryPath === EXPORT_MEDIA_TRANSFER_ENTRY_PATH,
    );
    if (transferCheckpoint === undefined) {
      throw new TerminalExportError(
        'transfer_manifest_missing',
        `No '${EXPORT_MEDIA_TRANSFER_ENTRY_PATH}' checkpoint exists for export ${snapshot.exportRequestId}.`,
      );
    }
    const content = await this.readVerifiedSection(transferCheckpoint);
    return JSON.parse(content.toString('utf8')) as ExportMediaTransferManifest;
  }
}
