import CoreDomain
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@Suite("Add plant from photo")
struct AddPlantFromPhotoTests {
    @Test("calls the gateway with the given photoMediaId and a generated idempotency key")
    func callsGatewayWithPhotoMediaId() async throws {
        let gateway = FakePlantGateway(plants: [])
        let addFromPhoto = AddPlantFromPhoto(gateway: gateway, generateIdempotencyKey: { "fixed-key" })

        let plant = try await addFromPhoto(gardenId: "garden-1", photoMediaId: "media-42")

        #expect(plant.gardenId == "garden-1")
    }

    @Test("propagates a gateway failure")
    func propagatesGatewayFailure() async throws {
        let gateway = FakePlantGateway(plants: [])
        gateway.addPlantFromPhotoError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let addFromPhoto = AddPlantFromPhoto(gateway: gateway)

        await #expect(throws: Error.self) {
            _ = try await addFromPhoto(gardenId: "garden-1", photoMediaId: "media-1")
        }
    }
}

@Suite("Confirm plant identification")
struct ConfirmPlantIdentificationTests {
    @Test("calls the gateway with the given identificationId, revision, and a generated idempotency key")
    func callsGatewayWithIdentification() async throws {
        let plant = Plant(
            id: "plant-1",
            gardenId: "garden-1",
            gardenAreaMapObjectId: nil,
            placementMapObjectId: nil,
            displayName: "Unidentified plant",
            taxonomyReferenceId: nil,
            varietyLabel: nil,
            acceptedIdentificationId: nil,
            acquisitionDate: nil,
            acquisitionDateType: nil,
            groupingKind: .individual,
            quantity: nil,
            lifecycleStage: .planned,
            status: .active,
            conditionNote: nil,
            careGuidanceNote: nil,
            revision: 1,
            createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        let gateway = FakePlantGateway(plants: [plant])
        let confirm = ConfirmPlantIdentification(gateway: gateway, generateIdempotencyKey: { "fixed-key" })

        let confirmed = try await confirm(
            gardenId: "garden-1",
            plantId: "plant-1",
            identificationId: "identification-1",
            expectedRevision: 1
        )

        #expect(confirmed.revision == 2)
        #expect(confirmed.acceptedIdentificationId == "identification-1")
    }

    @Test("propagates a revision conflict")
    func propagatesRevisionConflict() async throws {
        let plant = Plant(
            id: "plant-1",
            gardenId: "garden-1",
            gardenAreaMapObjectId: nil,
            placementMapObjectId: nil,
            displayName: "Unidentified plant",
            taxonomyReferenceId: nil,
            varietyLabel: nil,
            acceptedIdentificationId: nil,
            acquisitionDate: nil,
            acquisitionDateType: nil,
            groupingKind: .individual,
            quantity: nil,
            lifecycleStage: .planned,
            status: .active,
            conditionNote: nil,
            careGuidanceNote: nil,
            revision: 1,
            createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        let gateway = FakePlantGateway(plants: [plant])
        let confirm = ConfirmPlantIdentification(gateway: gateway)

        await #expect(throws: Error.self) {
            _ = try await confirm(
                gardenId: "garden-1",
                plantId: "plant-1",
                identificationId: "identification-1",
                expectedRevision: 99
            )
        }
    }
}

@Suite("Fetch plant identification")
struct FetchPlantIdentificationTests {
    @Test("returns the pending identification when one exists")
    func returnsPendingIdentification() async throws {
        let gateway = FakePlantGateway(plants: [])
        gateway.pendingIdentification = PlantIdentification(
            id: "identification-1",
            plantId: "plant-1",
            plantPhotoId: "photo-1",
            confidenceScore: 0.81,
            createdAt: Date(timeIntervalSince1970: 0),
            suggestedTaxonomy: PlantIdentificationSuggestion(
                id: "tax-1", scientificName: "Ocimum basilicum", commonName: "Basil"
            )
        )
        let fetch = FetchPlantIdentification(gateway: gateway)

        let identification = try await fetch(gardenId: "garden-1", plantId: "plant-1")

        #expect(identification?.suggestedTaxonomy?.commonName == "Basil")
    }

    @Test("narrows the not-found error into nil rather than throwing")
    func narrowsNotFoundToNil() async throws {
        let gateway = FakePlantGateway(plants: [])
        let fetch = FetchPlantIdentification(gateway: gateway)

        let identification = try await fetch(gardenId: "garden-1", plantId: "plant-1")

        #expect(identification == nil)
    }

    @Test("still throws any other failure")
    func propagatesOtherFailures() async throws {
        let gateway = FakePlantGateway(plants: [])
        gateway.getPlantIdentificationError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let fetch = FetchPlantIdentification(gateway: gateway)

        await #expect(throws: Error.self) {
            _ = try await fetch(gardenId: "garden-1", plantId: "plant-1")
        }
    }
}

@Suite("Record observation from identification")
struct RecordObservationFromIdentificationTests {
    @Test("calls the gateway with the given identificationId and a generated idempotency key")
    func callsGatewayWithIdentification() async throws {
        let gateway = FakePlantGateway(plants: [])
        let recordObservation = RecordObservationFromIdentification(gateway: gateway, generateIdempotencyKey: { "fixed-key" })

        let observation = try await recordObservation(
            gardenId: "garden-1", plantId: "plant-1", identificationId: "identification-1"
        )

        #expect(observation.conditionSummary == gateway.recordedObservation.conditionSummary)
        #expect(gateway.recordObservationFromIdentificationCalls.map(\.identificationId) == ["identification-1"])
    }

    @Test("propagates a gateway failure")
    func propagatesGatewayFailure() async throws {
        let gateway = FakePlantGateway(plants: [])
        gateway.recordObservationFromIdentificationError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let recordObservation = RecordObservationFromIdentification(gateway: gateway)

        await #expect(throws: Error.self) {
            _ = try await recordObservation(gardenId: "garden-1", plantId: "plant-1", identificationId: "identification-1")
        }
    }
}
