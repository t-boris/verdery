import Testing

@testable import CoreDomain

/// Ported from `object-category.test.ts`. No shared JSON fixture backs this
/// module — the assertions are inline source in both languages.
@Suite("Garden object categories")
struct GardenObjectCategoryTests {
    @Test("Every category is listed exactly once")
    func noDuplicateCategories() {
        #expect(Set(GardenObjectCategory.allCases).count == GardenObjectCategory.allCases.count)
    }

    @Test("A polygon lot boundary is accepted")
    func acceptsPolygonLotBoundary() {
        #expect(GardenObjectCategory.isGeometryTypeAllowedForCategory(.lot, .polygon))
    }

    @Test("A point lot boundary is rejected")
    func rejectsPointLotBoundary() {
        #expect(!GardenObjectCategory.isGeometryTypeAllowedForCategory(.lot, .point))
    }

    @Test("A point tree trunk is accepted")
    func acceptsPointTreeTrunk() {
        #expect(GardenObjectCategory.isGeometryTypeAllowedForCategory(.tree, .point))
    }

    @Test(
        "A polygon tree trunk is rejected — the canopy is a separate optional field, not the primary geometry"
    )
    func rejectsPolygonTreeTrunk() {
        #expect(!GardenObjectCategory.isGeometryTypeAllowedForCategory(.tree, .polygon))
    }

    @Test("A point or line string annotation is accepted")
    func acceptsPointOrLineStringAnnotation() {
        #expect(GardenObjectCategory.isGeometryTypeAllowedForCategory(.annotation, .point))
        #expect(GardenObjectCategory.isGeometryTypeAllowedForCategory(.annotation, .lineString))
    }

    @Test(
        "Every category allows at least one geometry type",
        arguments: GardenObjectCategory.allCases
    )
    func everyCategoryAllowsAtLeastOneGeometryType(_ category: GardenObjectCategory) {
        let anyAllowed = GeometryType.allCases.contains {
            GardenObjectCategory.isGeometryTypeAllowedForCategory(category, $0)
        }

        #expect(anyAllowed)
    }
}
