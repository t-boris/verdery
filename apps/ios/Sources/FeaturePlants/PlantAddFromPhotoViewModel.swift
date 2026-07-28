import CoreDomain
import CoreLocalization
import CoreMediaTransfer
import CoreNetworking
import Foundation
import Observation

/// The "Add plant from photo" flow's own state — separate from
/// `photoAttachment.status` (the upload itself), which the view reads
/// directly, the same split `PlantDetailViewModel` already makes.
public enum PlantAddFromPhotoViewState: Equatable {
    case pickingPhoto
    /// The upload finished; `AddPlantFromPhoto` and the identification
    /// suggestion read that follows it are both in flight.
    case submittingIdentification
    /// The plant was created (`AddPlantFromPhoto`) and its identification
    /// suggestion, if any, was fetched.
    case reviewing(plant: Plant, identification: PlantIdentification?)
    case confirming
    /// The flow's own terminal state: the plant exists, and any suggestion
    /// has either been confirmed or deliberately left for later — the view
    /// navigates to `plantId`'s detail screen once this is reached.
    case done(plantId: String)
    case failed(message: String)
}

/// View model for the "Add plant from photo" screen (ADR-0015): pick a
/// photo → upload it → create the plant from it → review what the AI
/// suggested → confirm, or decide later.
///
/// Mirrors `PlantDetailViewModel`'s photo-attachment shape
/// (`photoAttachment`/`pickPhoto`/`retryPhotoUpload`/`discardPickedPhoto`)
/// for the upload step, then adds this flow's own two online, gateway-backed
/// calls (`AddPlantFromPhoto`, `ConfirmPlantIdentification`) plus the read
/// that makes reviewing them possible (`FetchPlantIdentification`) — see
/// `PlantIdentificationUseCases.swift`'s own doc comments for why these three
/// needed a first real caller.
@MainActor
@Observable
public final class PlantAddFromPhotoViewModel {
    public private(set) var state: PlantAddFromPhotoViewState = .pickingPhoto
    /// `nil` only for a `PlantAddFromPhotoViewModel` built with no media-
    /// upload capability wired in — the same optional-capability shape
    /// `PlantDetailViewModel.photoAttachment` already establishes, so every
    /// existing test double keeps working unchanged;
    /// `AppCompositionRoot.makePlantAddFromPhotoViewModel` supplies a real one.
    public let photoAttachment: PhotoAttachmentController?

    public let gardenId: String
    private let addPlantFromPhoto: AddPlantFromPhoto
    private let fetchPlantIdentification: FetchPlantIdentification
    private let confirmPlantIdentification: ConfirmPlantIdentification
    private let strings: LocalizedStrings

    public init(
        gardenId: String,
        addPlantFromPhoto: AddPlantFromPhoto,
        fetchPlantIdentification: FetchPlantIdentification,
        confirmPlantIdentification: ConfirmPlantIdentification,
        strings: LocalizedStrings,
        photoAttachment: PhotoAttachmentController? = nil
    ) {
        self.gardenId = gardenId
        self.addPlantFromPhoto = addPlantFromPhoto
        self.fetchPlantIdentification = fetchPlantIdentification
        self.confirmPlantIdentification = confirmPlantIdentification
        self.strings = strings
        self.photoAttachment = photoAttachment
    }

    public var title: String { strings(.plantsAddFromPhotoTitle) }
    public var hint: String { strings(.plantsAddFromPhotoHint) }
    public var pickButtonTitle: String { strings(.mediaAttachPickButton) }
    public var retryButtonTitle: String { strings(.mediaAttachRetryButton) }
    public var removeButtonTitle: String { strings(.mediaAttachRemoveButton) }
    public var takePhotoButtonTitle: String { strings(.mediaCaptureTakePhotoButton) }
    public var cameraPermissionDeniedMessage: String { strings(.mediaCapturePermissionDeniedMessage) }
    public var openSettingsButtonTitle: String { strings(.mediaCaptureOpenSettingsButton) }
    public var submittingMessage: String { strings(.plantsAddFromPhotoSubmitting) }
    public var suggestedLabel: String { strings(.plantsIdentificationSuggestedLabel) }
    public var noConfidentMatchMessage: String { strings(.plantsIdentificationNoConfidentMatch) }
    public var confidenceLabel: String { strings(.plantsIdentificationConfidenceLabel) }
    public var confirmButtonTitle: String { strings(.plantsIdentificationConfirmButton) }
    public var laterButtonTitle: String { strings(.plantsIdentificationLaterButton) }
    public var closeTitle: String { strings(.plantsClose) }
    public var varietyLabel: String { strings(.plantsIdentificationVarietyLabel) }
    public var growthStageLabel: String { strings(.plantsIdentificationGrowthStageLabel) }
    public var conditionLabel: String { strings(.plantsIdentificationConditionLabel) }
    public var careGuidanceLabel: String { strings(.plantsIdentificationCareGuidanceLabel) }

    public func growthStageName(_ stage: PlantLifecycleStage) -> String {
        PlantsLocalization.lifecycleStageName(stage, strings: strings)
    }

    public var photoStatusText: String {
        PhotoAttachmentStatusLocalization.text(for: photoAttachment?.status ?? .idle, strings: strings)
    }

    public var errorMessage: String? {
        guard case let .failed(message) = state else { return nil }
        return message
    }

    /// Suggested species' display name, when the identification pass named
    /// one — common name when set, scientific name otherwise, mirroring
    /// `PlantsLocalization.taxonomyDisplayName`'s own rule for the identical
    /// choice on a full `TaxonomyReference`.
    public func suggestionDisplayName(_ suggestion: PlantIdentificationSuggestion) -> String {
        suggestion.commonName?.isEmpty == false ? suggestion.commonName! : suggestion.scientificName
    }

    /// The AI's own raw name guess, when it was confident but the catalog
    /// had no match for it (`PlantIdentification.suggestedTaxonomy == nil`,
    /// `suggestedCommonName != nil`) — same "common name if present,
    /// scientific name otherwise" choice as `suggestionDisplayName(_:)`.
    public func rawSuggestionDisplayName(
        commonName: String,
        scientificName: String?
    ) -> String {
        commonName.isEmpty == false ? commonName : (scientificName ?? "")
    }

    /// A short note distinguishing "confirming will link an existing catalog
    /// entry" from "confirming will name the plant from the AI's own guess,
    /// since nothing in the catalog matches it" — the two have materially
    /// different effects behind the identical "Confirm" affordance.
    public var unlistedSuggestionNote: String { strings(.plantsIdentificationUnlistedNote) }

    public func confidenceText(_ confidenceScore: Double) -> String {
        Self.percentFormatter().string(from: NSNumber(value: confidenceScore)) ?? ""
    }

    /// Starts a brand-new photo attachment — see
    /// `PlantDetailViewModel.pickPhoto`'s identical doc comment for the pick
    /// → durably-persist → upload → verify sequence this is the first step
    /// of. `photoReady(mediaId:)` below is the caller's own responsibility
    /// to invoke once `photoAttachment.mediaId` becomes non-`nil`.
    public func pickPhoto(data: Data, contentType: String) async {
        guard let photoAttachment else { return }
        state = .pickingPhoto
        await photoAttachment.attach(data: data, displayFilename: "plant-identification-photo", contentType: contentType)
    }

    public func retryPhotoUpload() async {
        await photoAttachment?.retry()
    }

    public func discardPickedPhoto() async {
        state = .pickingPhoto
        await photoAttachment?.discard()
    }

    /// The upload's own last step, resolved: creates the plant from the
    /// now-confirmed `mediaId`, then reads back what the identification pass
    /// suggested so the review UI has something real to show.
    public func photoReady(mediaId: String) async {
        state = .submittingIdentification
        do {
            let plant = try await addPlantFromPhoto(gardenId: gardenId, photoMediaId: mediaId)
            let identification = try await fetchPlantIdentification(gardenId: gardenId, plantId: plant.id)
            state = .reviewing(plant: plant, identification: identification)
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    /// Accepts the suggestion shown — a no-op if `state` is not
    /// `.reviewing` with a real identification to confirm (there is nothing
    /// to accept when the pass found no confident candidate).
    public func confirmSuggestion() async {
        guard case let .reviewing(plant, identification) = state,
            let identification, identification.hasConfirmableSuggestion
        else { return }

        state = .confirming
        do {
            _ = try await confirmPlantIdentification(
                gardenId: gardenId,
                plantId: plant.id,
                identificationId: identification.id,
                expectedRevision: plant.revision
            )
            state = .done(plantId: plant.id)
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    /// Leaves the suggestion unconfirmed — the plant already exists, and its
    /// pending identification (if any) stays reviewable later from the plant
    /// detail screen's own banner (`FetchPlantIdentification` again).
    public func decideLater() {
        guard case let .reviewing(plant, _) = state else { return }
        state = .done(plantId: plant.id)
    }

    private func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }

    /// Not a stored `static let`: `NumberFormatter` is not `Sendable` — the
    /// same reason `ObservationsTimelineViewModel.percentFormatter()`
    /// computes one fresh rather than storing it.
    private static func percentFormatter() -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .percent
        formatter.maximumFractionDigits = 0
        return formatter
    }
}
