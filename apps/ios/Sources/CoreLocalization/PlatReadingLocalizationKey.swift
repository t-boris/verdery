/// Reading a surveyor's plat, and tracing an aerial photograph.
///
/// A separate enum because `LocalizationKey.swift` sits at this repository's
/// 600-line ceiling and an enum's cases cannot be declared in an extension.
public enum PlatReadingLocalizationKey: String, Sendable, CaseIterable {
    case platTitle = "plat.title"
    case platOpen = "plat.open"
    case platExplanation = "plat.explanation"
    case platReading = "plat.reading"
    case platNotAPlat = "plat.notAPlat"
    case platFailed = "plat.failed"
    case platOffline = "plat.offline"

    case platAddress = "plat.address"
    case platNorth = "plat.north"
    case platNorthValue = "plat.northValue"
    case platStatedArea = "plat.statedArea"
    case platWalkedArea = "plat.walkedArea"
    case platAreaValue = "plat.areaValue"
    case platAreaAgrees = "plat.areaAgrees"
    case platAreaDisagrees = "plat.areaDisagrees"

    case platClosure = "plat.closure"
    case platClosureValue = "plat.closureValue"
    case platClosesTitle = "plat.closesTitle"
    case platDoesNotCloseTitle = "plat.doesNotCloseTitle"
    case platDoesNotCloseMessage = "plat.doesNotCloseMessage"
    case platRecoveredBearing = "plat.recoveredBearing"

    case platCallsTitle = "plat.callsTitle"
    case platCallLine = "plat.callLine"
    case platCallBearingMissing = "plat.callBearingMissing"

    case platObjectsTitle = "plat.objectsTitle"
    case platObjectsWithheld = "plat.objectsWithheld"
    case platPageFit = "plat.pageFit"
    case platPageFitValue = "plat.pageFitValue"

    case platAcceptBoundary = "plat.acceptBoundary"
    case platAcceptLocation = "plat.acceptLocation"
    case platAcceptObjects = "plat.acceptObjects"
    case platAccepted = "plat.accepted"
    case platNothingSelected = "plat.nothingSelected"

    // MARK: - Aerial tracing

    case aerialTitle = "aerial.title"
    case aerialOpen = "aerial.open"
    case aerialExplanation = "aerial.explanation"
    case aerialTracing = "aerial.tracing"
    case aerialEmpty = "aerial.empty"
    case aerialVisible = "aerial.visible"
    case aerialInferred = "aerial.inferred"
    case aerialNeedsGeoreference = "aerial.needsGeoreference"
    case aerialAccept = "aerial.accept"
}
