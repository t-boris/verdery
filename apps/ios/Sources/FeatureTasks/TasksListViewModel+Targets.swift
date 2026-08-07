import CoreDomain
import CoreLocalization
import Foundation

/// Choosing what a task is about.
///
/// Split from the view model's body so the loading and the naming sit together
/// and neither file approaches this repository's 600-line rule.
///
/// Both lists are online-only reads and both fail quietly: a target is optional
/// on every task, so an unreachable list means "choose a garden-wide task", not
/// an error somebody has to dismiss before they can write down that the roses
/// need water.
extension TasksListViewModel {
    public func loadTargets() async {
        if let listTargetAreas {
            targetAreas = (try? await listTargetAreas(gardenId: gardenId)) ?? []
        }
        if let listTargetPlants {
            targetPlants = (try? await listTargetPlants(gardenId: gardenId)) ?? []
        }
    }

    /// An unlabelled bed is ordinary — most people never name one — so it falls
    /// back to its category rather than to a blank row or a raw identifier.
    public func areaName(_ object: GardenMapObject) -> String {
        if let label = object.label, !label.isEmpty { return label }
        return strings(object.category == .bed ? .mapCategoryBed : .mapCategoryZone)
    }

    public func plantName(_ plant: Plant) -> String { plant.displayName }

    /// What is currently chosen, as a name — or `nil` when nothing is, which is
    /// what makes the target card show its prompt rather than a blank value.
    public var selectedTargetName: String? {
        switch createTargetKind {
        case .garden:
            return nil
        case .gardenArea:
            return targetAreas
                .first { $0.id == createTargetGardenAreaMapObjectId }
                .map(areaName)
        case .plant:
            return targetPlants
                .first { $0.id == createTargetPlantId }
                .map(plantName)
        }
    }

    public func selectArea(_ object: GardenMapObject) {
        createTargetGardenAreaMapObjectId = object.id
        createTargetPlantId = ""
    }

    public func selectPlant(_ plant: Plant) {
        createTargetPlantId = plant.id
        createTargetGardenAreaMapObjectId = ""
    }
}
