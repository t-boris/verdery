import CoreDesignSystem
import CoreLocalization
import SwiftUI

/// A banner shown on garden open when the signed-in profile is the recipient
/// of a pending ownership transfer for THIS garden.
///
/// Placed at the top of the whole tab shell (`AppComposition.GardenTabView`),
/// not tucked inside Settings — the task this screen answers explicitly
/// prefers this: a reader who receives an ownership offer may have no reason
/// to open a garden's settings at all, while the tab shell is what they see
/// the moment they open the garden regardless of which tab they land on.
///
/// Shown for either of two independent reasons (``isShowing``): the last
/// successful poll of `listIncomingOwnershipTransfers` genuinely found a
/// pending transfer naming this garden (P9A-OWNER-02) — ordinary discovery,
/// requiring no deep link at all — or a `verdery://ownership-transfer` deep
/// link fired for this garden, an explicit fast path that does not wait on
/// the next poll. See ``CollaborationSessionState``'s own doc comment for
/// why both mechanisms coexist rather than one replacing the other, and
/// ``IncomingOwnershipTransferReviewViewModel`` for how the review sheet
/// re-validates against the server the moment the reader actually acts,
/// regardless of which of the two opened it.
public struct IncomingOwnershipTransferBanner: View {
    let sessionState: CollaborationSessionState
    let gardenId: String
    let strings: LocalizedStrings
    let makeReviewModel: () -> IncomingOwnershipTransferReviewViewModel

    @State private var isReviewPresented = false

    public init(
        sessionState: CollaborationSessionState,
        gardenId: String,
        strings: LocalizedStrings,
        makeReviewModel: @escaping () -> IncomingOwnershipTransferReviewViewModel
    ) {
        self.sessionState = sessionState
        self.gardenId = gardenId
        self.strings = strings
        self.makeReviewModel = makeReviewModel
    }

    /// True when either the deep-link fast path fired for this garden or the
    /// last successful poll found a real pending transfer here — see this
    /// type's own doc comment.
    private var isShowing: Bool {
        sessionState.hasIncomingTransferHint(gardenId: gardenId) || sessionState.incomingTransfer(gardenId: gardenId) != nil
    }

    public var body: some View {
        if isShowing {
            Button {
                isReviewPresented = true
            } label: {
                HStack(spacing: Metrics.space2) {
                    // A pending transfer is something that needs a decision but
                    // has broken nothing, which is exactly `warning`. It was
                    // `info`, a tone Field Console does not have: there is no
                    // blue, and a persistent full-width banner in the
                    // interaction orange would shout over every screen it sits
                    // above.
                    Image(systemName: CollaborationSymbols.ownershipTransfer)
                        .foregroundStyle(Palette.warning)
                    Text(strings(.collaborationOwnershipTransferRecipientBanner))
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.text)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: Metrics.space2)
                    Text(strings(.collaborationOwnershipTransferRecipientReview))
                        .font(FieldConsoleType.detail.font.weight(.semibold))
                        .foregroundStyle(Palette.warning)
                }
                .padding(.horizontal, Metrics.space4)
                .padding(.vertical, Metrics.space3)
                .frame(maxWidth: .infinity)
                .background(Palette.warningQuiet)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("gardens.incomingTransfer.banner")
            .sheet(isPresented: $isReviewPresented) {
                IncomingOwnershipTransferReviewView(model: makeReviewModel()) {
                    isReviewPresented = false
                }
            }
        }
    }
}
