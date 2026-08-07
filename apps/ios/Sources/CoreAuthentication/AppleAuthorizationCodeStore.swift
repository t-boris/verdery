import Foundation
import Security

/// Keeps the Apple authorization code from sign-in until account deletion
/// needs it.
///
/// Apple requires an app that offers Sign in with Apple to *revoke* the token
/// when the account is deleted, not merely to sign out —
/// `docs/development/ios-distribution.md` section 10.5 records that Apple
/// checks for this specifically. `Auth.auth().revokeToken(withAuthorizationCode:)`
/// needs the code Apple issued at authorization, and Apple issues it once.
///
/// This is the non-obvious prerequisite that would otherwise be discovered at
/// review time: the sign-in flow read only the identity token and let the code
/// go, so by the time somebody asked to delete their account there was nothing
/// left to revoke with.
///
/// The Keychain rather than `UserDefaults`: this is a credential.
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` matches what it is for —
/// available to a background launch after the device has been unlocked once,
/// never synced to another device, and gone when this one is erased.
public struct AppleAuthorizationCodeStore: Sendable {
    private let service = "com.verdery.app.apple-authorization-code"
    private let account = "current"

    public init() {}

    public func save(_ code: String) {
        // Delete-then-add rather than update: a code from a previous account
        // on this device must not survive a re-authorization as somebody else.
        remove()

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(code.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    public func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        guard
            SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
            let data = item as? Data
        else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    /// Called on sign-out and after a successful revocation. A code left
    /// behind is a credential outliving the session it belonged to.
    public func remove() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
