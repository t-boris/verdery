import CoreDesignSystem
import CoreDomain
import CoreLocalization
import SwiftUI

/// A printable label for one plant.
///
/// The point is what happens weeks later. Somebody walks up to a rose to
/// record its third observation; instead of opening the app, finding the
/// plants list, searching a name they may not remember and scrolling past
/// forty others, they point their camera at the stake and tap the banner iOS
/// puts on screen. No in-app scanner is involved — the system camera already
/// offers to open a URL it recognises.
///
/// Possible at all because the plant's identifier is minted on this device
/// before anything is sent, so its address exists from the moment it does.
struct PlantLabelSheetView: View {
    private let link: PlantDeepLink
    private let plantName: String
    private let strings: LocalizedStrings
    private let close: () -> Void

    @ScaledSize(Metrics.space8, relativeTo: .largeTitle) private var codeSize

    init(
        link: PlantDeepLink,
        plantName: String,
        strings: LocalizedStrings,
        close: @escaping () -> Void
    ) {
        self.link = link
        self.plantName = plantName
        self.strings = strings
        self.close = close
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Metrics.space5) {
                    Text(plantName)
                        .font(FieldConsoleType.title.font)
                        .foregroundStyle(Palette.text)
                        .multilineTextAlignment(.center)

                    code

                    Text(strings(.plantLabelExplanation))
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                        .multilineTextAlignment(.center)

                    if let url = link.url {
                        ShareLink(item: url) {
                            Label(strings(.plantLabelShare), systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("plants.label.share")
                    }
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(strings(.plantLabelTitle))
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(strings(.plantsClose), action: close)
                }
            }
        }
    }

    @ViewBuilder
    private var code: some View {
        if let url = link.url, let image = QRCodeImage.generate(from: url.absoluteString) {
            image
                .resizable()
                .interpolation(.none)
                .scaledToFit()
                .frame(maxWidth: codeSize * 4)
                .padding(Metrics.space4)
                .background(
                    // White, not `surface`: a scanner reads contrast, and the
                    // dark palette's paper is not paper.
                    RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                        .fill(.white)
                )
                .accessibilityLabel(strings(.plantLabelCodeAlt))
                .accessibilityIdentifier("plants.label.code")
        } else {
            InlineMessage(strings(.plantLabelUnavailable), tone: .warning)
        }
    }
}
