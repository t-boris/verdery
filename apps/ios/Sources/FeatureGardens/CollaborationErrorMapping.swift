import CoreLocalization
import CoreNetworking

/// The domain-local error codes `CollaborationGateway` calls can raise,
/// mirroring `@verdery/api-contracts`' `CollaborationErrorCode` exactly — a
/// mismatch here would make this client silently stop recognizing one of
/// these failures.
///
/// Source: packages/api-contracts/src/index.ts, `CollaborationErrorCode`.
enum CollaborationErrorCode {
    static let membershipNotFound = "collaboration.membership.not_found"
    static let lastOwnerRequired = "collaboration.membership.last_owner_required"
    static let ownerRoleNotAllowed = "collaboration.membership.owner_role_not_allowed"
    static let invitationAlreadyPending = "collaboration.invitation.already_pending"
    static let recentAuthenticationRequired = "collaboration.membership.recent_authentication_required"
    static let targetNotOwner = "collaboration.membership.target_not_owner"
    static let targetAlreadyOwner = "collaboration.membership.target_already_owner"
    static let transferAlreadyPending = "collaboration.ownership_transfer.already_pending"
    static let transferNotFound = "collaboration.ownership_transfer.not_found"
}

/// Shared mapping from a collaboration-scoped `APIGatewayError` to a
/// localized, user-facing message.
///
/// Used by `CollaboratorsViewModel` and `IncomingOwnershipTransferReviewViewModel`.
/// `AcceptInvitationViewModel` does NOT use this: `acceptInvitation`'s own
/// idempotency cases (already-member, expired/revoked, already-accepted,
/// email-binding mismatch) are a distinct, richer vocabulary the contract
/// asks to be surfaced "each distinguishably" — see that view model's own
/// error mapping instead.
enum CollaborationErrorMessage {
    static func generic(for error: APIGatewayError, strings: LocalizedStrings) -> String {
        if case let .service(body, _, _) = error, let specific = specificMessage(for: body.code, strings: strings) {
            return specific
        }

        switch error {
        case .transport:
            return strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            return strings(.serverUnexpected)
        }
    }

    private static func specificMessage(for code: String, strings: LocalizedStrings) -> String? {
        switch code {
        case CollaborationErrorCode.recentAuthenticationRequired:
            strings(.collaborationErrorRecentAuthRequired)
        case CollaborationErrorCode.lastOwnerRequired:
            strings(.collaborationErrorLastOwnerRequired)
        case CollaborationErrorCode.targetNotOwner:
            strings(.collaborationErrorTargetNotOwner)
        case CollaborationErrorCode.targetAlreadyOwner:
            strings(.collaborationErrorTargetAlreadyOwner)
        case CollaborationErrorCode.ownerRoleNotAllowed:
            strings(.collaborationErrorOwnerRoleNotAllowed)
        case CollaborationErrorCode.invitationAlreadyPending:
            strings(.collaborationErrorInvitationAlreadyPending)
        case CollaborationErrorCode.transferAlreadyPending:
            strings(.collaborationErrorTransferAlreadyPending)
        case CollaborationErrorCode.membershipNotFound, CollaborationErrorCode.transferNotFound:
            strings(.collaborationErrorNotFound)
        default:
            nil
        }
    }
}
