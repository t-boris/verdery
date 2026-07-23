import CoreDomain
import CoreLocalization
import Foundation
import Testing

@testable import FeatureMap

@Suite("Map category localization")
struct MapCategoryLocalizationTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    @Test("Every category resolves to a non-empty, category-specific name", arguments: GardenObjectCategory.allCases)
    func everyCategoryHasAName(_ category: GardenObjectCategory) {
        let name = MapCategoryLocalization.name(for: category, strings: strings)

        #expect(!name.isEmpty)
        // A missing catalogue entry resolves to the raw key itself (see
        // `LocalizedStrings.string(forKey:)`) — asserting the resolved name
        // never starts with the key's own namespace prefix catches that
        // failure mode instead of only checking non-emptiness.
        #expect(!name.hasPrefix("map.category."))
    }

    @Test("Category names are pairwise distinct")
    func categoryNamesAreDistinct() {
        let names = GardenObjectCategory.allCases.map { MapCategoryLocalization.name(for: $0, strings: strings) }

        #expect(Set(names).count == names.count)
    }

    @Test("Every structure kind resolves to a non-empty name", arguments: StructureKind.allCases)
    func everyStructureKindHasAName(_ kind: StructureKind) {
        #expect(!MapCategoryLocalization.name(for: kind, strings: strings).isEmpty)
    }

    @Test("Every fence kind resolves to a non-empty name", arguments: FenceKind.allCases)
    func everyFenceKindHasAName(_ kind: FenceKind) {
        #expect(!MapCategoryLocalization.name(for: kind, strings: strings).isEmpty)
    }

    @Test("Every zone kind resolves to a non-empty name", arguments: ZoneKind.allCases)
    func everyZoneKindHasAName(_ kind: ZoneKind) {
        #expect(!MapCategoryLocalization.name(for: kind, strings: strings).isEmpty)
    }

    @Test("Every bed kind resolves to a non-empty name", arguments: BedKind.allCases)
    func everyBedKindHasAName(_ kind: BedKind) {
        #expect(!MapCategoryLocalization.name(for: kind, strings: strings).isEmpty)
    }

    @Test("Every utility exclusion kind resolves to a non-empty name", arguments: UtilityExclusionKind.allCases)
    func everyUtilityExclusionKindHasAName(_ kind: UtilityExclusionKind) {
        #expect(!MapCategoryLocalization.name(for: kind, strings: strings).isEmpty)
    }

    @Test("Every measurement unit resolves to a non-empty name", arguments: MeasurementUnit.allCases)
    func everyMeasurementUnitHasAName(_ unit: MeasurementUnit) {
        #expect(!MapCategoryLocalization.name(for: unit, strings: strings).isEmpty)
    }
}
