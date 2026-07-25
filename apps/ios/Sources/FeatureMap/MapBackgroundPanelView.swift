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
            HStack {
                Text(model.strings(.mapBackgroundOpacity))
                Slider(value: $model.backgroundOpacity, in: 0.15...1, step: 0.05)
                    .accessibilityLabel(model.strings(.mapBackgroundOpacity))
                    .accessibilityIdentifier("map.background.opacity")
            }
        }
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
                HStack {
                    Text(model.strings(.mapBackgroundPageNumber))
                    TextField(
                        model.strings(.mapBackgroundPageNumber),
                        text: pageNumberBinding(for: plan.id)
                    )
                    .frame(maxWidth: 80)
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                        .keyboardType(.numberPad)
                    #endif
                    .accessibilityIdentifier("map.background.pageNumber")
                }
                .font(.callout)
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
