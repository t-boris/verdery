import CoreDomain
import CoreGraphics
import CoreNetworking

/// `splitLinework` and `joinLinework`, offered only for `fence` and `path`
/// objects — the two categories `services/api/.../domain/geometry-edit.ts`
/// actually implements `splitLineString`/`joinLineStrings` for.
///
/// Both commands return `nil` from `deriveInverseCommand` by design (split
/// and join recreate object identity in a way a single inverse command
/// cannot express — `InverseCommand.swift`'s doc comment). Submitting them
/// through the same generic `submit(_:undoBeforeSnapshot:)` every other
/// command uses is enough: `MapUndoStack.topUndoIsBlocked` already surfaces
/// "not undoable" correctly with no special-casing here.
extension MapEditorViewModel {
    // MARK: - Split

    /// Splits the object currently in vertex-edit mode at the selected
    /// vertex — the shape-edit action bar's "Split here." The original
    /// object stops existing server-side; this app selects the first
    /// resulting piece and leaves vertex-edit mode, since the original id it
    /// was scoped to is no longer valid.
    public func splitAtSelectedVertex() async {
        guard let objectId = vertexEditObjectId, let object = objectsById[objectId],
            let vertexIndex = selectedVertexIndex,
            object.category == .fence || object.category == .path,
            MapVertexEditCommands.canSplit(geometry: object.geometry, atVertexIndex: vertexIndex)
        else { return }

        let command = MapCommandPayload.splitLinework(
            SplitLineworkPayload(
                objectId: objectId,
                expectedRevision: object.revision,
                resultObjectIds: SplitResultObjectIds(first: UUIDv7.generate(), second: UUIDv7.generate()),
                atVertexIndex: vertexIndex
            )
        )

        await submit(command, undoBeforeSnapshot: object.snapshot) { firstPiece in
            self.selectedObjectId = firstPiece.id
        }

        vertexEditObjectId = nil
        selectedVertexIndex = nil
    }

    // MARK: - Join

    /// True when `object` has at least one other active object of the same
    /// category to join with — what the property sheet checks before
    /// offering "Join with..." at all.
    public func canJoin(_ object: GardenMapObject) -> Bool {
        guard object.category == .fence || object.category == .path else { return false }

        return objectsById.values.contains { other in
            other.id != object.id && other.category == object.category && other.lifecycleState == .active
        }
    }

    /// Enters "select the second object to join" mode — the property
    /// sheet's "Join with..." action for a `fence`/`path` object.
    public func beginJoinSelection(objectId: String) {
        guard let object = objectsById[objectId], canJoin(object) else { return }
        pendingJoinFirstObjectId = objectId
        propertySheetObjectId = nil
    }

    /// Abandons an in-progress join without submitting anything.
    public func cancelJoinSelection() {
        pendingJoinFirstObjectId = nil
    }

    /// Handles a canvas tap while a join is pending: completes the join if
    /// the tapped object is a valid second half (same category, different
    /// object, active), otherwise surfaces why it was rejected and leaves
    /// join-selection mode active so the user can try again.
    func completeJoinSelection(atScreen point: CGPoint) async {
        guard let firstId = pendingJoinFirstObjectId, let first = objectsById[firstId] else {
            pendingJoinFirstObjectId = nil
            return
        }

        guard let secondId = hitTestObjectId(atScreen: point), secondId != firstId,
            let second = objectsById[secondId], second.category == first.category
        else {
            errorMessage = strings(.mapLineworkJoinIncompatible)
            return
        }

        pendingJoinFirstObjectId = nil
        let command = MapCommandPayload.joinLinework(
            JoinLineworkPayload(
                firstObjectId: firstId,
                firstExpectedRevision: first.revision,
                secondObjectId: secondId,
                secondExpectedRevision: second.revision,
                resultObjectId: UUIDv7.generate()
            )
        )

        await submit(command, undoBeforeSnapshot: first.snapshot) { joined in
            self.selectedObjectId = joined.id
        }
    }
}
