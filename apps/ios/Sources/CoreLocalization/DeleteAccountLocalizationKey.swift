/// The in-app account-deletion screen (App Store Guideline 5.1.1(v)).
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum DeleteAccountLocalizationKey: String, Sendable, CaseIterable {
    case deleteAccountTitle = "deleteAccount.title"
    case deleteAccountExplanation = "deleteAccount.explanation"
    case deleteAccountConfirmPrompt = "deleteAccount.confirmPrompt"
    case deleteAccountConfirmWord = "deleteAccount.confirmWord"
    case deleteAccountSubmit = "deleteAccount.submit"
    case deleteAccountRestore = "deleteAccount.restore"
    case deleteAccountPendingTitle = "deleteAccount.pendingTitle"
    case deleteAccountDeadline = "deleteAccount.deadline"
    case deleteAccountGardenDeleted = "deleteAccount.gardenDeleted"
    case deleteAccountGardenKeptByCoOwner = "deleteAccount.gardenKeptByCoOwner"
    case deleteAccountGardenMembershipEnded = "deleteAccount.gardenMembershipEnded"
    case deleteAccountReauthenticate = "deleteAccount.reauthenticate"
    case deleteAccountFailed = "deleteAccount.failed"
    case deleteAccountDone = "deleteAccount.done"
    case deleteAccountOpen = "deleteAccount.open"
}
