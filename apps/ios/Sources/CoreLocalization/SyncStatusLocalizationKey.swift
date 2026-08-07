/// The five words the console's status strip can say.
///
/// One word each, because the strip is 24 points tall and is read at a glance
/// while someone is doing something else. The sentence that explains a state
/// belongs to the sync sheet the strip opens, not to the strip.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum SyncStatusLocalizationKey: String, Sendable, CaseIterable {
    case syncStatusSynced = "syncStatus.synced"
    case syncStatusSyncing = "syncStatus.syncing"
    case syncStatusSavedLocally = "syncStatus.savedLocally"
    case syncStatusOffline = "syncStatus.offline"
    case syncStatusRequiresAttention = "syncStatus.requiresAttention"
}
