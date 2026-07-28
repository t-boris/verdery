/// `PlantDetailViewModel`'s own localized text for the "Record as
/// observation" affordance (`PlantIdentificationBannerView`), split out
/// purely to keep `PlantDetailViewModel.swift` under this repository's
/// 600-line rule — the same `CollaboratorsViewModel+Actions.swift`
/// precedent.
extension PlantDetailViewModel {
    public var identificationAcquisitionDateLabel: String { strings(.plantsIdentificationAcquisitionDateLabel) }
    public var recordObservationButtonTitle: String { strings(.plantsIdentificationRecordObservationButton) }
    public var observationRecordedMessage: String { strings(.plantsIdentificationObservationRecordedMessage) }
}
