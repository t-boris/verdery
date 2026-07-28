import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@MainActor
@Suite("Observation suggestion controller")
struct ObservationSuggestionControllerTests {
    private func makeController(gateway: FakePlantGateway) -> ObservationSuggestionController {
        ObservationSuggestionController(
            recordObservationFromIdentification: RecordObservationFromIdentification(
                gateway: gateway, generateIdempotencyKey: { "fixed-key" }
            ),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("record sets recordedConfirmation on success")
    func recordSetsConfirmation() async {
        let gateway = FakePlantGateway(plants: [])
        let controller = makeController(gateway: gateway)

        await controller.record(gardenId: "garden-1", plantId: "plant-1", identificationId: "identification-1")

        #expect(controller.recordedConfirmation)
        #expect(controller.errorMessage == nil)
        #expect(controller.isRecording == false)
    }

    @Test("record surfaces a gateway failure as an error message, not a crash")
    func recordSurfacesFailure() async {
        let gateway = FakePlantGateway(plants: [])
        gateway.recordObservationFromIdentificationError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let controller = makeController(gateway: gateway)

        await controller.record(gardenId: "garden-1", plantId: "plant-1", identificationId: "identification-1")

        #expect(controller.recordedConfirmation == false)
        #expect(controller.errorMessage != nil)
    }
}
