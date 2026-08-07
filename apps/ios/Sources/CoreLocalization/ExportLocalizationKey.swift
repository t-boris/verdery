/// Taking a copy of your own data.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum ExportLocalizationKey: String, Sendable, CaseIterable {
    case exportTitle = "export.title"
    case exportOpen = "export.open"
    case exportExplanation = "export.explanation"
    case exportScopeLabel = "export.scopeLabel"
    case exportScopeAccount = "export.scopeAccount"
    case exportScopeGarden = "export.scopeGarden"
    case exportIncludeMedia = "export.includeMedia"
    case exportIncludeMediaHint = "export.includeMediaHint"
    case exportSubmit = "export.submit"
    case exportPreparing = "export.preparing"
    case exportReady = "export.ready"
    case exportDownload = "export.download"
    case exportExpires = "export.expires"
    case exportFailed = "export.failed"
    case exportAlreadyRunning = "export.alreadyRunning"
    case exportReauthenticate = "export.reauthenticate"
}
