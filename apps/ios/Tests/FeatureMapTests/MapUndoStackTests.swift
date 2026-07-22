import CoreDomain
import Testing

@testable import FeatureMap

@Suite("Map undo stack")
struct MapUndoStackTests {
    private func snapshot(x: Double, y: Double, state: ObjectLifecycleState = .active) -> ObjectSnapshot {
        ObjectSnapshot(
            objectId: "obj-1",
            category: .tree,
            geometry: .point(Position(x: x, y: y)),
            label: nil,
            categoryDetails: nil,
            lifecycleState: state
        )
    }

    @Test("Starts with nothing to undo or redo")
    func startsEmpty() {
        let stack = MapUndoStack()

        #expect(!stack.canUndo)
        #expect(!stack.canRedo)
        #expect(stack.pendingUndoCommand == nil)
    }

    @Test("recordAccepted makes the entry's inverse the pending undo command")
    func recordAcceptedExposesInverse() {
        var stack = MapUndoStack()
        let move = MapCommandPayload.moveObject(
            MoveObjectPayload(objectId: "obj-1", expectedRevision: 1, translationMetres: PlanarOffset(dx: 3, dy: -1))
        )

        stack.recordAccepted(
            MapUndoEntry(command: move, beforeSnapshot: snapshot(x: 0, y: 0), afterSnapshot: snapshot(x: 3, y: -1), revisionAfter: 2)
        )

        #expect(stack.canUndo)
        #expect(
            stack.pendingUndoCommand
                == .moveObject(
                    MoveObjectPayload(objectId: "obj-1", expectedRevision: 2, translationMetres: PlanarOffset(dx: -3, dy: 1))
                )
        )
    }

    @Test("recordAccepted clears the redo stack")
    func recordAcceptedClearsRedo() {
        var stack = MapUndoStack()
        let move = MapCommandPayload.moveObject(
            MoveObjectPayload(objectId: "obj-1", expectedRevision: 1, translationMetres: PlanarOffset(dx: 1, dy: 0))
        )
        let entry = MapUndoEntry(
            command: move, beforeSnapshot: snapshot(x: 0, y: 0), afterSnapshot: snapshot(x: 1, y: 0), revisionAfter: 2
        )

        stack.recordAccepted(entry)
        stack.confirmUndo(afterSnapshot: snapshot(x: 0, y: 0), revisionAfter: 3)
        #expect(stack.canRedo)

        stack.recordAccepted(entry)
        #expect(!stack.canRedo)
    }

    @Test("A full undo → redo round trip reproduces the original command, re-targeted at the new revision")
    func undoRedoRoundTrip() {
        var stack = MapUndoStack()
        let move = MapCommandPayload.moveObject(
            MoveObjectPayload(objectId: "obj-1", expectedRevision: 1, translationMetres: PlanarOffset(dx: 4, dy: 2))
        )

        stack.recordAccepted(
            MapUndoEntry(command: move, beforeSnapshot: snapshot(x: 0, y: 0), afterSnapshot: snapshot(x: 4, y: 2), revisionAfter: 2)
        )

        // Undo: submit the inverse (a -4, -2 move), server confirms revision 3.
        let undoCommand = stack.pendingUndoCommand
        #expect(
            undoCommand
                == .moveObject(
                    MoveObjectPayload(objectId: "obj-1", expectedRevision: 2, translationMetres: PlanarOffset(dx: -4, dy: -2))
                )
        )
        stack.confirmUndo(afterSnapshot: snapshot(x: 0, y: 0), revisionAfter: 3)
        #expect(!stack.canUndo)
        #expect(stack.canRedo)

        // Redo: submit the inverse of the inverse — the original +4, +2 move, now targeting revision 3.
        let redoCommand = stack.pendingRedoCommand
        #expect(
            redoCommand
                == .moveObject(
                    MoveObjectPayload(objectId: "obj-1", expectedRevision: 3, translationMetres: PlanarOffset(dx: 4, dy: 2))
                )
        )
        stack.confirmRedo(afterSnapshot: snapshot(x: 4, y: 2), revisionAfter: 4)
        #expect(stack.canUndo)
        #expect(!stack.canRedo)
    }

    @Test("A command with no computable inverse blocks undo without crashing")
    func blockedEntryIsSurfaced() {
        var stack = MapUndoStack()
        let split = MapCommandPayload.splitLinework(
            SplitLineworkPayload(
                objectId: "obj-1",
                expectedRevision: 1,
                resultObjectIds: SplitResultObjectIds(first: "a", second: "b"),
                atVertexIndex: 2
            )
        )

        stack.recordAccepted(MapUndoEntry(command: split, beforeSnapshot: nil, afterSnapshot: nil, revisionAfter: 2))

        #expect(stack.pendingUndoCommand == nil)
        #expect(stack.topUndoIsBlocked)
        // canUndo reflects "the stack has an entry," not "that entry has an
        // inverse" — the view distinguishes the two states via
        // `topUndoIsBlocked`, checked above, rather than by canUndo lying
        // about there being nothing left to undo.
        #expect(stack.canUndo)
    }

    @Test("createObject inverts to deleteObject, and that inverts back to restoreObject")
    func createDeleteRestoreCycle() {
        var stack = MapUndoStack()
        let create = MapCommandPayload.createObject(
            CreateObjectPayload(objectId: "new-1", category: .tree, geometry: .point(Position(x: 0, y: 0)))
        )

        stack.recordAccepted(
            MapUndoEntry(command: create, beforeSnapshot: nil, afterSnapshot: snapshot(x: 0, y: 0), revisionAfter: 1)
        )

        #expect(
            stack.pendingUndoCommand == .deleteObject(DeleteObjectPayload(objectId: "new-1", expectedRevision: 1))
        )

        stack.confirmUndo(afterSnapshot: snapshot(x: 0, y: 0, state: .deleted), revisionAfter: 2)

        #expect(
            stack.pendingRedoCommand == .restoreObject(RestoreObjectPayload(objectId: "new-1", expectedRevision: 2))
        )
    }
}
