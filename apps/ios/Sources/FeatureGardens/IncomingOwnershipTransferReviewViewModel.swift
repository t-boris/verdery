import CoreLocalization
import CoreNetworking
import Observation

/// View model for the recipient's side of a pending ownership transfer:
/// accept, decline, or leave it for later.
///
/// This screen does not itself call `getGardenOwnershipTransfer` (P9A-OWNER-02)
/// before presenting: the banner that opens it already required either a
/// real poll match or an explicit deep link (see
/// ``IncomingOwnershipTransferBanner``'s own doc comment), so by the time
/// this sheet opens the offer is usually still genuinely there, and an extra
/// round trip would only delay showing the accept/decline choice for no
/// benefit `accept()`/`decline()` do not already provide. Both of those
/// RE-VALIDATE against the server atomically as part of their own mutation
/// regardless, so `accept()` and `decline()` remain the moment this app
/// authoritatively confirms whether the offer is still pending — a
/// `collaboration.ownership_transfer.not_found` response is therefore not a
/// bug: it means the transfer already resolved some other way (the
/// initiator cancelled it, or another recipient path is not possible here
/// since transfers name exactly one recipient) while the banner's own signal
/// (hint or stale poll result) stayed around, and is reported to the reader
/// as plainly as a genuine accept/decline outcome — see ``ReviewState``.
///
/// Source: implementation-plan.md work package P9A-IOS-01;
/// architecture/identity-and-authorization.md, section "11. Ownership Transfer".
@MainActor
@Observable
public final class IncomingOwnershipTransferReviewViewModel {
    public enum ReviewState: Equatable, Sendable {
        case reviewing
        case submitting
        case resolved(message: String, isSuccess: Bool)
    }

    public private(set) var state: ReviewState = .reviewing

    public let gardenId: String
    public let gardenName: String

    private let acceptTransfer: AcceptGardenOwnershipTransfer
    private let declineTransfer: DeclineGardenOwnershipTransfer
    private let sessionState: CollaborationSessionState
    private let strings: LocalizedStrings

    public init(
        gardenId: String,
        gardenName: String,
        acceptTransfer: AcceptGardenOwnershipTransfer,
        declineTransfer: DeclineGardenOwnershipTransfer,
        sessionState: CollaborationSessionState,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.gardenName = gardenName
        self.acceptTransfer = acceptTransfer
        self.declineTransfer = declineTransfer
        self.sessionState = sessionState
        self.strings = strings
    }

    public var title: String { strings(.collaborationOwnershipTransferRecipientTitle) }
    public var message: String {
        strings.string(.collaborationOwnershipTransferRecipientMessage, parameters: ["garden": gardenName])
    }
    public var acceptTitle: String { strings(.collaborationOwnershipTransferRecipientAccept) }
    public var declineTitle: String { strings(.collaborationOwnershipTransferRecipientDecline) }
    public var notNowTitle: String { strings(.collaborationOwnershipTransferRecipientNotNow) }

    public var isSubmitting: Bool {
        if case .submitting = state { return true }
        return false
    }

    public var resolvedMessage: String? {
        if case let .resolved(message, _) = state { return message }
        return nil
    }

    public func accept() async {
        state = .submitting
        do {
            _ = try await acceptTransfer(gardenId: gardenId)
            sessionState.clearIncomingTransferHint(gardenId: gardenId)
            state = .resolved(message: strings(.collaborationOwnershipTransferRecipientAcceptedMessage), isSuccess: true)
        } catch {
            resolve(failure: error)
        }
    }

    public func decline() async {
        state = .submitting
        do {
            _ = try await declineTransfer(gardenId: gardenId)
            sessionState.clearIncomingTransferHint(gardenId: gardenId)
            state = .resolved(message: strings(.collaborationOwnershipTransferRecipientDeclinedMessage), isSuccess: true)
        } catch {
            resolve(failure: error)
        }
    }

    private func resolve(failure error: Error) {
        guard let error = error as? APIGatewayError else {
            state = .resolved(message: strings(.serverUnexpected), isSuccess: false)
            return
        }

        // Every one of these means the offer's premise no longer holds —
        // resolved outright (`transferNotFound`), or re-validated at
        // acceptance time and found stale (`membershipNotFound`: the
        // caller's own membership changed; `targetNotOwner`/
        // `targetAlreadyOwner`: the initiator's own role changed while this
        // stayed pending). `acceptOwnershipTransfer`'s own contract
        // description: "Any such failure leaves everything exactly as it
        // was" — the honest reader-facing consequence is the same "this
        // offer is no longer available" message regardless of which one
        // fired, and the locally-remembered hint stops driving the banner
        // either way.
        let staleCodes: Set<String> = [
            CollaborationErrorCode.transferNotFound,
            CollaborationErrorCode.membershipNotFound,
            CollaborationErrorCode.targetNotOwner,
            CollaborationErrorCode.targetAlreadyOwner,
        ]
        if case let .service(body, _, _) = error, staleCodes.contains(body.code) {
            sessionState.clearIncomingTransferHint(gardenId: gardenId)
            state = .resolved(message: strings(.collaborationOwnershipTransferRecipientStaleMessage), isSuccess: false)
            return
        }

        state = .resolved(message: CollaborationErrorMessage.generic(for: error, strings: strings), isSuccess: false)
    }
}
