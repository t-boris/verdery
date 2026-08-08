import Foundation

/// One persisted map object, as the application reads it back from the
/// server: identity and revision on top of the same category/geometry/label/
/// details shape ``ObjectSnapshot`` already carries.
///
/// This is a new type, not a duplication of ``ObjectSnapshot``: the snapshot
/// exists to answer "what did the object look like right before a command,"
/// a shape `deriveInverseCommand` needs and nothing else. A client also needs
/// "what does the object look like right now, with which identity and
/// revision" — what every row in a `GardenMapDocument` is, and what a
/// `moveObject`/`deleteObject`/... command's `expectedRevision` is read from.
/// Kept in `CoreDomain`, not `CoreNetworking`, the same way `Garden` is: this
/// is the application's own view of the object, not the wire shape — see
/// `CoreNetworking/MapTransport.swift` for the wire DTO that decodes into it.
///
/// Source: architecture/map-rendering-and-editing.md, section
/// "6. Hybrid Data Model"; packages/api-contracts/openapi.yaml, `GardenObject`.
public struct GardenMapObject: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let category: GardenObjectCategory
    public let geometry: Geometry
    public let coordinateSpaceId: String
    public let label: String?
    public let categoryDetails: GardenObjectDetails?
    public let lifecycleState: ObjectLifecycleState
    /// Whether this one object is hidden from the canvas.
    ///
    /// Per-object and SERVER-persisted, distinct from `MapLayer` visibility,
    /// which is a client preference over a whole group. The contract has
    /// carried both since the command set was written — "Persisted per-object
    /// canvas visibility. Hidden objects remain in the object index" — and the
    /// web has always honoured them. This client decoded neither, so an object
    /// hidden on a laptop was drawn on the phone, which is what the owner
    /// reported as "I see all the parts, though many of them are marked not to
    /// show on the web".
    public let isHidden: Bool
    /// Whether this one object refuses editing. Same standing as
    /// ``isHidden``: per object, on the server, and independent of the layer
    /// lock that may also apply.
    public let isLocked: Bool
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        gardenId: String,
        category: GardenObjectCategory,
        geometry: Geometry,
        coordinateSpaceId: String,
        label: String? = nil,
        categoryDetails: GardenObjectDetails? = nil,
        lifecycleState: ObjectLifecycleState,
        isHidden: Bool = false,
        isLocked: Bool = false,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gardenId = gardenId
        self.category = category
        self.geometry = geometry
        self.coordinateSpaceId = coordinateSpaceId
        self.label = label
        self.categoryDetails = categoryDetails
        self.lifecycleState = lifecycleState
        self.isHidden = isHidden
        self.isLocked = isLocked
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// This object's state as an ``ObjectSnapshot`` — exactly the "before" or
    /// "after" shape ``deriveInverseCommand`` and the map editor's undo stack
    /// need, so a caller never has to hand-assemble one from these fields.
    public var snapshot: ObjectSnapshot {
        ObjectSnapshot(
            objectId: id,
            category: category,
            geometry: geometry,
            label: label,
            categoryDetails: categoryDetails,
            lifecycleState: lifecycleState
        )
    }

    /// A copy with this object's own visibility and edit lock replaced.
    ///
    /// Separate from ``replacingSnapshot(_:revision:updatedAt:)`` because
    /// ``ObjectSnapshot`` cannot carry these two — see that method's own
    /// comment for why the cross-runtime fixture decides that.
    public func settingVisibility(isHidden: Bool, isLocked: Bool) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: gardenId,
            category: category,
            geometry: geometry,
            coordinateSpaceId: coordinateSpaceId,
            label: label,
            categoryDetails: categoryDetails,
            lifecycleState: lifecycleState,
            isHidden: isHidden,
            isLocked: isLocked,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    /// Returns a copy with every field ``ObjectSnapshot`` can carry replaced
    /// by that snapshot's values, keeping identity, revision, and timestamps.
    ///
    /// Used to fold a command's result (which arrives as a fresh
    /// ``GardenMapObject`` at a new revision) or an undo/redo step's target
    /// snapshot back into local state without re-deriving every field by hand.
    public func replacingSnapshot(_ snapshot: ObjectSnapshot, revision: Int, updatedAt: Date) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: gardenId,
            category: snapshot.category,
            geometry: snapshot.geometry,
            coordinateSpaceId: coordinateSpaceId,
            label: snapshot.label,
            categoryDetails: snapshot.categoryDetails,
            lifecycleState: snapshot.lifecycleState,
            // `isHidden`/`isLocked` deliberately survive a snapshot replacement
            // rather than being restored from it: `ObjectSnapshot` is the
            // cross-runtime shape `command-inverse.json` pins, and that fixture
            // — shared with the TypeScript suite — does not carry them. Adding
            // them here in Swift alone would break the equivalence the fixture
            // exists to guarantee. See `MapCommandProjection`'s
            // `changeProperties` case, which applies them directly.
            isHidden: isHidden,
            isLocked: isLocked,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
