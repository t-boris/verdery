import CoreDesignSystem
import CoreDomain
import SwiftUI

/// What the drawing says, for a person to check against the drawing.
///
/// The screen's whole job is to make the reading checkable. So the two areas
/// sit side by side with a sentence about whether they agree; the closure error
/// is a number in metres rather than a verdict; each boundary call is printed
/// the way the sheet prints it, so comparing a line against the paper is
/// comparing the same characters; and the one side whose direction was inferred
/// says so.
///
/// **Nothing here writes.** What is ticked becomes ordinary commands afterwards
/// — a georeference, then map commands — each with its own authorization and
/// audit trail. That is ADR-0018 as behaviour rather than as a comment.
public struct PlatReadingView: View {
    @State private var model: PlatReadingViewModel
    private let accept: (PlatReadingViewModel.Acceptance) -> Void
    private let close: () -> Void

    public init(
        model: PlatReadingViewModel,
        accept: @escaping (PlatReadingViewModel.Acceptance) -> Void,
        close: @escaping () -> Void
    ) {
        _model = State(wrappedValue: model)
        self.accept = accept
        self.close = close
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    SurfaceCard {
                        Text(model.explanation)
                            .font(FieldConsoleType.body.font)
                            .foregroundStyle(Palette.text)
                    }
                    content
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
            .task { await model.read() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle, .reading:
            LoadingStateView(model.readingMessage)
                .accessibilityIdentifier("plat.reading")

        case .notAPlat:
            // A real answer, and the drawing is still useful as a backdrop.
            InlineMessage(model.notAPlatMessage, tone: .neutral)
                .accessibilityIdentifier("plat.notAPlat")

        case let .failed(message):
            FailureStateView(message: message, retryTitle: nil, retry: nil)
                .accessibilityIdentifier("plat.failure")

        case let .reviewing(reading):
            VStack(alignment: .leading, spacing: Metrics.space5) {
                closureSection(reading)
                areaSection(reading)
                locationSection(reading)
                callsSection(reading)
                objectsSection(reading)
                acceptSection
            }
        }
    }

    // MARK: - Is it trustworthy?

    @ViewBuilder
    private func closureSection(_ reading: PlatReading) -> some View {
        if let boundary = reading.boundary {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                // The number, not a verdict. A misread bearing shows up here as
                // a gap in metres rather than as a plausible wrong shape, and
                // the metres are what a surveyor would ask for.
                ReadingGrid(cells: [
                    ReadingCell(
                        id: "closure",
                        symbol: "arrow.triangle.merge",
                        label: model.closureLabel,
                        value: model.closureText(boundary.closureErrorMetres),
                        isMissing: false
                    ),
                    ReadingCell(
                        id: "pageFit",
                        symbol: "square.on.square",
                        label: model.pageFitLabel,
                        value: reading.pageFitResidualMetres.map(model.pageFitText) ?? "—",
                        isMissing: reading.pageFitResidualMetres == nil
                    ),
                ])

                if boundary.closes {
                    InlineMessage(model.closesTitle, tone: .positive)
                        .accessibilityIdentifier("plat.closes")
                } else {
                    InlineMessage(model.doesNotCloseMessage, tone: .negative)
                        .accessibilityIdentifier("plat.doesNotClose")
                }

                if let recovered = boundary.recoveredBearing {
                    // The one side whose direction was inferred rather than
                    // read. A reviewer is entitled to know which.
                    InlineMessage(model.recoveredBearingText(recovered), tone: .warning)
                        .accessibilityIdentifier("plat.recoveredBearing")
                }
            }
        }
    }

    @ViewBuilder
    private func areaSection(_ reading: PlatReading) -> some View {
        if let boundary = reading.boundary, let stated = reading.statedAreaSquareFeet {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                ReadingGrid(cells: [
                    ReadingCell(
                        id: "stated",
                        symbol: "doc.text",
                        label: model.statedAreaLabel,
                        // Converted here, not by the reader: comparing 1000 ft²
                        // against 92.9 m² in your head is not a check.
                        value: model.statedAreaText(stated),
                        isMissing: false
                    ),
                    ReadingCell(
                        id: "walked",
                        symbol: "figure.walk",
                        label: model.walkedAreaLabel,
                        value: model.areaText(boundary.areaSquareMetres),
                        isMissing: false
                    ),
                ])

                InlineMessage(
                    model.areaAgreementText(reading),
                    tone: model.areaAgrees(reading) ? .positive : .warning
                )
                .accessibilityIdentifier("plat.areaAgreement")
            }
        }
    }

    @ViewBuilder
    private func locationSection(_ reading: PlatReading) -> some View {
        if reading.address != nil || reading.northRotationDegrees != nil {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                ReadingGrid(cells: [
                    ReadingCell(
                        id: "address",
                        symbol: "mappin.and.ellipse",
                        label: model.addressLabel,
                        value: reading.address ?? "—",
                        isMissing: reading.address == nil
                    ),
                    ReadingCell(
                        id: "north",
                        symbol: "location.north",
                        label: model.northLabel,
                        value: reading.northRotationDegrees.map(model.northText) ?? "—",
                        isMissing: reading.northRotationDegrees == nil
                    ),
                ])
            }
        }
    }

    // MARK: - What it says

    private func callsSection(_ reading: PlatReading) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "ruler", title: model.callsTitle)
            ForEach(reading.boundaryCalls) { call in
                HStack(spacing: Metrics.space2) {
                    Text(String(call.callNumber))
                        .font(FieldConsoleType.mono.font)
                        .foregroundStyle(Palette.textMuted)
                    // Printed the way the sheet prints it, so checking a line
                    // against the paper compares the same characters.
                    Text(model.callText(call))
                        .font(FieldConsoleType.mono.font)
                        .foregroundStyle(call.isBearingMissing ? Palette.warning : Palette.text)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .accessibilityIdentifier("plat.calls")
    }

    @ViewBuilder
    private func objectsSection(_ reading: PlatReading) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "square.on.square", title: model.objectsTitle)

            if model.offersObjects {
                ForEach(reading.objects) { object in
                    Button {
                        model.toggleObject(object)
                    } label: {
                        SurfaceCard {
                            HStack(spacing: Metrics.space3) {
                                Image(
                                    systemName: model.isAccepted(object)
                                        ? "checkmark.square.fill" : "square"
                                )
                                .foregroundStyle(
                                    model.isAccepted(object) ? Palette.interaction : Palette.border
                                )
                                Text(model.objectLabel(object))
                                    .font(FieldConsoleType.bodyStrong.font)
                                    .foregroundStyle(Palette.text)
                                Spacer(minLength: 0)
                                Text(model.areaText(object.areaSquareMetres))
                                    .font(FieldConsoleType.mono.font)
                                    .foregroundStyle(Palette.textMuted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(model.isAccepted(object) ? [.isSelected] : [])
                    .accessibilityIdentifier("plat.object.\(object.id)")
                }
            } else {
                // Withheld, and the reason stated: every object's position
                // rides the same fit as the boundary.
                InlineMessage(model.objectsWithheldMessage, tone: .neutral)
                    .accessibilityIdentifier("plat.objectsWithheld")
            }
        }
    }

    // MARK: - Accepting

    private var acceptSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            SwitchTile(
                title: model.acceptBoundaryTitle,
                onSymbol: "square.dashed.inset.filled",
                offSymbol: "square.dashed",
                isOn: $model.acceptBoundary
            )
            .accessibilityIdentifier("plat.acceptBoundary")

            SwitchTile(
                title: model.acceptLocationTitle,
                onSymbol: "mappin.circle.fill",
                offSymbol: "mappin.circle",
                isOn: $model.acceptLocation
            )
            .accessibilityIdentifier("plat.acceptLocation")

            Button(model.acceptObjectsTitle) {
                guard let acceptance = model.acceptance() else { return }
                model.markAccepted()
                accept(acceptance)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.canAccept)
            .accessibilityIdentifier("plat.accept")

            if !model.canAccept {
                Text(model.nothingSelectedMessage)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
            }
            if let message = model.statusMessage {
                InlineMessage(message, tone: .positive)
                    .accessibilityIdentifier("plat.accepted")
            }
        }
    }
}
