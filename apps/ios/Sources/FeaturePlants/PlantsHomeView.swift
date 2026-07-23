import CoreDomain
import SwiftUI

/// The plant inventory's entry point.
///
/// There is no `GET /gardens/{gardenId}/plants` list operation in the
/// contract — only a single-plant `GET`. Rather than fabricate a
/// client-side aggregation no real endpoint backs (which would silently go
/// stale or incomplete the moment a plant is added from any other client),
/// this screen offers exactly what the contract supports: adding a plant
/// (after which its id is known, so this screen can push straight to its
/// detail screen), and opening a plant whose id is already known — reached,
/// for instance, by copying it from this same "just created" flow, or from
/// an observation's or a task's own plant reference elsewhere in this app.
///
/// See `AddPlantFromPhotoRequest`/`AddPlantFromPhoto` in `PlantGateway.swift`
/// for the second honest gap this screen leaves: identifying a plant from a
/// photo needs a `photoMediaId`, and this codebase has no file-upload flow
/// yet to produce one (`media.media_record` only records that a reference
/// exists). That flow is fully implemented and tested at the gateway layer
/// and deliberately absent here, the same way Phase 3 honestly deferred
/// calibration/proposals rather than building a UI control that could never
/// actually succeed.
public struct PlantsHomeView: View {
    @State private var model: PlantsHomeViewModel
    @State private var path: [String] = []
    private let destination: (String) -> AnyView

    public init(model: PlantsHomeViewModel, destination: @escaping (String) -> AnyView) {
        _model = State(wrappedValue: model)
        self.destination = destination
    }

    public var body: some View {
        NavigationStack(path: $path) {
            Form {
                addSection
                openSection

                if let message = model.errorMessage {
                    Section {
                        Text(message).foregroundStyle(.red)
                            .accessibilityIdentifier("plants.home.failure")
                    }
                }
            }
            .navigationTitle(model.title)
            .navigationDestination(for: String.self) { plantId in
                destination(plantId)
            }
            .sheet(isPresented: $model.isTaxonomyPickerPresented) {
                TaxonomyReferencePickerView(
                    title: model.taxonomyPickerTitle,
                    searchLabel: model.taxonomyPickerSearchLabel,
                    emptyMessage: model.taxonomyPickerEmptyMessage,
                    closeTitle: model.closeTitle,
                    displayName: { model.taxonomyDisplayName($0) },
                    search: { await model.searchTaxonomy(query: $0) },
                    onSelect: { model.selectTaxonomy($0) },
                    onClose: { model.isTaxonomyPickerPresented = false }
                )
            }
            .onChange(of: model.navigateToPlantId) { _, newValue in
                if let newValue {
                    path.append(newValue)
                    model.consumeNavigation()
                }
            }
        }
    }

    private var addSection: some View {
        Section(model.addSectionTitle) {
            TextField(model.displayNameLabel, text: $model.displayName)
                .accessibilityIdentifier("plants.add.displayNameField")

            Picker(model.groupingKindLabel, selection: $model.groupingKind) {
                ForEach(PlantGroupingKind.allCases, id: \.self) { kind in
                    Text(model.groupingKindName(kind)).tag(kind)
                }
            }
            .accessibilityIdentifier("plants.add.groupingKindPicker")

            if model.groupingKind != .individual {
                TextField(model.quantityLabel, text: $model.quantityText)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                    .accessibilityIdentifier("plants.add.quantityField")
            }

            TextField(model.varietyLabelLabel, text: $model.varietyLabel)
                .accessibilityIdentifier("plants.add.varietyLabelField")

            Toggle(model.acquisitionDateToggleLabel, isOn: $model.hasAcquisitionDate)
                .accessibilityIdentifier("plants.add.acquisitionDateToggle")

            if model.hasAcquisitionDate {
                DatePicker(
                    model.acquisitionDateLabel,
                    selection: $model.acquisitionDate,
                    displayedComponents: .date
                )
                .accessibilityIdentifier("plants.add.acquisitionDatePicker")

                Picker(model.acquisitionDateTypeLabel, selection: $model.acquisitionDateType) {
                    ForEach(PlantAcquisitionDateType.allCases, id: \.self) { type in
                        Text(model.acquisitionDateTypeName(type)).tag(type)
                    }
                }
                .accessibilityIdentifier("plants.add.acquisitionDateTypePicker")
            }

            taxonomyRow

            TextField(model.gardenAreaLabel, text: $model.gardenAreaMapObjectId)
                .accessibilityIdentifier("plants.add.gardenAreaField")
            TextField(model.placementLabel, text: $model.placementMapObjectId)
                .accessibilityIdentifier("plants.add.placementField")
            Text(model.mapObjectIdHint)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Button(model.addSubmitTitle) {
                Task { await model.submitAddPlant() }
            }
            .disabled(model.state == .submitting)
            .accessibilityIdentifier("plants.add.submit")
        }
    }

    private var taxonomyRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                model.isTaxonomyPickerPresented = true
            } label: {
                HStack {
                    Text(model.taxonomyLabel)
                    Spacer()
                    Text(model.selectedTaxonomySummary)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("plants.add.taxonomyRow")

            if model.selectedTaxonomyReference != nil {
                Button(model.taxonomyClearLabel) { model.clearTaxonomy() }
                    .accessibilityIdentifier("plants.add.taxonomyClear")
            }
        }
    }

    private var openSection: some View {
        Section(model.openSectionTitle) {
            Text(model.openHint)
                .font(.footnote)
                .foregroundStyle(.secondary)
            TextField(model.openIdLabel, text: $model.openPlantId)
                .accessibilityIdentifier("plants.open.idField")
            Button(model.openSubmitTitle) {
                model.openPlant()
            }
            .accessibilityIdentifier("plants.open.submit")
        }
    }
}
