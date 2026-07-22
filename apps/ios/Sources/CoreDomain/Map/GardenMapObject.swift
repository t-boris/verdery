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
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
