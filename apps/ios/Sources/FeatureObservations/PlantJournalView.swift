import CoreDesignSystem
import CoreDomain
import SwiftUI

/// A plant's photographs in observed order, oldest first, narrowable to one
/// shot purpose (P11-MEDIA-01).
///
/// A horizontal strip rather than a grid: the frames are a sequence, and
/// reading two of them against each other depends on the order staying one
/// continuous line. Tapping a frame opens it full-size, the same affordance
/// `FeaturePlants.PlantPhotoGalleryView` already gives its thumbnails.
public struct PlantJournalView: View {
    @State private var model: PlantJournalViewModel
    @State private var selectedFrame: PlantJournalDisplayFrame?

    /// The frame's fixed square size, scaled with the reader's text size — the
    /// `@ScaledMetric` rule `AccessibilityConventionTests` enforces on every
    /// literal dimension in this codebase.
    @ScaledMetric(relativeTo: .body) private var frameSize: CGFloat = 120

    public init(model: PlantJournalViewModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            Picker(model.purposeFilterLabel, selection: $model.purpose) {
                Text(model.allPurposesTitle).tag(ObservationPhotoPurpose?.none)
                ForEach(ObservationPhotoPurpose.allCases, id: \.self) { purpose in
                    Text(model.purposeName(purpose)).tag(ObservationPhotoPurpose?.some(purpose))
                }
            }
            .accessibilityIdentifier("observations.journal.purposePicker")

            if model.isLoading {
                ProgressView()
            } else if model.frames.isEmpty {
                InlineMessage(model.emptyMessage, tone: .info)
                    .accessibilityIdentifier("observations.journal.empty")
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Metrics.space2) {
                        ForEach(model.frames) { frame in
                            Button {
                                selectedFrame = frame
                            } label: {
                                thumbnail(frame)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(model.frameLabel(frame.frame))
                            .accessibilityIdentifier("observations.journal.frame")
                        }
                    }
                    .padding(.vertical, Metrics.space1)
                }
                .accessibilityIdentifier("observations.journal.sequence")
            }
        }
        .padding(Metrics.space4)
        .navigationTitle(model.title)
        .task { await model.load() }
        .sheet(item: $selectedFrame) { frame in
            AsyncImage(url: frame.url) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                ProgressView()
            }
            .padding(Metrics.space4)
        }
    }

    private func thumbnail(_ frame: PlantJournalDisplayFrame) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            AsyncImage(url: frame.url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                // Same box as the loaded image, so the sequence does not
                // reflow as signed URLs resolve one by one.
                Rectangle().fill(Tone.accent.quietFill)
            }
            .frame(width: frameSize, height: frameSize)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous))

            Text(ObservationsLocalization.formattedObservedAt(frame.frame.observedAt))
                .font(Typography.detail)
                .foregroundStyle(Palette.textMuted)
        }
    }
}
