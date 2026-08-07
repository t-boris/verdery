import CoreDesignSystem
import CoreDomain
import CoreLocalization
import SwiftUI

/// What a walk produced, shown when the capture surface closes.
///
/// Four separate numbers rather than a percentage, deliberately: "12
/// photographed · 9 identified · 3 need you · 4 still uploading" answers both
/// questions somebody has after a walk — is my work safe, and what is left for
/// me — and a single progress figure answers neither.
///
/// It is also where the review stack is entered from, because "3 need you" is
/// only useful if it is a door.
public struct CaptureRunSummaryView: View {
    private let summary: CaptureRun.Summary
    private let strings: LocalizedStrings
    private let review: (() -> Void)?
    private let keepWalking: () -> Void

    public init(
        summary: CaptureRun.Summary,
        strings: LocalizedStrings,
        review: (() -> Void)?,
        keepWalking: @escaping () -> Void
    ) {
        self.summary = summary
        self.strings = strings
        self.review = review
        self.keepWalking = keepWalking
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            SectionEyebrow(symbol: "figure.walk", title: strings(.runSummaryTitle))

            ReadingGrid(cells: cells)
                .accessibilityIdentifier("run.summary")

            if summary.isComplete {
                // Nothing is waiting for the person or the network, and saying
                // so is the whole point of the screen.
                InlineMessage(strings(.runAllDone), tone: .positive)
                    .accessibilityIdentifier("run.allDone")
            }

            VStack(spacing: Metrics.space2) {
                if summary.awaitingReview > 0, let review {
                    Button(strings(.runReviewNow), action: review)
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("run.review")
                }
                Button(strings(.runKeepWalking), action: keepWalking)
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("run.keepWalking")
            }
        }
        .padding(Metrics.space4)
    }

    /// Every count is drawn, including the zeroes. A grid that hid "0 failed"
    /// would make the absence of a failure indistinguishable from not having
    /// looked, which is the same rule the conditions panel follows.
    private var cells: [ReadingCell] {
        [
            cell("camera", .runCaptured, summary.captured),
            cell("checkmark.seal", .runResolved, summary.resolved),
            cell("hand.raised", .runAwaiting, summary.awaitingReview),
            cell("arrow.up.circle", .runUploading, summary.stillUploading),
            cell("exclamationmark.triangle", .runFailed, summary.failed),
        ]
    }

    private func cell(
        _ symbol: String,
        _ key: IdentificationReviewLocalizationKey,
        _ count: Int
    ) -> ReadingCell {
        ReadingCell(
            id: key.rawValue,
            symbol: symbol,
            label: strings(key),
            value: String(count),
            // A zero here is a measured zero, not a missing one, so it is
            // styled as a number rather than as prose.
            isMissing: false
        )
    }
}
