import CoreDesignSystem
import CoreDomain
import CoreMediaTransfer
import PhotosUI
import SwiftUI

/// The record-an-observation sheet.
///
/// Extracted from `ObservationsTimelineView`, where these nine controls were a
/// permanently expanded section above the journal itself.
///
/// The note field takes focus on appear — recording an observation almost
/// always starts with typing what was seen — and the photo affordance is
/// promoted to the top of the sheet rather than buried between the map-object
/// fields and the submit button, because a photo is usually the point.
///
/// Photo attachment is real upload capability; see
/// `ObservationsTimelineViewModel.photoAttachment`. Recording a note and/or a
/// condition summary still works fully without one, and the submit control is
/// disabled only while a picked photo is still mid-upload.
struct ObservationRecordSheetView: View {
    @Bindable var model: ObservationsTimelineViewModel
    let onFinish: (Bool) -> Void

    @State private var pickedPhotoItem: PhotosPickerItem?
    @State private var isCameraPresented = false
    @State private var isCameraPermissionDeniedShown = false
    @FocusState private var isNoteFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    photoSection
                    noteSection
                    measurementsSection
                    targetSection
                    timingSection

                    if let message = model.recordErrorMessage {
                        InlineMessage(message)
                            .accessibilityIdentifier("observations.record.failure")
                    }

                    Button(action: submit) {
                        Label(model.recordSubmitTitle, systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isSubmittingRecord || model.isPhotoBlockingSubmit)
                    .accessibilityIdentifier("observations.record.submit")
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.recordSectionTitle)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.closeTitle) { onFinish(false) }
                }
                // Every text field here is multi-line, where Return inserts a
                // newline rather than dismissing the keyboard.
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button(model.closeTitle) { isNoteFocused = false }
                }
            }
            .onAppear { isNoteFocused = true }
            .onChange(of: pickedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task { await loadAndAttach(newItem) }
            }
            .cameraCapture(isPresented: $isCameraPresented) { data, contentType in
                Task { await model.pickRecordPhoto(data: data, contentType: contentType) }
            }
        }
    }

    private func takePhoto() {
        if CameraCapture.authorizationStatus == .denied {
            isCameraPermissionDeniedShown = true
        } else {
            isCameraPermissionDeniedShown = false
            isCameraPresented = true
        }
    }

    /// Absent entirely for a view model built with no `photoAttachment` — see
    /// `FeaturePlants.PlantDetailView.photoSection`'s identical reasoning.
    @ViewBuilder
    private var photoSection: some View {
        if let photoAttachment = model.photoAttachment {
            // Hoisted out of the label builder: `PhotosPicker`'s label closure
            // is `@Sendable`, so reading a main-actor property inside it is a
            // concurrency warning rather than a plain capture.
            let pickTitle = model.photoPickButtonTitle

            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: ObservationSymbols.photo, title: model.photoSectionTitle)

                SurfaceCard {
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        if CameraCapture.isAvailable {
                            Button(action: takePhoto) {
                                Label(model.takePhotoButtonTitle, systemImage: "camera.viewfinder")
                                    .font(Typography.body.weight(.medium))
                                    .foregroundStyle(Palette.accent)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, Metrics.space3)
                                    .background(
                                        RoundedRectangle(
                                            cornerRadius: Metrics.radiusMedium, style: .continuous
                                        )
                                        .fill(Tone.accent.quietFill)
                                    )
                            }
                            .accessibilityIdentifier("observations.record.photo.takePhoto")

                            if isCameraPermissionDeniedShown {
                                InlineMessage(model.cameraPermissionDeniedMessage, tone: .info)
                                Button(model.openSettingsButtonTitle) { CameraCapture.openSettings() }
                                    .accessibilityIdentifier("observations.record.photo.openSettings")
                            }
                        }

                        PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                            Label(pickTitle, systemImage: "photo.on.rectangle")
                                .font(Typography.body.weight(.medium))
                                .foregroundStyle(Palette.accent)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Metrics.space3)
                                .background(
                                    RoundedRectangle(
                                        cornerRadius: Metrics.radiusMedium, style: .continuous
                                    )
                                    .fill(Tone.accent.quietFill)
                                )
                        }
                        .accessibilityIdentifier("observations.record.photo.pick")

                        if photoAttachment.status != .idle {
                            InlineMessage(model.photoStatusText, tone: .info)
                                .accessibilityIdentifier("observations.record.photo.status")

                            // Shown only once a photograph is actually being
                            // attached: asking what a shot is before there is
                            // a shot is a question about nothing. The label is
                            // what makes the journal's comparison sequences
                            // comparable, so it is asked for rather than
                            // assumed.
                            Picker(model.photoPurposeLabel, selection: $model.recordPhotoPurpose) {
                                ForEach(ObservationPhotoPurpose.allCases, id: \.self) { purpose in
                                    Text(model.photoPurposeName(purpose)).tag(purpose)
                                }
                            }
                            .accessibilityIdentifier("observations.record.photo.purposePicker")

                            HStack(spacing: Metrics.space2) {
                                if photoAttachment.status.isRetryable,
                                    case .failed = photoAttachment.status
                                {
                                    CompactActionButton(
                                        symbol: "arrow.clockwise",
                                        title: model.photoRetryButtonTitle
                                    ) {
                                        Task { await model.retryRecordPhotoUpload() }
                                    }
                                    .accessibilityIdentifier("observations.record.photo.retry")
                                }

                                CompactActionButton(
                                    symbol: "trash",
                                    title: model.photoRemoveButtonTitle,
                                    tone: .negative
                                ) {
                                    pickedPhotoItem = nil
                                    Task { await model.discardRecordPhoto() }
                                }
                                .accessibilityIdentifier("observations.record.photo.remove")
                            }
                        }
                    }
                }
            }
        }
    }

    private var noteSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "text.bubble", title: model.noteTextLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.noteTextLabel, text: $model.recordNoteText, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(3...6)
                        .focused($isNoteFocused)
                        .accessibilityIdentifier("observations.record.noteField")

                    TextField(
                        model.conditionSummaryLabel,
                        text: $model.recordConditionSummary,
                        axis: .vertical
                    )
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)
                    .accessibilityIdentifier("observations.record.conditionField")
                }
            }
        }
    }

    /// Typed measurements, one row per kind. The kind picker offers only what
    /// no other row holds and the add control disappears once all three are
    /// in use, because `observation_measurement_unique_kind` permits exactly
    /// one of each — a rule the server enforces should not first reach the
    /// observer as a refusal.
    private var measurementsSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "ruler", title: model.measurementsLegend)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    ForEach($model.recordMeasurements) { $measurement in
                        VStack(alignment: .leading, spacing: Metrics.space2) {
                            Picker(model.measurementKindLabel, selection: $measurement.kind) {
                                ForEach(model.availableMeasurementKinds(for: measurement), id: \.self) { kind in
                                    Text(model.measurementKindName(kind)).tag(kind)
                                }
                            }
                            .accessibilityIdentifier("observations.record.measurement.kind")

                            TextField(
                                model.measurementValueLabel,
                                value: $measurement.value,
                                format: .number
                            )
                            .textFieldStyle(.roundedBorder)
                            #if os(iOS)
                                .keyboardType(.decimalPad)
                            #endif
                            .accessibilityIdentifier("observations.record.measurement.value")

                            TextField(model.measurementUnitLabel, text: $measurement.unit)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityIdentifier("observations.record.measurement.unit")

                            CompactActionButton(
                                symbol: "trash",
                                title: model.measurementRemoveTitle,
                                tone: .negative
                            ) {
                                model.removeMeasurement(measurement.kind)
                            }
                            .accessibilityIdentifier("observations.record.measurement.remove")
                        }
                    }

                    if model.nextFreeMeasurementKind != nil {
                        CompactActionButton(symbol: "plus", title: model.measurementAddTitle) {
                            model.addMeasurement()
                        }
                        .accessibilityIdentifier("observations.record.measurement.add")
                    }
                }
            }
        }
    }

    private var targetSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "scope", title: model.plantIdLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    TextField(model.plantIdLabel, text: $model.recordPlantId)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("observations.record.plantIdField")
                    TextField(model.gardenObjectIdLabel, text: $model.recordGardenObjectId)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("observations.record.gardenObjectIdField")
                    InlineMessage(model.mapObjectIdHint, tone: .info)
                }
            }
        }
    }

    private var timingSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "clock", title: model.observedAtLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Toggle(model.observedAtToggleLabel, isOn: $model.recordHasObservedAt)
                        .accessibilityIdentifier("observations.record.observedAtToggle")
                    if model.recordHasObservedAt {
                        DatePicker(model.observedAtLabel, selection: $model.recordObservedAt)
                            .accessibilityIdentifier("observations.record.observedAtPicker")
                    }
                }
            }
            .tint(Palette.accent)
        }
    }

    /// See `FeaturePlants.PlantDetailView.loadAndAttach`'s identical doc
    /// comment.
    private func loadAndAttach(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
        await model.pickRecordPhoto(data: data, contentType: contentType)
    }

    private func submit() {
        Task {
            await model.submitRecordObservation()
            onFinish(model.recordErrorMessage == nil)
        }
    }
}
