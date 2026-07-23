import CoreDomain
import Testing

@testable import FeatureTasks

@Suite("Create task form validation")
struct CreateTaskFormValidationTests {
    private func failure(
        _ result: Result<(title: String, gardenAreaMapObjectId: String?, plantId: String?), CreateTaskFormValidation.Failure>
    ) -> CreateTaskFormValidation.Failure? {
        if case let .failure(failure) = result { return failure }
        return nil
    }

    @Test("An empty title is rejected")
    func emptyTitleIsRejected() {
        let result = CreateTaskFormValidation.resolve(
            title: "  ", targetKind: .garden, targetGardenAreaMapObjectId: "", targetPlantId: ""
        )

        #expect(failure(result) == .titleRequired)
    }

    @Test("A garden target sets neither id")
    func gardenTargetSetsNeitherId() {
        let result = CreateTaskFormValidation.resolve(
            title: "Mow the lawn", targetKind: .garden, targetGardenAreaMapObjectId: "area-1", targetPlantId: "plant-1"
        )

        switch result {
        case let .success((title, areaId, plantId)):
            #expect(title == "Mow the lawn")
            #expect(areaId == nil)
            #expect(plantId == nil)
        case .failure:
            Issue.record("Expected success")
        }
    }

    @Test("A garden-area target without an id is rejected")
    func gardenAreaTargetWithoutIdIsRejected() {
        let result = CreateTaskFormValidation.resolve(
            title: "Weed the bed", targetKind: .gardenArea, targetGardenAreaMapObjectId: "  ", targetPlantId: ""
        )

        #expect(failure(result) == .targetIdRequired)
    }

    @Test("A garden-area target with an id sets only gardenAreaMapObjectId")
    func gardenAreaTargetSetsOnlyAreaId() {
        let result = CreateTaskFormValidation.resolve(
            title: "Weed the bed", targetKind: .gardenArea, targetGardenAreaMapObjectId: " area-1 ", targetPlantId: ""
        )

        switch result {
        case let .success((_, areaId, plantId)):
            #expect(areaId == "area-1")
            #expect(plantId == nil)
        case .failure:
            Issue.record("Expected success")
        }
    }

    @Test("A plant target without an id is rejected")
    func plantTargetWithoutIdIsRejected() {
        let result = CreateTaskFormValidation.resolve(
            title: "Water it", targetKind: .plant, targetGardenAreaMapObjectId: "", targetPlantId: ""
        )

        #expect(failure(result) == .targetIdRequired)
    }

    @Test("A plant target with an id sets only plantId")
    func plantTargetSetsOnlyPlantId() {
        let result = CreateTaskFormValidation.resolve(
            title: "Water it", targetKind: .plant, targetGardenAreaMapObjectId: "", targetPlantId: "plant-1"
        )

        switch result {
        case let .success((_, areaId, plantId)):
            #expect(areaId == nil)
            #expect(plantId == "plant-1")
        case .failure:
            Issue.record("Expected success")
        }
    }
}
