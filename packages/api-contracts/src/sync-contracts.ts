/**
 * Error codes the synchronization endpoints raise at the whole-request
 * level (`PushSyncOperations`, `GetSyncChanges`, `RegisterSyncClient`), as
 * opposed to a per-operation `SyncRejectedOperationResult.error.code`,
 * which is module-specific and not enumerated here.
 *
 * Split out of `index.ts` purely for the repository's 600-line source-file
 * rule, the same "hand-written material grew past the limit" posture
 * `organizations.ts`/`client-portal.ts` document for themselves; `index.ts`
 * re-exports everything here unchanged.
 */
export const SyncErrorCode = {
  /** `protocolVersion` is outside the server's currently supported window. Does not imply the client's local outbox was lost. */
  ProtocolVersionUnsupported: 'sync.protocol_version.unsupported',
  /** `after` is older than the server's retained change history; a full resynchronization is required. */
  CursorExpired: 'sync.changes.cursor_expired',
} as const;

export type SyncErrorCode = (typeof SyncErrorCode)[keyof typeof SyncErrorCode];
