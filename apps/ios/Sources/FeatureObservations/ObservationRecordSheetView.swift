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
                    symptomsSection
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
            .task { await model.loadRecordTargets() }
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
                                    .foregroundStyle(Palette.interaction)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, Metrics.space3)
                                    .background(
                                        RoundedRectangle(
                                            cornerRadius: Metrics.radiusControl, style: .continuous
                                        )
                                        .fill(Palette.interactionQuiet)
                                    )
                            }
                            .accessibilityIdentifier("observations.record.photo.takePhoto")

                            if isCameraPermissionDeniedShown {
                                InlineMessage(model.cameraPermissionDeniedMessage, tone: .neutral)
                                Button(model.openSettingsButtonTitle) { CameraCapture.openSettings() }
                                    .accessibilityIdentifier("observations.record.photo.openSettings")
                            }
                        }

                        PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                            Label(pickTitle, systemImage: "photo.on.rectangle")
                                .font(Typography.body.weight(.medium))
                                .foregroundStyle(Palette.text)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Metrics.space3)
                                .background(
                                    RoundedRectangle(
                                        cornerRadius: Metrics.radiusControl, style: .continuous
                                    )
                                    .fill(Palette.surfaceSunken)
                                )
                        }
                        .accessibilityIdentifier("observations.record.photo.pick")

                        if photoAttachment.status != .idle {
                            InlineMessage(model.photoStatusText, tone: .neutral)
                                .accessibilityIdentifier("observations.record.photo.status")

                            // Shown only once a photograph is actually being
                            // attached: asking what a shot is before there is
                            // a shot is a question about nothing. The label is
                            // what makes the journal's comparison sequences
                            // comparable, so it is asked for rather than
                            // assumed.
                            ChoiceChipGrid(
                                fieldName: model.photoPurposeLabel,
                                options: ObservationPhotoPurpose.allCases.map {
                                    ChoiceChipGrid.Option(
                                        value: $0,
                                        label: model.photoPurposeName($0),
                                        symbol: "camera"
                                    )
                                },
                                selection: $model.recordPhotoPurpose
                            )
                            .accessibilityIdentifier("observations.record.photo.purpose")

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

            // Testimony is content, not a control: no box is drawn around it.
            VStack(alignment: .leading, spacing: Metrics.space3) {
                NoteCanvas(
                    accessibilityName: model.noteTextLabel,
                    placeholder: model.noteTextLabel,
                    text: $model.recordNoteText
                )
                .accessibilityIdentifier("observations.record.noteField")

                NoteCanvas(
                    accessibilityName: model.conditionSummaryLabel,
                    placeholder: model.conditionSummaryLabel,
                    text: $model.recordConditionSummary
                )
                .accessibilityIdentifier("observations.record.conditionField")
            }
        }
    }

    /// What the observer says they saw. Never shown alongside a photo's
    /// health suggestions: one is testimony and the other a model's proposal,
    /// and a shared list would blur exactly the distinction the schema keeps.
    private var symptomsSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "leaf", title: model.symptomsLegend)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    ForEach($model.recordSymptoms) { $symptom in
                        VStack(alignment: .leading, spacing: Metrics.space2) {
                            ChoiceChipGrid(
                                fieldName: model.symptomKindLabel,
                                options: model.availableSymptomKinds(for: symptom).map {
                                    ChoiceChipGrid.Option(
                                        value: $0,
                                        label: model.symptomKindName($0),
                                        symbol: "leaf"
                                    )
                                },
                                selection: $symptom.kind
                            )
                            .accessibilityIdentifier("observations.record.symptom.kind")

                            // Severity is an ordered scale, so it reads as a
                            // rail: the range and this symptom's place in it
                            // are visible at once.
                            SegmentedRail(
                                fieldName: model.symptomSeverityLabel,
                                options: ObservationSymptomSeverity.allCases.map {
                                    SegmentedRail.Option(
                                        value: $0,
                                        label: model.symptomSeverityName($0),
                                        symbol: "exclamationmark.triangle"
                                    )
                                },
                                selection: $symptom.severity
                            )
                            .accessibilityIdentifier("observations.record.symptom.severity")

                            CompactActionButton(
                                symbol: "trash",
                                title: model.symptomRemoveTitle,
                                tone: .negative
                            ) {
                                model.removeSymptom(symptom.kind)
                            }
                            .accessibilityIdentifier("observations.record.symptom.remove")
                        }
                    }

                    if model.nextFreeSymptomKind != nil {
                        CompactActionButton(symbol: "plus", title: model.symptomAddTitle) {
                            model.addSymptom()
                        }
                        .accessibilityIdentifier("observations.record.symptom.add")
                    }
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
                            ChoiceChipGrid(
                                fieldName: model.measurementKindLabel,
                                options: model.availableMeasurementKinds(for: measurement).map {
                                    ChoiceChipGrid.Option(
                                        value: $0,
                                        label: model.measurementKindName($0),
                                        symbol: "ruler"
                                    )
                                },
                                selection: $measurement.kind
                            )
                            .accessibilityIdentifier("observations.record.measurement.kind")

                            // A measurement is a numeral you nudge, and its
                            // locale separator is the component's problem
                            // rather than every caller's: `3,5` typed on a
                            // Russian keypad has to round-trip to 3.5.
                            MeasureField(
                                fieldName: model.measurementValueLabel,
                                unitLabel: measurement.unit,
                                decreaseLabel: model.measurementDecreaseLabel,
                                increaseLabel: model.measurementIncreaseLabel,
                                value: $measurement.value,
                                locale: .autoupdatingCurrent
                            )
                            .accessibilityIdentifier("observations.record.measurement.value")

                            ComposerField(
                                symbol: "character.textbox",
                                accessibilityName: model.measurementUnitLabel,
                                placeholder: model.measurementUnitLabel,
                                commitLabel: model.recordSubmitTitle,
                                text: $measurement.unit,
                                commit: {}
                            )
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

            // Names, not identifiers. Both lists are optional: an observation
            // with no target is a garden-wide note, which is a real thing to
            // record and the default when nothing is chosen.
            if model.recordTargetPlants.isEmpty && model.recordTargetObjects.isEmpty {
                InlineMessage(model.mapObjectIdHint, tone: .neutral)
                    .accessibilityIdentifier("observations.record.targetEmpty")
            } else {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    ForEach(model.recordTargetPlants) { plant in
                        targetRow(
                            symbol: "leaf",
                            name: plant.displayName,
                            isSelected: model.recordPlantId == plant.id
                        ) { model.selectRecordPlant(plant) }
                    }
                    ForEach(model.recordTargetObjects) { object in
                        targetRow(
                            symbol: "square.dashed",
                            name: model.objectName(object),
                            isSelected: model.recordGardenObjectId == object.id
                        ) { model.selectRecordObject(object) }
                    }
                }
            }
        }
    }

    /// One target, tappable off as well as on: choosing the wrong bed and
    /// having no way back to "the whole garden" is the trap a radio group sets.
    private func targetRow(
        symbol: String,
        name: String,
        isSelected: Bool,
        select: @escaping () -> Void
    ) -> some View {
        Button(action: select) {
            SurfaceCard {
                HStack(spacing: Metrics.space3) {
                    IconMedallion(symbol: symbol, label: name, tone: isSelected ? .positive : .neutral)
                    Text(name)
                        .font(FieldConsoleType.bodyStrong.font)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(isSelected ? Palette.interaction : Palette.border)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityIdentifier("observations.record.target")
    }

    private var timingSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "clock", title: model.observedAtLabel)

            OptionalValueCard(
                fieldName: model.observedAtLabel,
                addPrompt: model.observedAtToggleLabel,
                clearLabel: model.closeTitle,
                symbol: "clock",
                displayValue: model.recordHasObservedAt
                    ? CalendarText.day(model.recordObservedAt) : nil,
                clear: { model.recordHasObservedAt = false }
            ) {
                DateDial(
                    fieldName: model.observedAtLabel,
                    selection: $model.recordObservedAt,
                    now: .now,
                    calendar: .current,
                    chipTitle: model.relativeDayTitle,
                    dayNumber: CalendarText.dayNumber,
                    weekdayName: CalendarText.weekday,
                    longDate: CalendarText.day
                )
                // Opening the editor is asking for the value; the switch that
                // used to gate it was bookkeeping nobody asked for.
                .onAppear { model.recordHasObservedAt = true }
            }
            .accessibilityIdentifier("observations.record.observedAt")
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
