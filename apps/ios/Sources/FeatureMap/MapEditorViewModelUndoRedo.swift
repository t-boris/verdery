import CoreDomain
import CoreNetworking

/// Undo and redo: submit ``MapUndoStack``'s computed inverse command through
/// the same gateway path as any other edit, then report the confirmed result
/// back to the stack. Neither method mutates `undoStack` on failure — an
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

    private func submitUndoRedo(
        _ command: MapCommandPayload,
        confirm: (ObjectSnapshot?, Int) -> Void
    ) async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let result = try await submitMapCommand(gardenId: gardenId, command: command)
            guard let target = foldAffectedObjects(result.affectedObjects) else { return }

            confirm(target.snapshot, target.revision)
        } catch let error as APIGatewayError {
            errorMessage = message(for: error)
        } catch {
            errorMessage = strings(.serverUnexpected)
        }
    }
}
