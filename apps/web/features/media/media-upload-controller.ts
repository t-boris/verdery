/**
 * Framework-independent state machine driving one media upload end to end:
 * `RegisterMediaUpload` → direct resumable Cloud Storage upload (with real
 * pause/resume/retry) → `CompleteMediaUpload` → status polling until a
 * terminal `processingState`. `use-media-upload.ts` is the thin React
 * adapter over this; every branch of the actual logic is tested here
 * directly, with no React involved, against fake `MediaGateway`,
 * `ResumableTransport`, and `PendingUploadStore` implementations.
 *
 * Mirrors this codebase's "Media feature store backed by server upload
 * records" state-ownership entry (architecture doc section "6. State
 * Ownership") and section "12. Media Upload"'s "persists recoverable
 * metadata... where browser storage and security policy permit it."
 *
 * Source: architecture/media-storage-and-processing.md, sections "6. Upload
 * State Machine", "7. Upload Flow"; implementation-plan.md work package
 * P6-WEB-01.
 */

import type { Media, MediaClass } from '@verdery/api-contracts';

import type { ApiFailure } from '@/core/api/public';
import { isFailure, type MediaGateway } from '@/core/api/public';

import type { ResumableTransport } from './gcs-resumable-transport';
import { computeSha256Hex } from './media-checksum';
import type { PendingUploadRecord, PendingUploadStore } from './pending-upload-store';
import { uploadResumableFile } from './resumable-upload-driver';

export type MediaUploadPhase =
  | 'idle'
  | 'recoverable'
  | 'registering'
  | 'uploading'
  | 'paused'
  | 'completing'
  | 'processing'
  | 'processed'
  | 'rejected'
  | 'processingFailed'
  | 'sessionExpired'
  | 'uploadFailed'
  | 'apiFailed';

/** Closed set of client-only upload failures — never a server error code, so never routed through `errorMessageKey`. */
export type MediaUploadFailureReason = 'networkError' | 'unexpectedStatus';

export interface MediaUploadState {
  readonly phase: MediaUploadPhase;
  readonly displayFilename: string | null;
  readonly totalBytes: number;
  readonly uploadedBytes: number;
  readonly mediaId: string | null;
  readonly media: Media | null;
  /** The SHA-256 this upload registered under, or `null` when the platform would not hash. Lets a caller ask whether the same bytes are already in this garden. */
  readonly checksumSha256: string | null;
  readonly retryable: boolean;
  readonly uploadFailureReason: MediaUploadFailureReason | null;
  readonly apiFailure: ApiFailure | null;
  /** Set only while `phase === 'processing'` and the most recent background poll failed — never blocks the "still processing" view. */
  readonly pollFailure: ApiFailure | null;
}

const IDLE_STATE: MediaUploadState = {
  phase: 'idle',
  displayFilename: null,
  totalBytes: 0,
  uploadedBytes: 0,
  mediaId: null,
  media: null,
  checksumSha256: null,
  retryable: false,
  uploadFailureReason: null,
  apiFailure: null,
  pollFailure: null,
};

export interface MediaUploadControllerDependencies {
  readonly gardenId: string;
  readonly mediaClass: MediaClass;
  readonly mediaGateway: MediaGateway;
  readonly transport: ResumableTransport;
  /** `null` when `indexedDB` is unavailable — resumability across a reload is silently unavailable, never a crash. */
  readonly store: PendingUploadStore | null;
  readonly generateIdempotencyKey: () => string;
  readonly now: () => Date;
  readonly pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;

type FailedStep = 'register' | 'complete' | null;

/** What a (re-)registration needs, independent of whether it came from a fresh `File` pick or a recovered record. */
interface RegistrationSource {
  readonly file: Blob;
  readonly displayFilename: string;
  readonly declaredContentType: string;
}

function registrationSourceFromFile(file: File): RegistrationSource {
  return {
    file,
    displayFilename: file.name,
    declaredContentType: file.type === '' ? 'application/octet-stream' : file.type,
  };
}

/**
 * Creates one controller instance, scoped to one `gardenId` + `mediaClass`
 * pairing (a fresh instance per upload widget). `subscribe`/`getState`
 * match the shape `useSyncExternalStore` expects, the same external-store
 * pattern `core/connectivity/network-status.ts` already uses for
 * `onlineManager` — no new state-management dependency introduced for this
 * one controller.
 */
export function createMediaUploadController(deps: MediaUploadControllerDependencies) {
  let state: MediaUploadState = IDLE_STATE;
  const listeners = new Set<() => void>();

  let activeAbortController: AbortController | null = null;
  let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  let currentSource: RegistrationSource | null = null;
  let currentUploadUrl: string | null = null;
  let failedStep: FailedStep = null;
  let recoveredRecord: PendingUploadRecord | null = null;

  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  function setState(patch: Partial<MediaUploadState>): void {
    state = { ...state, ...patch };
    if (!disposed) {
      listeners.forEach((listener) => listener());
    }
  }

  function clearPollTimer(): void {
    if (pollTimeoutId !== null) {
      clearTimeout(pollTimeoutId);
      pollTimeoutId = null;
    }
  }

  /** Terminal `processingState`/`uploadState` combinations this controller recognizes. See section 6's state machine. */
  function phaseAfterAvailable(media: Media): MediaUploadPhase {
    if (media.uploadState === 'rejected') {
      return 'rejected';
    }
    if (media.processingState === 'processed') {
      return 'processed';
    }
    if (media.processingState === 'processing_failed') {
      return 'processingFailed';
    }
    return 'processing';
  }

  function schedulePoll(mediaId: string): void {
    clearPollTimer();
    pollTimeoutId = setTimeout(() => {
      void pollOnce(mediaId);
    }, pollIntervalMs);
  }

  async function pollOnce(mediaId: string): Promise<void> {
    const result = await deps.mediaGateway.getStatus(deps.gardenId, mediaId);
    if (disposed) {
      return;
    }
    if (isFailure(result)) {
      // A background poll failure never replaces the "still processing"
      // view — the same "existing state stays visible" rule
      // `isConnectivityFailure`/`StaleIndicator` apply elsewhere in this
      // codebase, applied here to a poll instead of a query.
      setState({ pollFailure: result });
      schedulePoll(mediaId);
      return;
    }
    const media = result.data;
    const phase = phaseAfterAvailable(media);
    setState({ media, phase, pollFailure: null });
    if (phase === 'processing') {
      schedulePoll(mediaId);
    }
  }

  async function finishUpload(mediaId: string, expectedRevision: number): Promise<void> {
    setState({ phase: 'completing' });
    failedStep = 'complete';

    const result = await deps.mediaGateway.complete(
      deps.gardenId,
      mediaId,
      expectedRevision,
      deps.generateIdempotencyKey(),
    );
    if (disposed) {
      return;
    }
    if (isFailure(result)) {
      setState({ phase: 'apiFailed', apiFailure: result });
      return;
    }

    failedStep = null;
    if (deps.store !== null) {
      await deps.store.delete(mediaId).catch(() => undefined);
    }

    const media = result.data;
    const phase = phaseAfterAvailable(media);
    setState({ media, phase, apiFailure: null });
    if (phase === 'processing') {
      schedulePoll(mediaId);
    }
  }

  async function runUpload(
    file: Blob,
    uploadUrl: string,
    totalBytes: number,
    mediaId: string,
    expectedRevision: number,
  ): Promise<void> {
    currentUploadUrl = uploadUrl;
    const controller = new AbortController();
    activeAbortController = controller;

    setState({ phase: 'uploading', totalBytes, uploadFailureReason: null, retryable: false });

    const result = await uploadResumableFile({
      transport: deps.transport,
      uploadUrl,
      file,
      totalBytes,
      onProgress: (progress) => {
        if (!disposed) {
          setState({ uploadedBytes: progress.uploadedBytes });
        }
      },
      signal: controller.signal,
    });
    if (disposed) {
      return;
    }
    activeAbortController = null;

    if (result.kind === 'complete') {
      if (deps.store !== null) {
        await deps.store.updateOffset(mediaId, totalBytes).catch(() => undefined);
      }
      await finishUpload(mediaId, expectedRevision);
      return;
    }
    if (result.kind === 'paused') {
      setState({ phase: 'paused', uploadedBytes: result.uploadedBytes });
      if (deps.store !== null) {
        await deps.store.updateOffset(mediaId, result.uploadedBytes).catch(() => undefined);
      }
      return;
    }
    if (result.kind === 'sessionExpired') {
      if (deps.store !== null) {
        await deps.store.delete(mediaId).catch(() => undefined);
      }
      setState({ phase: 'sessionExpired' });
      return;
    }
    setState({
      phase: 'uploadFailed',
      uploadedBytes: result.uploadedBytes,
      retryable: result.retryable,
      // `retryable` (from `uploadResumableFile`) is `true` for a transport
      // failure or a stalled-chunk giveup (worth an automatic retry) and
      // `false` for an HTTP status this client does not know how to
      // interpret (see `resumable-upload-driver.ts`) — the same distinction
      // this reason carries for the UI's own wording.
      uploadFailureReason: result.retryable ? 'networkError' : 'unexpectedStatus',
    });
    if (deps.store !== null) {
      await deps.store.updateOffset(mediaId, result.uploadedBytes).catch(() => undefined);
    }
  }

  /** Registers a fresh upload session, persists recoverable metadata, and starts sending bytes. */
  async function beginFreshUpload(source: RegistrationSource): Promise<void> {
    setState({
      ...IDLE_STATE,
      phase: 'registering',
      displayFilename: source.displayFilename,
      totalBytes: source.file.size,
    });
    failedStep = 'register';
    recoveredRecord = null;
    currentSource = source;

    // After the phase is already on screen, not before: hashing a 50 MB photo
    // is not instant, and a picker that looks idle while it runs reads as a
    // pick that did not register.
    const checksumSha256 = await computeSha256Hex(source.file);
    if (disposed) {
      return;
    }
    setState({ checksumSha256 });

    const result = await deps.mediaGateway.register(
      deps.gardenId,
      {
        mediaClass: deps.mediaClass,
        displayFilename: source.displayFilename,
        declaredContentType: source.declaredContentType,
        declaredByteSize: source.file.size,
        // Omitted rather than sent as null: the contract's own "supplied when
        // available" wording, and `additionalProperties: false` makes an
        // explicit null a rejected request rather than an absent value.
        ...(checksumSha256 === null ? {} : { checksumSha256 }),
      },
      deps.generateIdempotencyKey(),
    );
    if (disposed) {
      return;
    }
    if (isFailure(result)) {
      setState({ phase: 'apiFailed', apiFailure: result });
      return;
    }

    failedStep = null;
    const { media, uploadUrl, uploadUrlExpiresAt } = result.data;
    setState({ mediaId: media.id, media });

    if (deps.store !== null) {
      const record: PendingUploadRecord = {
        mediaId: media.id,
        gardenId: deps.gardenId,
        mediaClass: deps.mediaClass,
        displayFilename: source.displayFilename,
        declaredContentType: source.declaredContentType,
        declaredByteSize: source.file.size,
        uploadUrl,
        // The real server-issued expiry is what governs resumability.
        uploadUrlExpiresAt,
        confirmedOffsetBytes: 0,
        savedAt: deps.now().toISOString(),
        file: source.file,
      };
      await deps.store.put(record).catch(() => undefined);
    }

    await runUpload(source.file, uploadUrl, source.file.size, media.id, media.revision);
  }

  return {
    getState(): MediaUploadState {
      return state;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Called once, on mount: looks for an unexpired pending upload for this garden. Never starts network activity on its own. */
    async checkForRecoverableUpload(): Promise<void> {
      const store = deps.store;
      if (store === null) {
        return;
      }
      const records = await store.listByGarden(deps.gardenId).catch(() => []);
      const nowMs = deps.now().getTime();

      const usable = records.filter(
        (record) => new Date(record.uploadUrlExpiresAt).getTime() > nowMs,
      );
      const expired = records.filter(
        (record) => new Date(record.uploadUrlExpiresAt).getTime() <= nowMs,
      );
      await Promise.all(
        expired.map((record) => store.delete(record.mediaId).catch(() => undefined)),
      );

      if (usable.length === 0 || disposed) {
        return;
      }
      const [mostRecent] = [...usable].sort((left, right) =>
        right.savedAt.localeCompare(left.savedAt),
      );
      if (mostRecent === undefined) {
        return;
      }
      recoveredRecord = mostRecent;
      setState({
        phase: 'recoverable',
        displayFilename: mostRecent.displayFilename,
        totalBytes: mostRecent.declaredByteSize,
        uploadedBytes: mostRecent.confirmedOffsetBytes,
        mediaId: mostRecent.mediaId,
      });
    },

    async startUpload(file: File): Promise<void> {
      if (
        state.phase === 'registering' ||
        state.phase === 'uploading' ||
        state.phase === 'completing'
      ) {
        return;
      }
      await beginFreshUpload(registrationSourceFromFile(file));
    },

    pause(): void {
      activeAbortController?.abort();
    },

    /** Resumes the record `checkForRecoverableUpload` found, after reconciling its current server-side state. */
    async resumeRecovered(): Promise<void> {
      const record = recoveredRecord;
      if (record === null) {
        return;
      }
      setState({ phase: 'registering' });

      const statusResult = await deps.mediaGateway.getStatus(deps.gardenId, record.mediaId);
      if (disposed) {
        return;
      }
      if (isFailure(statusResult)) {
        setState({ phase: 'apiFailed', apiFailure: statusResult });
        return;
      }
      const media = statusResult.data;
      if (media.uploadState !== 'authorized') {
        // Already resolved by a previous attempt (or expired/rejected
        // server-side since this record was saved) — nothing left to
        // resume; the record is stale.
        if (deps.store !== null) {
          await deps.store.delete(record.mediaId).catch(() => undefined);
        }
        setState({ ...IDLE_STATE });
        return;
      }

      currentSource = {
        file: record.file,
        displayFilename: record.displayFilename,
        declaredContentType: record.declaredContentType,
      };
      setState({ media, mediaId: record.mediaId });
      await runUpload(
        record.file,
        record.uploadUrl,
        record.declaredByteSize,
        record.mediaId,
        media.revision,
      );
    },

    async discardRecovered(): Promise<void> {
      const record = recoveredRecord;
      recoveredRecord = null;
      if (record !== null && deps.store !== null) {
        await deps.store.delete(record.mediaId).catch(() => undefined);
      }
      setState({ ...IDLE_STATE });
    },

    async retry(): Promise<void> {
      if (state.phase === 'paused' || state.phase === 'uploadFailed') {
        if (
          currentUploadUrl === null ||
          currentSource === null ||
          state.mediaId === null ||
          state.media === null
        ) {
          return;
        }
        await runUpload(
          currentSource.file,
          currentUploadUrl,
          state.totalBytes,
          state.mediaId,
          state.media.revision,
        );
        return;
      }
      if (state.phase === 'sessionExpired' && currentSource !== null) {
        await beginFreshUpload(currentSource);
        return;
      }
      if (state.phase === 'apiFailed') {
        if (failedStep === 'complete' && state.mediaId !== null && state.media !== null) {
          await finishUpload(state.mediaId, state.media.revision);
          return;
        }
        if (failedStep === 'register' && currentSource !== null) {
          await beginFreshUpload(currentSource);
        }
      }
    },

    async cancel(): Promise<void> {
      activeAbortController?.abort();
      clearPollTimer();
      const mediaId = state.mediaId ?? recoveredRecord?.mediaId ?? null;
      recoveredRecord = null;
      if (mediaId !== null && deps.store !== null) {
        await deps.store.delete(mediaId).catch(() => undefined);
      }
      setState({ ...IDLE_STATE });
    },

    dispose(): void {
      disposed = true;
      clearPollTimer();
      activeAbortController?.abort();
      listeners.clear();
    },
  };
}

export type MediaUploadController = ReturnType<typeof createMediaUploadController>;
