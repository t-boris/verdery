import CoreDomain
import Testing

@testable import FeatureMap

@Suite("Map layer")
struct MapLayerTests {
    @Test("Every category maps to a layer", arguments: GardenObjectCategory.allCases)
    func everyCategoryMapsToALayer(_ category: GardenObjectCategory) {
        // Constructing a `MapLayer` for every category must not crash or
        // fall through to a default — this simply proves the initializer's
        // switch is exhaustive over every case, the same exhaustiveness
        // `MapCategoryLocalizationTests` checks for category names.
        _ = MapLayer(category: category)
    }

    @Test("Lot and structure map to layer 3 (lot and fixed structures)")
    func lotAndStructureMapToLayerThree() {
        #expect(MapLayer(category: .lot) == .lotAndStructures)
        #expect(MapLayer(category: .structure) == .lotAndStructures)
    }

    @Test("Zone, bed, path, fence, and gate map to layer 4 (zones/beds/paths/fences)")
    func zonesBedsPathsFencesGatesMapToLayerFour() {
        #expect(MapLayer(category: .zone) == .zonesAndLinework)
        #expect(MapLayer(category: .bed) == .zonesAndLinework)
        #expect(MapLayer(category: .path) == .zonesAndLinework)
        #expect(MapLayer(category: .fence) == .zonesAndLinework)
        #expect(MapLayer(category: .gate) == .zonesAndLinework)
    }

    @Test("waterFeature and utilityExclusion join the same bounded-area layer as zone/bed, though the architecture doc does not name them individually")
    func waterFeatureAndUtilityExclusionJoinZonesLayer() {
        #expect(MapLayer(category: .waterFeature) == .zonesAndLinework)
        #expect(MapLayer(category: .utilityExclusion) == .zonesAndLinework)
    }

    @Test("Tree, plant, and annotation map to layer 5 (plants and annotations)")
    func treePlantAnnotationMapToLayerFive() {
        #expect(MapLayer(category: .tree) == .plantsAndAnnotations)
        #expect(MapLayer(category: .plant) == .plantsAndAnnotations)
        #expect(MapLayer(category: .annotation) == .plantsAndAnnotations)
    }

    @Test("importedBackground maps to layer 2 (imported plan/image backgrounds)")
    func importedBackgroundMapsToLayerTwo() {
        #expect(MapLayer(category: .importedBackground) == .importedBackgrounds)
    }

    @Test("There is no layer case for the geographic basemap, generated proposals, or editor chrome")
    func onlyFourLayersExist() {
        // Layer 1 (basemap) already has its own presence/absence control,
        // layer 6 (proposals) has no category in this codebase yet, and
        // layer 7 (selection/handles/overlays) is editor chrome — see
        // `MapLayer`'s doc comment.
        #expect(MapLayer.allCases.count == 4)
    }
}
