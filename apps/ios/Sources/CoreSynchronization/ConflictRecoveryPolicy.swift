import CoreDomain

/// Decides which `CoreDomain.ConflictRecoveryAction`s a same-object conflict
/// suggests — generic policy `CoreSynchronization` decides entirely on its
/// own from the wire's plain `commandType`/`recordType` strings, with no
/// feature-specific knowledge needed: neither `ConflictRecoveryAction` nor a
/// command/record type name is feature-owned (P5-CONFLICT-01, replacing
/// Stage 5a's placeholder blanket "`gardenObject` gets all four" rule with a
/// real per-command-type judgment — architecture/offline-synchronization.md,
/// section "14.5 Geometry": "Reapply the local intent to the current version
/// **where the operation is safely replayable**").
///
/// `keepServerVersion` and `openForManualReview` are always offered — every
/// conflict, in every category, can discard the local attempt in favor of
/// the server's, and every conflict's two representations can always be
/// shown side by side. Only `reapplyLocalIntent` and `duplicateAsNewObject`
/// vary per command type.
///
/// ## Safely-replayable table
///
/// A command is "safely replayable" (offers `reapplyLocalIntent`) when
/// resubmitting its exact same local intent against the server's current
/// revision cannot itself corrupt or misapply the mutation — see each case
/// below for the reasoning specific to that command. A command with no
/// `expectedRevision` at all (a create) is never offered `reapplyLocalIntent`
/// — there is no stale revision to correct, so "reapply" has no distinct
/// meaning from "the original operation, unmodified," which the outbox
/// already retries on its own via ordinary backoff.
///
/// | Record type   | Command                          | Reapply | Duplicate | Why |
/// |----------------|----------------------------------|:-------:|:---------:|-----|
/// | garden         | `gardens.create`                 | no      | no        | No `expectedRevision`. |
/// | garden         | `gardens.rename`                 | yes     | no        | Complete new `name`, not shape-dependent. |
/// | garden         | `gardens.archive`                | yes     | no        | Pure state transition, no payload to misapply. |
/// | garden         | `gardens.delete_request`         | yes     | no        | Pure state transition. |
/// | gardenObject   | `map.createObject`               | no      | no        | No `expectedRevision`. |
/// | gardenObject   | `map.moveObject`                 | yes     | yes       | `translationMetres` is a RELATIVE delta — safely replayable against any base geometry by construction. |
/// | gardenObject   | `map.replaceGeometry`            | yes     | yes       | Carries a complete new `geometry`, not derived from the prior shape. |
/// | gardenObject   | `map.editVertex`                 | no      | yes       | `vertexIndex`/`ringIndex` are ABSOLUTE and assume a specific prior shape — the server's current geometry may have a different vertex count, so reapplying could target the wrong vertex or fail structurally. |
/// | gardenObject   | `map.splitLinework`              | no      | no        | `atVertexIndex` is ABSOLUTE, same structural risk as `editVertex`; also multi-target (three affected objects), so a single `serverRepresentation` cannot unambiguously identify which one to duplicate. |
/// | gardenObject   | `map.joinLinework`                | no      | no        | Carries two objects and two independent `expectedRevision`s — this mechanism's one `serverRepresentation`/one corrected revision cannot express "both are now current," and it is multi-target like `splitLinework`. |
/// | gardenObject   | `map.changeProperties`           | yes     | yes       | Complete new `label`/`categoryDetails`, not shape-dependent. |
/// | gardenObject   | `map.assignPlant`                | yes     | yes       | Complete new `targetObjectId` (or `nil`), not derived from prior state. |
/// | gardenObject   | `map.deleteObject`               | yes     | no        | Pure state transition; "duplicate" a deletion has no coherent meaning. |
/// | gardenObject   | `map.restoreObject`              | yes     | no        | Pure state transition. |
/// | gardenObject   | `map.duplicateObject`            | no      | no        | No `expectedRevision`; already a create-shaped command referencing a `sourceObjectId`, so a stale-revision conflict on it is not "reapply the same delta," it is "the source moved/vanished," which reapplying verbatim would not fix. |
/// | plant          | `plants.addPlant`                | no      | no        | No `expectedRevision`. |
/// | plant          | `plants.updateDetails`           | yes     | n/a       | Every field is a complete new value (`FieldUpdate`), never an index or delta. |
/// | plant          | `plants.transitionLifecycleStage`| yes     | n/a       | Complete new `stage` value. |
/// | plant          | `plants.setStatus`               | yes     | n/a       | Complete new `status` value. |
/// | plant          | `plants.movePlant`               | yes     | n/a       | Complete new target object ids, not a delta. |
/// | task           | `tasks.createManualTask`         | no      | no        | No `expectedRevision`. |
/// | task           | `tasks.editTask`                 | yes     | n/a       | Every field is a complete new value. |
/// | task           | `tasks.rescheduleTask`           | yes     | n/a       | Complete new `dueDate`/`timeWindow`. |
/// | task           | `tasks.completeTask`             | yes     | n/a       | Pure state transition (task-state conflicts — section "14.4" — are a business-rule re-check on replay, not a structural risk). |
/// | task           | `tasks.dismissTask`              | yes     | n/a       | Pure state transition. |
/// | task           | `tasks.skipTask`                 | yes     | n/a       | Pure state transition, no request body at all. |
/// | task           | `tasks.deleteTask`               | yes     | n/a       | Pure state transition. |
/// | observation    | `observations.record`            | no      | no        | `GardenObservation` carries no `expectedRevision` at all — append-only by domain design. |
/// | observation    | `observations.correct`           | no      | no        | Same — no revision to correct. |
///
/// `duplicateAsNewObject` ("n/a" above) is offered ONLY for `gardenObject`:
/// it is a geometry-specific recovery ("materialize this device's own
/// currently-cached version of the object as a brand-new standalone record")
/// with no equivalent domain concept for a garden, plant, task, or
/// observation — none of their command sets include anything resembling
/// `duplicateObject`, confirmed directly against `GardenSyncCommand`/
/// `PlantSyncCommand`/`TaskSyncCommand`/`ObservationSyncCommand`, not
/// assumed. Within `gardenObject`, it is further withheld for the two
/// multi-target commands (`splitLinework`/`joinLinework` — see the table)
/// and for commands with no coherent "new object" meaning
/// (`createObject`/`duplicateObject`, already create-shaped;
/// `deleteObject`/`restoreObject`, pure lifecycle flips).
enum ConflictRecoveryPolicy {
    static func suggestedRecoveryActions(forRecordType recordType: String, commandType: String) -> [ConflictRecoveryAction] {
        var actions: [ConflictRecoveryAction] = [.keepServerVersion]

        if isSafelyReplayable(commandType: commandType) {
            actions.append(.reapplyLocalIntent)
        }

        actions.append(.openForManualReview)

        if recordType == "gardenObject", isDuplicable(commandType: commandType) {
            actions.append(.duplicateAsNewObject)
        }

        return actions
    }

    /// See this type's own doc comment for the full per-command reasoning.
    static func isSafelyReplayable(commandType: String) -> Bool {
        switch commandType {
        case "gardens.rename", "gardens.archive", "gardens.delete_request":
            true
        case "map.moveObject", "map.replaceGeometry", "map.changeProperties",
            "map.assignPlant", "map.deleteObject", "map.restoreObject":
            true
        case "plants.updateDetails", "plants.transitionLifecycleStage", "plants.setStatus", "plants.movePlant":
            true
        case "tasks.editTask", "tasks.rescheduleTask", "tasks.completeTask",
            "tasks.dismissTask", "tasks.skipTask", "tasks.deleteTask":
            true
        default:
            // Covers every create command (no `expectedRevision` to correct:
            // `gardens.create`, `map.createObject`, `plants.addPlant`,
            // `tasks.createManualTask`, `observations.record`), every
            // observation command (no revision concept at all), and the two
            // structurally-fragile/multi-target `gardenObject` commands
            // (`map.editVertex`, `map.splitLinework`, `map.joinLinework`,
            // `map.duplicateObject`) — see this type's own table.
            false
        }
    }

    /// See this type's own doc comment for the full per-command reasoning.
    /// Only ever consulted when `recordType == "gardenObject"` — see
    /// `suggestedRecoveryActions(forRecordType:commandType:)`.
    static func isDuplicable(commandType: String) -> Bool {
        switch commandType {
        case "map.moveObject", "map.replaceGeometry", "map.editVertex",
            "map.changeProperties", "map.assignPlant":
            true
        default:
            false
        }
    }
}
