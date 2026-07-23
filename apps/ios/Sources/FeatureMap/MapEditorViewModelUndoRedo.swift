import CoreDomain

/// Undo and redo: submit ``MapUndoStack``'s computed inverse command through
/// the same local commit path as any other edit, then report the result back
/// to the stack. Neither method mutates `undoStack` on failure — an
/// unconfirmed submission must not advance either stack, or a retry would
/// invert a change that was never actually reverted.
extension MapEditorViewModel {
    public func undo() async {
        guard let command = undoStack.pendingUndoCommand else { return }

        await submitUndoRedo(command) { afterSnapshot, revisionAfter in
            self.undoStack.confirmUndo(afterSnapshot: afterSnapshot, revisionAfter: revisionAfter)
        }
    }

    public func redo() async {
        guard let command = undoStack.pendingRedoCommand else { return }

        await submitUndoRedo(command) { afterSnapshot, revisionAfter in
            self.undoStack.confirmRedo(afterSnapshot: afterSnapshot, revisionAfter: revisionAfter)
        }
    }

    /// Drives ``MapEditorViewModel/saveStatus`` the same way
    /// `MapEditorViewModelEditing.submit(_:undoBeforeSnapshot:onSuccess:)`
    /// does — undo/redo is a real command submission through the same local
    /// commit path as any other edit, so it reports the same save status.
    private func submitUndoRedo(
        _ command: MapCommandPayload,
        confirm: (ObjectSnapshot?, Int) -> Void
    ) async {
        isSubmitting = true
        saveStatus = .saving
        errorMessage = nil
        defer { isSubmitting = false }

        guard let coordinateSpaceId else {
            errorMessage = strings(.mapErrorLocalCommandFailed)
            saveStatus = .failed
            return
        }

        do {
            let affectedObjects = try await applyMapCommandOffline(
                gardenId: gardenId,
                coordinateSpaceId: coordinateSpaceId,
                command: command
            )
            saveStatus = .savedLocally
            guard let target = foldAffectedObjects(affectedObjects) else { return }

            confirm(target.snapshot, target.revision)
        } catch {
            errorMessage = strings(.mapErrorLocalCommandFailed)
            saveStatus = .failed
        }
    }
}
