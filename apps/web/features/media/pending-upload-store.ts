/**
 * Port for the client-side "recoverable browser metadata" architecture doc
 * section "12. Media Upload" asks for: enough locally-persisted state that
 * an interrupted upload can be found again — and, when its session has not
 * expired, resumed from its real server-confirmed offset — after a pause,
 * a browser crash, or an ordinary page reload.
 *
 * Real IndexedDB is used here, not `core/drafts`' existing
 * `localStorage`-backed draft store: `local-draft-store.ts`'s own doc
 * comment already reserves IndexedDB for exactly this future case ("the
 * right choice for a future, larger concern this work package does not
 * build... Large imports preserve local recovery metadata when browser
 * capabilities allow it"). A pending upload's record includes the file's
 * own `Blob` — up to 50 MiB for an imported plan (media-storage-and-
 * processing.md section 8.1) — which is what actually makes a resume after
 * RELOAD possible: the resumable session URI and a remembered byte offset
 * are useless without the original bytes to resume sending, and a `File`
 * object cannot survive a reload on its own (the browser does not let a
 * page reconstruct one from a past selection). `localStorage`'s string-only,
 * synchronous, low-capacity design cannot hold this; IndexedDB's asynchronous,
 * larger-capacity, structured/binary storage is the correct fit, matching
 * what that comment already anticipated needing one day.
 *
 * Behind a port, with a real IndexedDB adapter
 * (`indexed-db-pending-upload-store.ts`) and fakeable in tests, the same
 * port-plus-adapter-plus-fake pattern this codebase's server-side storage
 * gateways already use (see `services/api/.../media-storage-gateway.ts` and
 * its `FakeMediaStorageGateway` test double).
 *
 * Source: architecture/web-application-design.md, sections "6. State
 * Ownership" ("Recoverable drafts | IndexedDB or local storage adapter with
 * explicit schema"), "12. Media Upload"; implementation-plan.md work
 * package P6-WEB-01.
 */

import type { MediaClass } from '@verdery/api-contracts';

export interface PendingUploadRecord {
  readonly mediaId: string;
  readonly gardenId: string;
  readonly mediaClass: MediaClass;
  readonly displayFilename: string;
  readonly declaredContentType: string;
  readonly declaredByteSize: number;
  readonly uploadUrl: string;
  /** ISO timestamp. Resumability is only offered while this is still in the future — see `use-media-upload.ts`. */
  readonly uploadUrlExpiresAt: string;
  /**
   * The offset last confirmed by a real Cloud Storage response, kept only as
   * a display hint before a resume's own reconciling status check
   * (`checkResumableUploadStatus`) returns the authoritative value — never
   * trusted on its own to decide what to send next.
   */
  readonly confirmedOffsetBytes: number;
  readonly savedAt: string;
  readonly file: Blob;
}

export interface PendingUploadStore {
  put(record: PendingUploadRecord): Promise<void>;
  get(mediaId: string): Promise<PendingUploadRecord | null>;
  updateOffset(mediaId: string, confirmedOffsetBytes: number): Promise<void>;
  delete(mediaId: string): Promise<void>;
  /** Every pending record for one garden — used to offer "resume an interrupted upload" on mount. */
  listByGarden(gardenId: string): Promise<readonly PendingUploadRecord[]>;
}
