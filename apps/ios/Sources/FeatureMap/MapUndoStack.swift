import CoreDomain

/// One accepted command, kept exactly as long as its inverse might still be
/// wanted.
///
/// `beforeSnapshot` is the object's state immediately before `command` was
/// applied — what `deriveInverseCommand` needs as its `priorSnapshot`.
/// `afterSnapshot` is the object's state immediately after — captured from
/// the server's own response when the command was first accepted. Carrying
/// both, rather than only `beforeSnapshot`, is what lets undo and redo share
/// one implementation: inverting this entry always needs `beforeSnapshot`
/// (below), and the entry that inversion produces needs `afterSnapshot` as
/// *its* `beforeSnapshot` — see ``MapUndoStack/confirmUndo`` and
/// ``MapUndoStack/confirmRedo``.
public struct MapUndoEntry: Equatable, Sendable {
    public let command: MapCommandPayload
    public let beforeSnapshot: ObjectSnapshot?
    public let afterSnapshot: ObjectSnapshot?
    /// The revision the server assigned after applying `command` — the
    /// `expectedRevision` this entry's inverse must target.
    public let revisionAfter: Int

    public init(
        command: MapCommandPayload,
        beforeSnapshot: ObjectSnapshot?,
        afterSnapshot: ObjectSnapshot?,
        revisionAfter: Int
    ) {
        self.command = command
        self.beforeSnapshot = beforeSnapshot
        self.afterSnapshot = afterSnapshot
        self.revisionAfter = revisionAfter
    }

    /// `nil` when `command`'s type has no single-command inverse — see
    /// `deriveInverseCommand`'s doc comment (split/join linework, calibration,
    /// and proposal decisions). The undo stack surfaces this as "not
    /// undoable" rather than silently dropping the entry.
    public var inverseCommand: MapCommandPayload? {
        deriveInverseCommand(command: command, priorSnapshot: beforeSnapshot, revisionAfterCommand: revisionAfter)
    }
}

/// Local undo/redo over a stack of accepted commands.
///
/// "Undo creates the inverse domain command; it does not rewind the
/// database... Once synchronized, undo remains a new explicit change" —
/// `CoreDomain/Map/InverseCommand.swift`'s module doc comment. This type only
/// decides *which* command to submit next and keeps the two stacks coherent;
/// the caller (``MapEditorViewModel``) submits that command through the
/// gateway like any other and reports back what the server actually
/// returned via ``confirmUndo``/``confirmRedo`` — this type never assumes
/// the inverse it computed is what the server will confirm, which matters
/// the moment a concurrent edit makes the assumption wrong.
///
/// Undo and redo are the same operation with the stacks swapped: popping an
/// entry, computing its inverse, and — once the caller confirms the server
/// accepted that inverse — pushing a new entry (the inverse command just
/// submitted, with before/after swapped) onto the *other* stack. That
/// symmetry is why one pair of methods serves both directions instead of two
/// independent implementations that could drift apart.
public struct MapUndoStack: Equatable, Sendable {
    private var undoEntries: [MapUndoEntry] = []
    private var redoEntries: [MapUndoEntry] = []

    public init() {}

    public var canUndo: Bool { !undoEntries.isEmpty }
    public var canRedo: Bool { !redoEntries.isEmpty }

    /// The command "Undo" would submit, or `nil` when the stack is empty or
    /// the top entry has no inverse. The view uses this to disable the Undo
    /// control up front, per the work package: "When it returns nil, disable
    /// undo for that entry and communicate why."
    public var pendingUndoCommand: MapCommandPayload? { undoEntries.last?.inverseCommand }
    public var pendingRedoCommand: MapCommandPayload? { redoEntries.last?.inverseCommand }

    /// True when there is a top undo entry but it has no inverse — the
    /// "communicate why" half of the contract above: the stack is not empty,
    /// Undo is simply unavailable for this particular change.
    public var topUndoIsBlocked: Bool { !undoEntries.isEmpty && pendingUndoCommand == nil }
    public var topRedoIsBlocked: Bool { !redoEntries.isEmpty && pendingRedoCommand == nil }

    /// Records a freshly accepted, user-initiated command (never the result
    /// of an undo/redo submission itself — those go through
    /// ``confirmUndo``/``confirmRedo`` instead). Clears the redo stack: a new
    /// local change invalidates whatever was previously undone, the usual rule.
    public mutating func recordAccepted(_ entry: MapUndoEntry) {
        undoEntries.append(entry)
        redoEntries.removeAll()
    }

    /// Call once the server has accepted ``pendingUndoCommand``. Moves the
    /// top undo entry to the redo stack with its before/after roles swapped,
    /// so a later redo inverts *this* entry back to the original command.
    ///
    /// `afterSnapshot` and `revisionAfter` describe the state the *inverse*
    /// command produced, taken from the server's response to submitting it —
    /// not from the popped entry, which describes the original command.
    public mutating func confirmUndo(afterSnapshot: ObjectSnapshot?, revisionAfter: Int) {
        guard let entry = undoEntries.last, let inverse = entry.inverseCommand else { return }
        undoEntries.removeLast()

        redoEntries.append(
            MapUndoEntry(
                command: inverse,
                beforeSnapshot: entry.afterSnapshot,
                afterSnapshot: afterSnapshot,
                revisionAfter: revisionAfter
            )
        )
    }

    /// The redo-direction counterpart of ``confirmUndo``.
    public mutating func confirmRedo(afterSnapshot: ObjectSnapshot?, revisionAfter: Int) {
        guard let entry = redoEntries.last, let inverse = entry.inverseCommand else { return }
        redoEntries.removeLast()

        undoEntries.append(
            MapUndoEntry(
                command: inverse,
                beforeSnapshot: entry.afterSnapshot,
                afterSnapshot: afterSnapshot,
                revisionAfter: revisionAfter
            )
        )
    }
}
