import CoreLocalization
import CoreNetworking
import Observation

/// View model for the accept-invitation screen — the landing page a
/// `verdery://invite?token=` deep link opens into.
///
/// `acceptInvitation` is already idempotent and folds "the caller already
/// has active membership" into an ordinary `200` success — the contract's
/// own description: "returns it unchanged, `200`, no error." That case is
/// therefore indistinguishable from a fresh acceptance here, and is not
/// treated as a separate state: both simply succeed. Every OTHER case the
/// contract documents (expired/revoked, already accepted by someone else,
/// email-binding mismatch) is a genuine, distinguishable failure this view
/// model reports plainly rather than folding into one generic message.
///
/// Source: implementation-plan.md work package P9A-IOS-01;
/// architecture/identity-and-authorization.md, section "10. Invitations".
@MainActor
@Observable
public final class AcceptInvitationViewModel {
    public enum AcceptState: Equatable, Sendable {
        case accepting
        case succeeded(gardenId: String, gardenName: String)
        case failed(message: String)
    }

    public private(set) var state: AcceptState = .accepting

    private let token: String
    private let acceptInvitation: AcceptGardenInvitation
    private let getGarden: GetGarden
    private let strings: LocalizedStrings

    public init(
        token: String,
        acceptInvitation: AcceptGardenInvitation,
        getGarden: GetGarden,
        strings: LocalizedStrings
    ) {
        self.token = token
        self.acceptInvitation = acceptInvitation
        self.getGarden = getGarden
        self.strings = strings
    }

    public var title: String { strings(.collaborationAcceptInvitationTitle) }
    public var loadingMessage: String { strings(.collaborationAcceptInvitationLoading) }
    public var openGardenTitle: String { strings(.collaborationAcceptInvitationOpenGarden) }
    public var closeTitle: String { strings(.collaborationAcceptInvitationClose) }

    public func successMessage(gardenName: String) -> String {
        strings.string(.collaborationAcceptInvitationSuccess, parameters: ["garden": gardenName])
    }

    public func accept() async {
        state = .accepting

        do {
            let member = try await acceptInvitation(token: token)
            let garden = try await getGarden(gardenId: member.gardenId)
            state = .succeeded(gardenId: garden.id, gardenName: garden.name)
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    private func message(for error: APIGatewayError) -> String {
        if case let .service(body, _, _) = error {
            switch body.code {
            case InvitationErrorCode.expired, InvitationErrorCode.revoked:
                return strings(.collaborationAcceptInvitationExpiredOrRevoked)
            case InvitationErrorCode.alreadyAccepted:
                return strings(.collaborationAcceptInvitationAlreadyAccepted)
            case InvitationErrorCode.emailMismatch:
                return strings(.collaborationAcceptInvitationEmailMismatch)
            default:
                break
            }
        }

        if case .transport = error {
            return strings(.networkUnreachable)
        }

        return strings(.collaborationAcceptInvitationGenericFailure)
    }
}

/// The invitation-specific error codes `acceptInvitation` can raise —
/// mirroring `@verdery/api-contracts`' `CollaborationErrorCode` exactly.
private enum InvitationErrorCode {
    static let expired = "collaboration.invitation.expired"
    static let revoked = "collaboration.invitation.revoked"
    static let alreadyAccepted = "collaboration.invitation.already_accepted"
    static let emailMismatch = "collaboration.invitation.email_mismatch"
}
