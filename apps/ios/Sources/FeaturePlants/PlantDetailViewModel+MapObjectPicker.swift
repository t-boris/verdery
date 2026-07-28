/// `PlantDetailViewModel`'s own `gardenAreaMapObjectId`/`placementMapObjectId`
/// picker logic, split out purely to keep `PlantDetailViewModel.swift` under
/// this repository's 600-line rule — the same `CollaboratorsViewModel
/// +Actions.swift` precedent.
extension PlantDetailViewModel {
    /// This field's own current selection, resolved to its map object's
    /// label when the picker has already loaded the garden's objects — see
    /// `PlantsHomeViewModel.mapObjectSummary(for:)`'s identical shape.
    public func mapObjectSummary(for field: MapObjectPlacementField) -> String? {
        let rawId = field == .gardenArea ? editedGardenAreaMapObjectId : editedPlacementMapObjectId
        guard !rawId.isEmpty else { return nil }
        return mapObjects.first { $0.id == rawId }?.label ?? rawId
    }

    /// Absent entirely for a `PlantDetailViewModel` built with no
    /// `listGardenMapObjects` — the same "real, working affordance or
    /// nothing" rule `photoSection`'s own doc comment establishes.
    public func openMapObjectPicker(for field: MapObjectPlacementField) async {
        guard let listGardenMapObjects else { return }
        if mapObjects.isEmpty {
            mapObjects = (try? await listGardenMapObjects(gardenId: gardenId)) ?? []
        }
        activeMapObjectField = field
    }

    public func selectMapObject(_ objectId: String?) {
        guard let field = activeMapObjectField else { return }
        switch field {
        case .gardenArea: editedGardenAreaMapObjectId = objectId ?? ""
        case .placement: editedPlacementMapObjectId = objectId ?? ""
        }
        activeMapObjectField = nil
    }
}
