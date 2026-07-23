import Foundation

/// A mechanical edit of one outbox operation's own payload text, shared by
/// every feature's `CoreSynchronization.SyncConflictReplayableApplier
/// .reapplyDraft(original:newExpectedRevision:)` (P5-CONFLICT-01) — not a
/// violation of `OutboxOperation.payload`'s own "opaque to `CorePersistence`
/// and `CoreSynchronization` alike" doc comment: neither of those two layers
/// ever calls this. Only a feature's own applier does, on its own payload,
/// which that doc comment's own carve-out already permits ("only the feature
/// that created it ... [may reshape it]"). This lives in `CoreDomain` rather
/// than being copy-pasted once per feature because the shape it depends on —
/// `{"recordType": ..., "gardenId": ..., "command": {..., "expectedRevision":
/// N, ...}}` — is not feature domain content at all, but the sync WIRE
/// ENVELOPE convention every `Sync*OperationPayload` in `FeatureGardens`/
/// `FeatureMap`/`FeaturePlants`/`FeatureTasks` already follows identically
/// (confirmed directly against each one's own `encode(to:)`, not assumed):
/// `expectedRevision`, when a command has one at all, is always a direct
/// sibling key inside `command`, never nested further. Every OTHER field —
/// `translationMetres`, `categoryDetails`, `request`, and the rest — is left
/// byte-for-byte untouched, so this never needs to know what any of them mean.
public enum ConflictResolutionPayloadEditing {
    /// Returns `payload` with `command.expectedRevision` replaced by
    /// `newExpectedRevision`. Throws `orThrow` (the caller's own typed
    /// command error) when `payload` is not a JSON object, has no `command`
    /// object, or that `command` object has no existing `expectedRevision`
    /// key to replace — the last case catches a command with no revision at
    /// all (a create), which should never reach here since
    /// `ConflictRecoveryPolicy.isSafelyReplayable(commandType:)` already
    /// excludes every such command from ever offering `reapplyLocalIntent`.
    public static func replacingExpectedRevision(
        in payload: String,
        with newExpectedRevision: Int,
        orThrow error: @autoclosure () -> any Error
    ) throws -> String {
        // `try?`, not `try`: a malformed/non-object JSON text must fall
        // through to `orThrow`'s own typed error below, not propagate
        // `JSONSerialization`'s own untyped `NSError` — a `guard let ... =
        // try foo() else { ... }` only runs its `else` branch when `foo()`
        // returns `nil`, never when it throws, so the throwing call is
        // deliberately downgraded to an optional first.
        guard
            let data = payload.data(using: .utf8),
            var envelope = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            var command = envelope["command"] as? [String: Any],
            command["expectedRevision"] != nil
        else {
            throw error()
        }

        command["expectedRevision"] = newExpectedRevision
        envelope["command"] = command

        guard
            let rewritten = try? JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys]),
            let text = String(data: rewritten, encoding: .utf8)
        else {
            throw error()
        }

        return text
    }
}
