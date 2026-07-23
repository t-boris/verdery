import CoreDomain
import CoreLocalization
import Foundation
import Testing

@testable import FeatureMap

@Suite("Map scale presentation")
struct MapScalePresentationTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    private func georeference(accuracyMetres: Double?) -> GardenGeoreference {
        GardenGeoreference(
            localAnchor: Position(x: 0, y: 0),
            geographicAnchor: Position(x: -122.4, y: 37.7),
            rotationDegrees: 0,
            scaleCorrection: 1,
            accuracyMetres: accuracyMetres,
            provenance: .userMeasurement,
            method: "manual-pin",
            revision: 1
        )
    }

    @Test("A nil georeference reads as an informational 'no scale set' message")
    func nilGeoreferenceReadsAsNotSet() {
        let text = MapScalePresentation.text(for: nil, strings: strings)

        #expect(text == strings(.mapScaleNotSet))
    }

    @Test("A georeference with accuracy includes the accuracy clause")
    func georeferenceWithAccuracyIncludesClause() {
        let text = MapScalePresentation.text(for: georeference(accuracyMetres: 2.5), strings: strings)

        #expect(text.contains("2.5"))
        #expect(text == strings.string(.mapScaleGeoreferencedWithAccuracy, parameters: ["accuracyMetres": "2.5"]))
    }

    @Test("A georeference with no accuracy figure omits the accuracy clause")
    func georeferenceWithoutAccuracyOmitsClause() {
        let text = MapScalePresentation.text(for: georeference(accuracyMetres: nil), strings: strings)

        #expect(text == strings(.mapScaleGeoreferenced))
        #expect(!text.contains("accuracy"))
    }
}
