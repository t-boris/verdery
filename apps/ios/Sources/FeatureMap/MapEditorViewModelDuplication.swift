import CoreDomain
import CoreNetworking

/// `duplicateObject` and `assignPlant` — two single-object commands that,
/// unlike everything in `MapEditorViewModelEditing.swift`, are not part of
/// the label/details Save flow.
extension MapEditorViewModel {
    /// Duplicates the currently selected object — the property sheet's
    /// "Duplicate" action.
    public func duplicateSelected() async {
        guard let objectId = selectedObjectId else { return }
        await duplicate(objectId: objectId)
    }

    /// A small fixed offset, in metres, so a duplicate never lands exactly on
    /// top of its source — enough to be visibly a separate object at the
    /// zoom levels this editor's default viewport fit uses, without becoming
    /// a surprise if the source shape itself is small.
    private static let duplicateOffsetMetres = PlanarOffset(dx: 1, dy: 1)

    public func duplicate(objectId: String) async {
        guard let object = objectsById[objectId], !isObjectLocked(object) else { return }

        let command = MapCommandPayload.duplicateObject(
            DuplicateObjectPayload(
                sourceObjectId: objectId,
                newObjectId: UUIDv7.generate(),
                offsetMetres: Self.duplicateOffsetMetres
            )
        )

        // `deriveInverseCommand`'s `duplicateObject` case never reads
        // `priorSnapshot` — its inverse is always "delete the new object" —
        // so `nil` is correct here, not a shortcut.
        await submit(command, undoBeforeSnapshot: nil) { duplicated in
            self.selectedObjectId = duplicated.id
            self.propertySheetObjectId = duplicated.id
        }
    }

    /// Zone and bed objects a plant can be assigned to, in document order —
    /// the property sheet's "Assigned to" picker options for a selected
    /// plant, alongside a "None" choice the view itself supplies.
    public var assignablePlantTargets: [GardenMapObject] {
        orderedObjectIds.compactMap { objectsById[$0] }
            .filter { $0.lifecycleState == .active && ($0.category == .zone || $0.category == .bed) }
    }

    /// Submits `assignPlant` for `objectId` — a distinct command from
    /// `saveProperties`/`changeProperties`, even though
    /// `PlantPlacementDetails.assignedToObjectId` also lives inside the same
    /// details struct `changeProperties` can touch. `targetObjectId` is the
    /// chosen zone/bed id, or `nil` to unassign.
    public func assignPlant(objectId: String, targetObjectId: String?) async {
        guard let object = objectsById[objectId], object.category == .plant else { return }

        let command = MapCommandPayload.assignPlant(
            AssignPlantPayload(plantObjectId: objectId, expectedRevision: object.revision, targetObjectId: targetObjectId)
        )
        await submit(command, undoBeforeSnapshot: object.snapshot)
    }
}
