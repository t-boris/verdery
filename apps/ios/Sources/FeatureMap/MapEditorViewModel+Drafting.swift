import CoreDomain
import Foundation
import SwiftUI

/// Drawing a shape instead of dropping a default one on the map.
///
/// The editor's create flow placed a fixed four-metre square at the tap point
/// and opened the property sheet. Every lot, house, bed and path on this
/// client therefore began life the same size and shape, and became the right
/// one only after somebody dragged its vertices. `MapDraftSession` is the
/// shape being drawn; this is what the screen does with it.
///
/// Split from `MapEditorViewModelEditing.swift` rather than added to it: that
/// file is already long, and drafting is its own mode with its own vocabulary.
extension MapEditorViewModel {
    /// Whether a shape is currently being drawn.
    public var isDrafting: Bool { draft != nil }

    /// The points placed so far, in screen space, for the canvas to preview.
    public var draftScreenPoints: [CGPoint] {
        (draft?.points ?? []).map { transform.screenPoint(for: $0) }
    }

    public var canFinishDraft: Bool { draft?.canFinish ?? false }

    // Reusing existing catalogue entries rather than minting four keys for a
    // bar that says undo, cancel and done.
    public var draftUndoTitle: String { strings(.mapUndo) }
    public var draftCancelTitle: String { strings(.mapPropertyClose) }
    public var draftFinishTitle: String { strings(.mapPropertySave) }

    /// Starts a shape. A point category still commits on the first tap —
    /// there is nothing to draw — so drafting is for lines and areas.
    public func beginDraft(_ category: CreatableMapObjectCategory) {
        armedCreateCategory = category
        selectedObjectId = nil
        let session = MapDraftSession(category: category)
        draft = session.kind == .point ? nil : session
    }

    public func addDraftPoint(atScreen point: CGPoint) {
        guard var draft else { return }
        draft.addPoint(transform.localPosition(for: point))
        self.draft = draft
    }

    /// Adds a freehand trace, sampled in screen space and converted once.
    ///
    /// Converting per sample would apply the viewport transform hundreds of
    /// times for a shape that keeps a dozen vertices; simplification happens
    /// in local metres because that is the space ADR-0010's tolerance is
    /// expressed in.
    public func addDraftTrace(screenPoints: [CGPoint]) {
        guard var draft else { return }
        draft.addTracedPath(screenPoints.map { transform.localPosition(for: $0) })
        self.draft = draft
    }

    public func undoDraftPoint() {
        guard var draft else { return }
        draft.undoLastPoint()
        self.draft = draft
    }

    public func cancelDraft() {
        draft = nil
        armedCreateCategory = nil
    }

    /// Commits the drawn shape as one `createObject`.
    ///
    /// Local validation runs first and its failure is spoken rather than
    /// swallowed: a traced shape can fall under the minimum area or length —
    /// a bed drawn as a scribble, a fence tapped twice in the same place — and
    /// a silent no-op after somebody has just drawn something is the worst
    /// possible answer.
    public func finishDraft() async {
        guard let draft, let geometry = draft.geometry() else { return }

        if let issue = GeometryValidation.validate(geometry).first {
            errorMessage = MapValidationPresentation.text(forCode: issue.code, strings: strings)
            return
        }

        let category = draft.category
        self.draft = nil
        armedCreateCategory = nil

        let command = MapGestureCommands.createCommand(
            objectId: UUIDv7.generate(),
            category: category,
            geometry: geometry,
            label: nil
        )

        await submit(command, undoBeforeSnapshot: nil) { created in
            self.selectedObjectId = created.id
            self.propertySheetObjectId = created.id
        }
    }
}
