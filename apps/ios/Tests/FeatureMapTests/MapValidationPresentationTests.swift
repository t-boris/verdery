import CoreDomain
import CoreLocalization
import Foundation
import Testing

@testable import FeatureMap

@Suite("Map validation presentation")
struct MapValidationPresentationTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    @Test("Error and warning severities resolve to distinct, non-empty SF Symbol names")
    func severitiesResolveToDistinctSymbols() {
        let errorSymbol = MapValidationPresentation.symbolName(for: .error)
        let warningSymbol = MapValidationPresentation.symbolName(for: .warning)

        #expect(!errorSymbol.isEmpty)
        #expect(!warningSymbol.isEmpty)
        #expect(errorSymbol != warningSymbol)
    }

    @Test("A code already in the catalogue (shared with client-side geometry validation) resolves to its real localized text")
    func knownCodeResolvesToLocalizedText() {
        // Reuses an existing `GeometryValidationCode` entry — exactly the
        // shape `MapGatewayTests`'s `documentJSON` fixture constructs a
        // `validationSummary` entry with — to prove a server-reported code
        // resolves through the same catalogue a client-side code already
        // does, with no special-casing.
        let text = MapValidationPresentation.text(forCode: GeometryValidationCode.polygonBelowMinimumArea, strings: strings)

        #expect(text != GeometryValidationCode.polygonBelowMinimumArea)
        #expect(text.contains("smaller"))
    }

    @Test("An unrecognized code falls back to itself rather than failing")
    func unknownCodeFallsBackToItself() {
        let code = "map.validation.some_future_cross_object_check"

        #expect(MapValidationPresentation.text(forCode: code, strings: strings) == code)
    }
}
