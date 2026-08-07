import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// Deleting the account, from inside the app.
///
/// App Store Guideline 5.1.1(v) requires this, and `ios-distribution.md`
/// section 12 has carried it as the submission blocker. What Apple checks for
/// is not only that it exists but that it is reachable in a small number of
/// taps, states what is destroyed, and — for Sign in with Apple — revokes the
/// token rather than merely signing out.
@MainActor
@Observable
public final class DeleteAccountViewModel {
    public enum State: Equatable {
        case idle
        case loading
        /// A request is already pending and can still be withdrawn.
        case pending(AccountDeletion)
        case submitting
        /// Accepted. The local store is gone and the session is over.
        case done(AccountDeletion)
        case failed(message: String)
    }

    public private(set) var state: State = .idle
    /// Typed confirmation, so deletion cannot be a slip of the thumb.
    public var confirmationText: String = ""

    private let gateway: any AccountGateway
    private let strings: LocalizedStrings
    private let generateIdempotencyKey: @Sendable () -> String
    /// Everything this device holds for this profile — see
    /// `AppCompositionRoot`, which is the only place that knows all of it.
    private let tearDownLocalState: @MainActor () async -> Void

    public init(
        gateway: any AccountGateway,
        strings: LocalizedStrings,
        generateIdempotencyKey: @escaping @Sendable () -> String = UUIDv7.generate,
        tearDownLocalState: @escaping @MainActor () async -> Void
    ) {
        self.gateway = gateway
        self.strings = strings
        self.generateIdempotencyKey = generateIdempotencyKey
        self.tearDownLocalState = tearDownLocalState
    }

    // MARK: - Text

    public var title: String { strings(.deleteAccountTitle) }
    public var explanation: String { strings(.deleteAccountExplanation) }
    public var confirmationPrompt: String { strings(.deleteAccountConfirmPrompt) }
    /// The word somebody has to type. Localized, because asking a Russian
    /// reader to type an English word is a puzzle rather than a confirmation.
    public var confirmationWord: String { strings(.deleteAccountConfirmWord) }
    public var deleteButtonTitle: String { strings(.deleteAccountSubmit) }
    public var restoreButtonTitle: String { strings(.deleteAccountRestore) }
    public var pendingTitle: String { strings(.deleteAccountPendingTitle) }
    public var closeTitle: String { strings(.plantsClose) }

    public var isDeleteEnabled: Bool {
        confirmationText.trimmingCharacters(in: .whitespacesAndNewlines)
            .caseInsensitiveCompare(confirmationWord) == .orderedSame
    }

    /// What happens to each garden, stated before the deadline rather than
    /// reported after it.
    public func gardenSummary(_ garden: AccountDeletionGarden) -> String {
        switch garden.resolution {
        case .gardenDeletionRequested: strings(.deleteAccountGardenDeleted)
        case .ownershipRetainedByCoOwner: strings(.deleteAccountGardenKeptByCoOwner)
        case .membershipRevoked: strings(.deleteAccountGardenMembershipEnded)
        }
    }

    public func deadlineText(_ deletion: AccountDeletion) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        formatter.timeStyle = .short
        return formatter.string(from: deletion.recoveryDeadlineAt)
    }

    // MARK: - Commands

    public func load() async {
        state = .loading
        do {
            if let pending = try await gateway.getAccountDeletion() {
                state = .pending(pending)
            } else {
                state = .idle
            }
        } catch {
            state = .failed(message: message(for: error))
        }
    }

    public func requestDeletion() async {
        guard isDeleteEnabled else { return }
        state = .submitting
        do {
            let deletion = try await gateway.requestAccountDeletion(
                idempotencyKey: generateIdempotencyKey()
            )
            // Only after the server has accepted it. Tearing down first would
            // sign somebody out of an account that still exists, with no way
            // back to the screen that would have finished the job.
            await tearDownLocalState()
            state = .done(deletion)
        } catch {
            state = .failed(message: message(for: error))
        }
    }

    public func restore() async {
        state = .submitting
        do {
            try await gateway.restoreAccount(idempotencyKey: generateIdempotencyKey())
            state = .idle
        } catch {
            state = .failed(message: message(for: error))
        }
    }

    /// A stale session is the one failure with a real remedy, and it is not
    /// "try again" — it is "sign in again". Saying so is the difference
    /// between a person recovering and a person giving up.
    private func message(for error: Error) -> String {
        if let gatewayError = error as? APIGatewayError,
            case let .service(envelope, _, _) = gatewayError,
            envelope.code == "deletion.recent_authentication_required"
        {
            return strings(.deleteAccountReauthenticate)
        }
        return strings(.deleteAccountFailed)
    }
}
