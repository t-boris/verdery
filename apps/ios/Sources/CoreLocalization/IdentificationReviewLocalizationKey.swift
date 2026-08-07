/// Answering for a walk's worth of photographs at the kitchen table.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum IdentificationReviewLocalizationKey: String, Sendable, CaseIterable {
    case reviewTitle = "review.title"
    case reviewOpen = "review.open"
    case reviewExplanation = "review.explanation"
    case reviewRemaining = "review.remaining"
    case reviewConfirm = "review.confirm"
    case reviewSkip = "review.skip"
    case reviewOpenPlant = "review.openPlant"
    case reviewConfidence = "review.confidence"
    case reviewNoSuggestion = "review.noSuggestion"
    case reviewDoneTitle = "review.doneTitle"
    case reviewDoneMessage = "review.doneMessage"
    case reviewEmptyTitle = "review.emptyTitle"
    case reviewEmptyMessage = "review.emptyMessage"
    case reviewOffline = "review.offline"
    case reviewFailed = "review.failed"

    // MARK: - What a walk produced

    case runSummaryTitle = "run.summaryTitle"
    case runCaptured = "run.captured"
    case runResolved = "run.resolved"
    case runAwaiting = "run.awaiting"
    case runUploading = "run.uploading"
    case runFailed = "run.failed"
    case runAllDone = "run.allDone"
    case runReviewNow = "run.reviewNow"
    case runKeepWalking = "run.keepWalking"
}
