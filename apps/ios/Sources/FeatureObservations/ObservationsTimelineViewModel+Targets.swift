import CoreDomain
import CoreLocalization
import Foundation

/// Choosing what an observation is about.
///
/// Both lists are online-only reads and both fail quietly: a target is optional
/// on every observation, so an unreachable list means "a garden-wide note", not
/// an error somebody has to clear before they can write down what they saw.
extension ObservationsTimelineViewModel {
    public func loadRecordTargets() async {
        if let listTargetPlants {
            recordTargetPlants = (try? await listTargetPlants(gardenId: gardenId)) ?? []
        }
        if let listTargetObjects {
            recordTargetObjects = (try? await listTargetObjects(gardenId: gardenId)) ?? []
        }
    }

    /// An unlabelled object is ordinary — most people never name a bed — so it
    /// falls back to its category rather than to a blank row or an identifier.
    public func objectName(_ object: GardenMapObject) -> String {
        if let label = object.label, !label.isEmpty { return label }
        return object.category.rawValue
    }

    public func selectRecordPlant(_ plant: Plant) {
        recordPlantId = recordPlantId == plant.id ? "" : plant.id
    }

    public func selectRecordObject(_ object: GardenMapObject) {
        recordGardenObjectId = recordGardenObjectId == object.id ? "" : object.id
    }
}
