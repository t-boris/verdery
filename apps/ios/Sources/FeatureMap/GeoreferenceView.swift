import CoreDesignSystem
import CoreDomain
import SwiftUI

/// Placing a garden on the Earth.
///
/// Three ways in, offered side by side rather than as a wizard, because they
/// are not steps: somebody standing in the garden uses the first, somebody at a
/// desk uses the second, and somebody whose address the geocoder does not know
/// uses the third. Whichever produced the anchor, the same summary and the same
/// north dial follow it.
public struct GeoreferenceView: View {
    @State private var model: GeoreferenceViewModel
    private let close: () -> Void

    public init(model: GeoreferenceViewModel, close: @escaping () -> Void) {
        _model = State(wrappedValue: model)
        self.close = close
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    SurfaceCard {
                        // Said before anybody worries: moving the anchor
                        // re-projects where the garden is drawn, and never
                        // moves the metres between two beds.
                        Text(model.explanation)
                            .font(FieldConsoleType.body.font)
                            .foregroundStyle(Palette.text)
                    }

                    if model.showsReplaceWarning {
                        InlineMessage(model.replaceWarning, tone: .warning)
                            .accessibilityIdentifier("georeference.replaceWarning")
                    }

                    deviceSection
                    addressSection
                    pinSection
                    anchorSummary
                    northSection
                    saveSection
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.closeTitle, action: close)
                }
            }
        }
    }

    // MARK: - The three ways in

    private var deviceSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Button(model.useMyLocationTitle) {
                Task { await model.useDeviceLocation() }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(model.isLocating)
            .accessibilityIdentifier("georeference.useMyLocation")

            if model.isLocating {
                Text(model.locatingText)
                    .font(FieldConsoleType.secondary.font)
                    .foregroundStyle(Palette.textMuted)
            }
            if model.isLocationDenied {
                // Not a nag: the other two ways in are unaffected, and the
                // sentence says so instead of implying a dead end.
                InlineMessage(model.locationDeniedText, tone: .neutral)
                    .accessibilityIdentifier("georeference.locationDenied")
            }
        }
    }

    private var addressSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SearchStrip(
                accessibilityName: model.searchLabel,
                placeholder: model.searchLabel,
                clearLabel: model.closeTitle,
                query: $model.query,
                search: { _ in await model.search() }
            )
            .accessibilityIdentifier("georeference.search")

            Text(model.searchHint)
                .font(FieldConsoleType.detail.font)
                .foregroundStyle(Palette.textMuted)

            searchResults
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        switch model.searchState {
        case .idle:
            EmptyView()

        case .searching:
            LoadingStateView(model.searchLabel)
                .accessibilityIdentifier("georeference.searching")

        case .noMatches:
            // A real answer about the address.
            InlineMessage(model.noCandidatesText, tone: .neutral)
                .accessibilityIdentifier("georeference.noMatches")

        case .providerUnavailable:
            // Not an answer about the address at all, and worded so that
            // nobody rewrites an address that was right.
            InlineMessage(model.providerUnavailableText, tone: .warning)
                .accessibilityIdentifier("georeference.providerUnavailable")

        case let .results(candidates):
            VStack(spacing: Metrics.space2) {
                ForEach(candidates) { candidate in
                    Button {
                        model.accept(candidate)
                    } label: {
                        SurfaceCard {
                            HStack(spacing: Metrics.space3) {
                                IconMedallion(
                                    symbol: "mappin.and.ellipse",
                                    label: candidate.formattedAddress
                                )
                                VStack(alignment: .leading, spacing: Metrics.space1) {
                                    Text(candidate.formattedAddress)
                                        .font(FieldConsoleType.bodyStrong.font)
                                        .foregroundStyle(Palette.text)
                                        .multilineTextAlignment(.leading)
                                    // How exactly the provider claims to have
                                    // located it — a roof, a street, or a town
                                    // — because accepting a town centre
                                    // believing it is your roof is the failure
                                    // this line prevents.
                                    Text(model.precisionName(candidate.precision))
                                        .font(FieldConsoleType.secondary.font)
                                        .foregroundStyle(Palette.textMuted)
                                }
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("georeference.candidate")
                }
            }
        }
    }

    private var pinSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "scope", title: model.dropPinTitle)
            Text(model.dropPinHint)
                .font(FieldConsoleType.detail.font)
                .foregroundStyle(Palette.textMuted)
            GeoreferencePinMap(initialAnchor: model.draft.geographicAnchor) { position in
                model.placePin(at: position)
            }
            .accessibilityIdentifier("georeference.pinMap")
        }
    }

    // MARK: - What was chosen

    @ViewBuilder
    private var anchorSummary: some View {
        if let anchorText = model.anchorText {
            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    labelledValue(model.anchorLabel, anchorText)
                    // Absent means "not expressed", never "exact" — a pin
                    // claims no accuracy and this says so rather than showing
                    // a reassuring blank.
                    labelledValue(model.accuracyLabel, model.accuracyText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityIdentifier("georeference.anchor")
        } else {
            InlineMessage(model.notSetText, tone: .neutral)
                .accessibilityIdentifier("georeference.notSet")
        }
    }

    /// A label over its value, in mono, so a column of coordinates lines up
    /// on its digits.
    private func labelledValue(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .textCase(.uppercase)
                .font(FieldConsoleType.label.font)
                .foregroundStyle(Palette.textMuted)
            Text(value)
                .font(FieldConsoleType.monoStrong.font)
                .foregroundStyle(Palette.text)
        }
        .accessibilityElement(children: .combine)
    }

    private var northSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            CompassDial(
                fieldName: model.northLabel,
                valueText: model.rotationText,
                degrees: Binding(
                    get: { model.draft.normalizedRotationDegrees },
                    set: { model.setRotation($0) }
                )
            )
            .accessibilityIdentifier("georeference.north")

            Text(model.northHint)
                .font(FieldConsoleType.detail.font)
                .foregroundStyle(Palette.textMuted)

            Button(model.useDeviceHeadingTitle) {
                Task { await model.proposeDeviceHeading() }
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("georeference.useHeading")

            if model.proposedHeadingDegrees != nil {
                // Proposed evidence, never applied on its own: a phone in a
                // pocket near a fence produces confident nonsense, so a person
                // accepts it or does not.
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    InlineMessage(model.headingProposedText, tone: .neutral)
                    Button(model.useThisPointTitle) { model.acceptProposedHeading() }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("georeference.acceptHeading")
                }
            }
        }
    }

    private var saveSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Button(model.saveTitle) {
                Task {
                    if await model.save() { close() }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.canSave)
            .accessibilityIdentifier("georeference.save")

            if let message = model.failureMessage {
                InlineMessage(message)
                    .accessibilityIdentifier("georeference.failure")
            } else if let message = model.statusMessage {
                InlineMessage(message, tone: .positive)
                    .accessibilityIdentifier("georeference.saved")
            }
        }
    }
}
