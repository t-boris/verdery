import CoreNetworking

/// `PlantDetailViewModel`'s own failure-message resolution, split out purely
/// to keep `PlantDetailViewModel.swift` under this repository's 600-line
/// rule — the same `CollaboratorsViewModel+Actions.swift` precedent.
extension PlantDetailViewModel {
    func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }

    func message(for failure: AddPlantFormValidation.Failure) -> String {
        switch failure {
        case .displayNameRequired: strings(.plantsDisplayNameRequired)
        case .quantityRequired: strings(.plantsQuantityRequired)
        case .quantityMustBePositive: strings(.plantsQuantityMustBePositive)
        }
    }

    func message(for failure: PlantCommandError) -> String {
        switch failure {
        case .invalidDisplayName:
            strings(.plantsDisplayNameRequired)
        case .localRecordNotFound, .payloadEncodingFailed, .conflictResolutionPayloadMalformed:
            strings(.serverUnexpected)
        }
    }
}
