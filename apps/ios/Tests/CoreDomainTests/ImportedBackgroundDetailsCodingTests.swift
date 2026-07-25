import Foundation
import Testing

@testable import CoreDomain

/// Coding coverage for the `importedBackground` details branch (P6-PLAN
/// iOS parity): the nested local coding (`GardenObjectDetailsCoding`, what
/// `LocalMapStore` persists) and the flat wire coding
/// (`GardenObjectDetailsWireCoding`, what actually crosses the network),
/// including the server-owned calibration block with its explicit-`null`
/// RMS — the "not expressed below two control points" contract.
@Suite("Imported background details coding")
struct ImportedBackgroundDetailsCodingTests {
    /// Encodes through `GardenObjectDetailsWireCoding` at the top level.
    private struct WireBox: Encodable {
        let value: GardenObjectDetails

        func encode(to encoder: any Encoder) throws {
            try GardenObjectDetailsWireCoding.encode(value, to: encoder)
        }
    }

    private struct WireUnbox: Decodable {
        let value: GardenObjectDetails

        init(from decoder: any Decoder) throws {
            value = try GardenObjectDetailsWireCoding.decode(from: decoder)
        }
    }

    private let calibrated = GardenObjectDetails.importedBackground(
        ImportedBackgroundDetails(
            planMediaId: "01936b2a-0000-7000-8000-000000000001",
            sourcePageNumber: 2,
            isBackgroundVisible: false,
            calibrationState: .calibrated,
            calibration: ImportedBackgroundCalibration(
                transformRevision: 3,
                pageAspectRatio: 0.75,
                knownDistance: PlanKnownDistance(
                    pointA: Position(x: 0.1, y: 0.1),
                    pointB: Position(x: 0.6, y: 0.1),
                    distanceMetres: 10
                ),
                referencePoints: [
                    CalibratedReferencePoint(
                        planPoint: Position(x: 0.5, y: 0.25),
                        localMetres: Position(x: 10, y: 10),
                        residualMetres: 0.04
                    )
                ],
                manualAdjustment: ManualCalibrationAdjustment(
                    rotationRadians: 0.2,
                    translationMetres: PlanarOffset(dx: 1, dy: -2)
                ),
                transform: PlanTransform(
                    metresPerPlanUnit: 20,
                    rotationRadians: 0.1,
                    translationMetres: PlanTranslation(x: 4, y: -3)
                ),
                rmsErrorMetres: nil
            )
        )
    )

    @Test("Round-trips through the nested local coding")
    func nestedRoundTrip() throws {
        let encoded = try JSONEncoder().encode(calibrated)
        let decoded = try JSONDecoder().decode(GardenObjectDetails.self, from: encoded)

        #expect(decoded == calibrated)
    }

    @Test("Round-trips through the flat wire coding")
    func wireRoundTrip() throws {
        let encoded = try JSONEncoder().encode(WireBox(value: calibrated))
        let decoded = try JSONDecoder().decode(WireUnbox.self, from: encoded)

        #expect(decoded.value == calibrated)
    }

    @Test("Decodes the contract's exact flat wire shape, null RMS included")
    func decodesContractWireShape() throws {
        // The exact field names `openapi.yaml`'s `ImportedBackgroundDetails`
        // and `ImportedBackgroundCalibration` declare — flat `category`
        // alongside the fields, nested calibration block, explicit `null`
        // for a below-two-points RMS.
        let json = Data("""
            {
              "category": "importedBackground",
              "planMediaId": "01936b2a-0000-7000-8000-000000000001",
              "isBackgroundVisible": true,
              "calibrationState": "calibrated",
              "calibration": {
                "transformRevision": 1,
                "pageAspectRatio": 0.75,
                "knownDistance": {
                  "pointA": [0.1, 0.1],
                  "pointB": [0.6, 0.1],
                  "distanceMetres": 10
                },
                "referencePoints": [],
                "transform": {
                  "metresPerPlanUnit": 20,
                  "rotationRadians": 0,
                  "translationMetres": { "x": 0, "y": 0 }
                },
                "rmsErrorMetres": null
              }
            }
            """.utf8)

        let decoded = try JSONDecoder().decode(WireUnbox.self, from: json).value

        guard case let .importedBackground(details) = decoded else {
            Issue.record("Expected an importedBackground branch")
            return
        }
        #expect(details.planMediaId == "01936b2a-0000-7000-8000-000000000001")
        #expect(details.sourcePageNumber == nil)
        #expect(details.isBackgroundVisible)
        #expect(details.calibrationState == .calibrated)
        #expect(details.calibration?.transformRevision == 1)
        #expect(details.calibration?.transform.metresPerPlanUnit == 20)
        #expect(details.calibration?.rmsErrorMetres == nil)
    }

    @Test("An uncalibrated background's wire shape carries no calibration block")
    func uncalibratedWireShape() throws {
        let details = GardenObjectDetails.importedBackground(
            ImportedBackgroundDetails(planMediaId: "plan-1")
        )
        let encoded = try JSONEncoder().encode(WireBox(value: details))
        let object = try #require(
            try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )

        #expect(object["category"] as? String == "importedBackground")
        #expect(object["planMediaId"] as? String == "plan-1")
        #expect(object["isBackgroundVisible"] as? Bool == true)
        #expect(object["calibrationState"] as? String == "uncalibrated")
        #expect(object["calibration"] == nil)
        #expect(object["sourcePageNumber"] == nil)
    }

    @Test("writableDetails strips exactly the server-owned block")
    func writableDetailsStripsCalibration() {
        guard case let .importedBackground(details) = calibrated else {
            Issue.record("Expected an importedBackground branch")
            return
        }
        let writable = details.writableDetails

        #expect(writable.calibration == nil)
        #expect(writable.planMediaId == details.planMediaId)
        #expect(writable.sourcePageNumber == details.sourcePageNumber)
        #expect(writable.isBackgroundVisible == details.isBackgroundVisible)
        // The state is deliberately KEPT: `changeProperties` must echo it.
        #expect(writable.calibrationState == .calibrated)
    }
}
