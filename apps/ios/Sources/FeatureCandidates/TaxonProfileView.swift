import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The taxon catalog profile: reference imagery and reviewed facts about a
/// species (P11-IOS-01).
///
/// Every image carries its credit directly beneath it. That is not layout
/// preference — for a CC BY image the credit is the condition the licence was
/// granted under, so it is rendered whenever the server sent one and never
/// behind a disclosure.
public struct TaxonProfileView: View {
    @State private var model: TaxonProfileViewModel
    /// Reference images grow with the reader's text size: a picture pinned to
    /// a fixed size shrinks relative to everything around it as type scales up.
    @ScaledMetric(relativeTo: .body) private var imageWidth: CGFloat = 160
    @ScaledMetric(relativeTo: .body) private var imageHeight: CGFloat = 120

    public init(model: TaxonProfileViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch model.state.phase {
                case .loading:
                    Text(model.loadingLabel)
                        .foregroundStyle(.secondary)
                case .missing:
                    Text(model.missingLabel)
                        .foregroundStyle(.secondary)
                case let .failed(message):
                    Text(message)
                        .foregroundStyle(.secondary)
                case .loaded:
                    loadedContent
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .navigationTitle(model.title)
        .task { await model.load() }
    }

    @ViewBuilder
    private var loadedContent: some View {
        if !model.state.images.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(model.state.images) { image in
                        imageCard(image)
                    }
                }
            }
        }

        if model.state.isPartial {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.partialTitle).font(.headline)
                Text(model.partialLabel).foregroundStyle(.secondary)
            }
        }

        if model.state.facts.isEmpty {
            Text(model.noFactsLabel).foregroundStyle(.secondary)
        } else {
            ForEach(model.state.facts) { fact in
                VStack(alignment: .leading, spacing: 2) {
                    Text(fact.factKey).font(.subheadline.weight(.semibold))
                    Text(fact.unit.map { "\(fact.displayValue) \($0)" } ?? fact.displayValue)
                    Text(model.factSourceLabel(fact.providerKey))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func imageCard(_ image: TaxonImage) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            AsyncImage(url: image.sourceUrl) { phase in
                if let rendered = phase.image {
                    rendered.resizable().aspectRatio(contentMode: .fill)
                } else {
                    Color.secondary.opacity(0.15)
                }
            }
            .frame(width: imageWidth, height: imageHeight)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel(model.imageLabel(image))

            if let credit = model.imageCredit(image) {
                Text(credit)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(width: imageWidth, alignment: .leading)
            }
        }
    }
}
