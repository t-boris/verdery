import CoreDesignSystem
import CoreDomain
import SwiftUI

/// Plan-background management (P6-PLAN iOS parity), presented as a sheet
/// from the map editor's toolbar — the iOS counterpart of the web's
/// `ImportedBackgroundPanel`: backgrounds already on the map (honest
/// calibration badge, per-background persisted show/hide, removal, a
/// calibration entry point), the client-local underlay opacity dimmer, and
/// the garden's uploaded plan documents with the PDF page selection and
/// the honest "PDF pages cannot be displayed yet" note.
struct MapBackgroundPanelView: View {
    @Bindable var model: MapEditorViewModel
    let onClose: () -> Void

    /// PDF page selection per plan row, kept here (form state) exactly like
    /// the web panel's `pageByMediaId`.
    @State private var pageNumberByMediaId: [String: String] = [:]
    /// The background a removal confirmation is pending for.
    @State private var removalCandidateId: String?

    /// A numeric field wide enough for its content at the reader's text size.
    ///
    /// `@ScaledMetric` grows the width with Dynamic Type; a bare `80` clipped
    /// the page number to a single visible digit at the accessibility sizes,
    /// which is exactly the setting a reader who needs them is using.
    @ScaledMetric(relativeTo: .callout) private var pageNumberFieldWidth: CGFloat = 80

    var body: some View {
        NavigationStack {
            List {
                onMapSection
                if !model.importedBackgroundObjects.isEmpty {
                    opacitySection
                }
                plansSection
            }
            .navigationTitle(model.strings(.mapBackgroundTitle))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.strings(.mapBackgroundClose), action: onClose)
                        .accessibilityIdentifier("map.background.close")
                }
            }
            .task { await model.loadPlanList() }
            .confirmationDialog(
                model.strings(.mapBackgroundRemoveConfirm),
                isPresented: isRemovalConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button(model.strings(.mapBackgroundRemove), role: .destructive) {
                    guard let objectId = removalCandidateId else { return }
                    removalCandidateId = nil
                    Task { await model.removeBackground(objectId: objectId) }
                }
            }
        }
    }

    private var isRemovalConfirmationPresented: Binding<Bool> {
        Binding(
            get: { removalCandidateId != nil },
            set: { isPresented in if !isPresented { removalCandidateId = nil } }
        )
    }

    // MARK: - Backgrounds on the map

    private var onMapSection: some View {
        Section(model.strings(.mapBackgroundOnMapTitle)) {
            if model.importedBackgroundObjects.isEmpty {
                Text(model.strings(.mapBackgroundNoneOnMap))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("map.background.noneOnMap")
            } else {
                ForEach(model.importedBackgroundObjects) { object in
                    backgroundRow(object)
                }
            }
        }
    }

    @ViewBuilder
    private func backgroundRow(_ object: GardenMapObject) -> some View {
        let details = detailsOf(object)
        let isVisible = details?.isBackgroundVisible ?? true

        VStack(alignment: .leading, spacing: 6) {
            Text(displayName(of: object))
                .font(.headline)
            // The honest state/quality badge — identical wording to the
            // canvas badge (`MapCalibrationLabels`).
            Text(model.backgroundStateText(for: object))
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("map.background.stateBadge")

            if case .unavailable = imageState(of: object) {
                Text(model.strings(.mapBackgroundImageUnavailable))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button(model.strings(isVisible ? .mapBackgroundHide : .mapBackgroundShow)) {
                    Task { await model.setBackgroundVisibility(objectId: object.id, isVisible: !isVisible) }
                }
                .accessibilityIdentifier("map.background.toggleVisibility")

                Spacer()

                Button(calibrateTitle(of: object)) {
                    model.beginCalibration(objectId: object.id)
                    onClose()
                }
                .disabled(!canCalibrate(object))
                .accessibilityIdentifier("map.background.calibrate")

                Button(model.strings(.mapBackgroundRemove), role: .destructive) {
                    removalCandidateId = object.id
                }
                .accessibilityIdentifier("map.background.remove")
            }
            .buttonStyle(.borderless)
            .font(.callout)
        }
        .padding(.vertical, 2)
    }

    // MARK: - Opacity

    private var opacitySection: some View {
        Section {
            // The dial rather than `Slider`: same job, but the track, the knob
            // and the tint are this application's, so a control on a charcoal
            // panel does not arrive wearing the system's default blue. It also
            // always shows the figure — a bare track answers "roughly where"
            // and never "what value", and somebody who found a transparency
            // they liked wants to be able to come back to it.
            ValueDial(
                fieldName: model.strings(.mapBackgroundOpacity),
                valueText: opacityText,
                value: $model.backgroundOpacity,
                // Never fully transparent: a backdrop at zero is a backdrop
                // that has silently stopped existing, and somebody would then
                // wonder where their plan went.
                range: 0.15...1,
                step: 0.05
            )
            .accessibilityIdentifier("map.background.opacity")
        }
    }

    private var opacityText: String {
        model.strings.number(model.backgroundOpacity * 100, fractionDigits: 0) + "%"
    }

    // MARK: - Uploaded plans

    private var plansSection: some View {
        Section(model.strings(.mapBackgroundPlansTitle)) {
            switch model.planListState {
            case .idle, .loading:
                Text(model.strings(.mapBackgroundPlansLoading))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("map.background.plansLoading")

            case let .failed(message):
                Text(message)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("map.background.plansFailed")

            case .loaded:
                if model.placeablePlans.isEmpty {
                    Text(model.strings(.mapBackgroundNoPlans))
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("map.background.noPlans")
                } else {
                    ForEach(model.placeablePlans) { plan in
                        planRow(plan)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func planRow(_ plan: Media) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(plan.displayFilename)
                .font(.headline)

            if model.isPdfPlan(plan) {
                Text(model.strings(.mapBackgroundPdfNoPreview))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                // Which page of a multi-page plan to show. A count, so it is
                // a numeral you step rather than a box you type into — and
                // stepping is what somebody does here, one page at a time,
                // looking for the drawing.
                MeasureField(
                    fieldName: model.strings(.mapBackgroundPageNumber),
                    unitLabel: "",
                    decreaseLabel: model.strings(.mapCalibrationDistanceDecrease),
                    increaseLabel: model.strings(.mapCalibrationDistanceIncrease),
                    value: pageNumberValueBinding(for: plan.id),
                    step: 1,
                    range: 1...999,
                    fractionDigits: 0,
                    locale: .autoupdatingCurrent
                )
                .accessibilityIdentifier("map.background.pageNumber")
            }

            Button(model.strings(.mapBackgroundAddToMap)) {
                let pageText = pageNumberByMediaId[plan.id] ?? "1"
                Task { await model.addBackgroundToMap(plan: plan, pageNumberText: pageText) }
                onClose()
            }
            .buttonStyle(.borderless)
            .font(.callout)
            .accessibilityIdentifier("map.background.addToMap")
        }
        .padding(.vertical, 2)
    }

    /// The panel stores the page as text because that is what an empty field
    /// means and what the command carries. The numeral works in numbers, so
    /// the two meet here; an unparsable value reads as page one, which is the
    /// page every document has.
    private func pageNumberValueBinding(for planId: String) -> Binding<Double> {
        let text = pageNumberBinding(for: planId)
        return Binding(
            get: { Double(text.wrappedValue) ?? 1 },
            set: { text.wrappedValue = String(Int($0.rounded())) }
        )
    }

    private func pageNumberBinding(for mediaId: String) -> Binding<String> {
        Binding(
            get: { pageNumberByMediaId[mediaId] ?? "1" },
            set: { pageNumberByMediaId[mediaId] = $0 }
        )
    }

    // MARK: - Helpers

    private func detailsOf(_ object: GardenMapObject) -> ImportedBackgroundDetails? {
        guard case let .importedBackground(details)? = object.categoryDetails else { return nil }
        return details
    }

    private func displayName(of object: GardenMapObject) -> String {
        guard let label = object.label, !label.isEmpty else {
            return model.strings(.mapBackgroundUnnamed)
        }
        return label
    }

    private func imageState(of object: GardenMapObject) -> PlanBackgroundImageState? {
        guard let details = detailsOf(object) else { return nil }
        return model.backgroundImageState(planMediaId: details.planMediaId)
    }

    private func canCalibrate(_ object: GardenMapObject) -> Bool {
        imageState(of: object)?.readyImage != nil
    }

    private func calibrateTitle(of object: GardenMapObject) -> String {
        detailsOf(object)?.calibration == nil
            ? model.strings(.mapCalibrationStart)
            : model.strings(.mapCalibrationRestart)
    }
}
