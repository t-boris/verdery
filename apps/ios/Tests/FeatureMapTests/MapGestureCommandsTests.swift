import CoreDomain
import CoreGraphics
import Testing

@testable import FeatureMap

@Suite("Map gesture command construction")
struct MapGestureCommandsTests {
    @Test("Movement under the tap threshold classifies as a tap at the start location")
    func belowThresholdIsTap() {
        let start = CGPoint(x: 100, y: 100)
        let end = CGPoint(x: 102, y: 101)

        let outcome = MapGestureCommands.classifyDragEnd(
            startScreen: start,
            endScreen: end,
            selectedObjectIdAtStart: "some-object"
        )

        #expect(outcome == .tap(start))
    }

    @Test("Movement over the threshold starting on the selected object moves it")
    func aboveThresholdOnSelectedObjectMoves() {
        let start = CGPoint(x: 0, y: 0)
        let end = CGPoint(x: 0, y: 40)

        let outcome = MapGestureCommands.classifyDragEnd(
            startScreen: start,
            endScreen: end,
            selectedObjectIdAtStart: "obj-1"
        )

        #expect(outcome == .moveObject(objectId: "obj-1", translation: CGSize(width: 0, height: 40)))
    }

    @Test("Movement over the threshold starting off the selected object pans instead")
    func aboveThresholdOffSelectionPans() {
        let outcome = MapGestureCommands.classifyDragEnd(
            startScreen: CGPoint(x: 0, y: 0),
            endScreen: CGPoint(x: 40, y: 0),
            selectedObjectIdAtStart: nil
        )

        #expect(outcome == .pan(translation: CGSize(width: 40, height: 0)))
    }

    @Test("moveCommand is nil for a zero-length translation")
    func moveCommandNilForZeroTranslation() {
        let command = MapGestureCommands.moveCommand(
            objectId: "obj-1",
            expectedRevision: 3,
            translationMetres: PlanarOffset(dx: 0, dy: 0)
        )

        #expect(command == nil)
    }

    @Test("moveCommand carries the exact translation and expected revision")
    func moveCommandCarriesTranslation() {
        let command = MapGestureCommands.moveCommand(
            objectId: "obj-1",
            expectedRevision: 3,
            translationMetres: PlanarOffset(dx: 1.5, dy: -2)
        )

        #expect(
            command
                == .moveObject(
                    MoveObjectPayload(
                        objectId: "obj-1",
                        expectedRevision: 3,
                        translationMetres: PlanarOffset(dx: 1.5, dy: -2)
                    )
                )
        )
    }

    @Test(
        "Every creatable category's default geometry passes shared geometry validation",
        arguments: CreatableMapObjectCategory.allCases
    )
    func defaultGeometryIsValid(_ category: CreatableMapObjectCategory) {
        let geometry = MapGestureCommands.defaultGeometry(for: category, at: Position(x: 12, y: -8))

        #expect(GeometryValidation.isValid(geometry))
        #expect(GardenObjectCategory.isGeometryTypeAllowedForCategory(category.category, geometry.type))
    }

    @Test("createCommand builds a createObject payload matching the requested category and label")
    func createCommandBuildsCreateObjectPayload() {
        let command = MapGestureCommands.createCommand(
            objectId: "new-id",
            category: .tree,
            at: Position(x: 1, y: 2),
            label: "Oak"
        )

        guard case let .createObject(payload) = command else {
            Issue.record("Expected a createObject command")
            return
        }

        #expect(payload.objectId == "new-id")
        #expect(payload.category == .tree)
        #expect(payload.geometry == .point(Position(x: 1, y: 2)))
        #expect(payload.label == "Oak")
    }

    @Test("defaultDetails never fabricates a non-empty plant common name")
    func defaultPlantDetailsAreHonest() {
        guard case let .plant(details)? = MapGestureCommands.defaultDetails(for: .plant) else {
            Issue.record("Expected plant details")
            return
        }

        #expect(details.commonName.isEmpty)
        #expect(details.quantity == 1)
    }

    @Test("lot has no default category details")
    func lotHasNoDetails() {
        #expect(MapGestureCommands.defaultDetails(for: .lot) == nil)
    }

    @Test("waterFeature has no default category details, matching lot")
    func waterFeatureHasNoDetails() {
        #expect(MapGestureCommands.defaultDetails(for: .waterFeature) == nil)
    }

    @Test("gate has no default details without a fence id — never fabricated")
    func gateHasNoDetailsWithoutFence() {
        #expect(MapGestureCommands.defaultDetails(for: .gate) == nil)
    }

    @Test("gate's default details carry exactly the supplied fence id")
    func gateDefaultDetailsCarryFenceId() {
        guard case let .gate(details)? = MapGestureCommands.defaultDetails(for: .gate, fenceObjectId: "fence-1") else {
            Issue.record("Expected gate details")
            return
        }

        #expect(details.fenceObjectId == "fence-1")
        #expect(details.widthMetres == nil)
    }

    @Test("createCommand for a gate carries the fence id through to categoryDetails")
    func createCommandBuildsGateDetails() {
        let command = MapGestureCommands.createCommand(
            objectId: "gate-1", category: .gate, at: Position(x: 0, y: 0), label: nil, fenceObjectId: "fence-1"
        )

        guard case let .createObject(payload) = command, case let .gate(details)? = payload.categoryDetails else {
            Issue.record("Expected a createObject command with gate details")
            return
        }

        #expect(payload.geometry.type == .lineString)
        #expect(details.fenceObjectId == "fence-1")
    }

    @Test("zone/bed/utilityExclusion/annotation default details match object-category.ts's defaults")
    func newCategoryDefaultsMatchTypeScriptSide() {
        guard case let .zone(zone)? = MapGestureCommands.defaultDetails(for: .zone) else {
            Issue.record("Expected zone details")
            return
        }
        #expect(zone.zoneKind == .other)

        guard case let .bed(bed)? = MapGestureCommands.defaultDetails(for: .bed) else {
            Issue.record("Expected bed details")
            return
        }
        #expect(bed.bedKind == .inGround)

        guard case let .utilityExclusion(exclusion)? = MapGestureCommands.defaultDetails(for: .utilityExclusion) else {
            Issue.record("Expected utility exclusion details")
            return
        }
        #expect(exclusion.utilityExclusionKind == .other)

        guard case let .annotation(annotation)? = MapGestureCommands.defaultDetails(for: .annotation) else {
            Issue.record("Expected annotation details")
            return
        }
        #expect(annotation.measurement == nil)
    }

    @Test("path's default geometry is a line, matching fence's shape")
    func pathDefaultGeometryIsALine() {
        let geometry = MapGestureCommands.defaultGeometry(for: .path, at: Position(x: 0, y: 0))
        #expect(geometry.type == .lineString)
    }

    @Test("gate's default line is shorter than fence's default line")
    func gateDefaultLineIsShorterThanFence() {
        let gateGeometry = MapGestureCommands.defaultGeometry(for: .gate, at: Position(x: 0, y: 0))
        let fenceGeometry = MapGestureCommands.defaultGeometry(for: .fence, at: Position(x: 0, y: 0))

        #expect(GeometryMeasurement.lineLength(gateGeometry.positions) < GeometryMeasurement.lineLength(fenceGeometry.positions))
    }

    @Test("CreatableMapObjectCategory covers every non-importedBackground category exactly once")
    func creatableCategoriesCoverEveryCategoryButImportedBackground() {
        let creatable = Set(CreatableMapObjectCategory.allCases.map(\.category))
        let all = Set(GardenObjectCategory.allCases)

        #expect(creatable == all.subtracting([.importedBackground]))
    }
}
