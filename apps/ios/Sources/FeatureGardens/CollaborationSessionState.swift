import CoreDomain
import Foundation
import Observation

/// Session-scoped collaboration facts shared by every Collaborators-related
/// view model for the app's lifetime — constructed once, at the composition
/// root, the same "one instance across repeated screen visits" shape
/// `AppCompositionRoot.mediaUploadCoordinator` already uses, for the same
/// reason: a per-screen instance would forget these facts the moment the
/// screen that learned them closed.
///
/// 1. A `verdery://invite?token=` deep link (see `project.yml`'s
///    `CFBundleURLSchemes`) carries the one-time invitation token the reader
///    tapped, until the accept-invitation screen resolves it.
/// 2. A `verdery://ownership-transfer?gardenId=` deep link marks a garden as
///    having an EXPLICIT, IMMEDIATE fast-path signal of an incoming
///    ownership offer. Before P9A-OWNER-02 shipped `GET
///    /ownership-transfers/incoming`, this hint was the ONLY way this app
///    could learn a transfer was pending at all, so it doubled as the sole
///    source of truth. It no longer needs to: ``incomingTransfers`` below is
///    real, polled server truth. This hint is kept anyway, purely as a fast
///    path — a shared link should open the review sheet the instant it is
///    tapped, without waiting for the next poll — not as a second copy of
///    the same fact. `IncomingOwnershipTransferReviewViewModel` re-validates
///    against the server the moment the reader actually acts regardless of
///    which path opened its sheet, so a stale or wrong hint can never
///    mislead beyond opening a sheet that then reports the offer is gone.
/// 3. ``incomingTransfers``: every PENDING transfer addressed to the
///    signed-in profile, across every garden, as of the last successful
///    poll of `listIncomingOwnershipTransfers` (P9A-OWNER-02) — refreshed on
///    the same app-foreground trigger
///    `architecture/ios-application-design.md` section "8. Synchronization
///    Integration" already establishes for synchronization (see
///    `RootView.triggerSyncOnForeground`), plus once when a garden's own
///    shell first appears (`GardenTabView`), so opening a garden reflects an
///    offer immediately rather than waiting for the next foregrounding.
///
/// A garden's own OUTGOING pending transfer (the initiator's side) is NOT
/// tracked here: `CollaboratorsViewModel` now reads that from
/// `getGardenOwnershipTransfer` directly (P9A-OWNER-02) rather than from a
/// second, session-scoped cache seeded only from the last mutation's own
/// response — the same simplification this type's own point 2 above
/// describes, applied to the initiator's side instead of the recipient's.
///
/// Source: docs/architecture/identity-and-authorization.md, section
/// "11. Ownership Transfer"; implementation-plan.md work packages
/// P9A-IOS-01, P9A-OWNER-02.
@MainActor
@Observable
public final class CollaborationSessionState {
    /// The custom URL scheme this app registers for its own deep links —
    /// distinct from the Google Sign-In redirect scheme, which is reserved
    /// entirely to that SDK. See `project.yml`'s `CFBundleURLTypes`.
    public static let scheme = "verdery"

    public private(set) var pendingInvitationToken: String?
    public private(set) var incomingTransfers: [IncomingGardenOwnershipTransfer] = []

    private var incomingTransferHintGardenIds: Set<String> = []

    public init() {}

    /// Recognizes and applies one of this app's own deep links. Returns
    /// `false` for anything else, so callers (`AppCompositionRoot
    /// .handleIncomingURL`) can fall through to other handlers, matching
    /// every other participant in that same chain.
    @discardableResult
    public func handleDeepLink(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == Self.scheme else { return false }

        let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? {
            queryItems.first(where: { $0.name == name })?.value
        }

        switch url.host {
        case "invite":
            guard let token = value("token"), !token.isEmpty else { return false }
            pendingInvitationToken = token
            return true

        case "ownership-transfer":
            guard let gardenId = value("gardenId"), !gardenId.isEmpty else { return false }
            incomingTransferHintGardenIds.insert(gardenId)
            return true

        default:
            return false
        }
    }

    /// Called once the accept-invitation screen has resolved (accepted,
    /// failed, or was dismissed) so a stale token cannot be re-processed.
    public func clearPendingInvitation() {
        pendingInvitationToken = nil
    }

    public func hasIncomingTransferHint(gardenId: String) -> Bool {
        incomingTransferHintGardenIds.contains(gardenId)
    }

    /// Called once the recipient's review sheet resolves the offer —
    /// accepted, declined, or found already stale — so the banner that hint
    /// drives stops showing.
    public func clearIncomingTransferHint(gardenId: String) {
        incomingTransferHintGardenIds.remove(gardenId)
    }

    /// Replaces the cached incoming-transfer list wholesale — the natural
    /// shape for a poll: whatever `listIncomingOwnershipTransfers` returned
    /// on its last successful call, entirely superseding whatever this held
    /// before.
    public func setIncomingTransfers(_ transfers: [IncomingGardenOwnershipTransfer]) {
        incomingTransfers = transfers
    }

    /// The real, server-confirmed offer for this garden, if the most recent
    /// poll found one. `nil` either because there genuinely is none or
    /// because no poll has completed yet — see ``hasIncomingTransferHint(gardenId:)``
    /// for the immediate deep-link fast path that does not wait on a poll.
    public func incomingTransfer(gardenId: String) -> IncomingGardenOwnershipTransfer? {
        incomingTransfers.first { $0.transfer.gardenId == gardenId }
    }
}
