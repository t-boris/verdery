import CoreDomain
import CoreGraphics
import CoreLocalization
import Foundation
import Testing

@testable import FeatureMap

/// The imported-background slice of the map editor (P6-PLAN iOS parity):
/// placing a plan, the persisted visibility toggle, honest badges, the
/// calibration session's online submission, and the geometry lock a
/// calibrated background carries.
@MainActor
@Suite("Map editor view model — plan backgrounds")
struct MapEditorViewModelBackgroundTests {
    private let calibrationInputFixture = PlanCalibrationInput(
        pageAspectRatio: 0.75,
        knownDistance: PlanKnownDistance(
            pointA: Position(x: 0.1, y: 0.1),
            pointB: Position(x: 0.6, y: 0.1),
            distanceMetres: 10
        ),
        referencePoints: []
    )

    private func makeModel(gateway: FakeMapGateway, mediaGateway: FakeMapMediaGateway = FakeMapMediaGateway()) -> MapEditorViewModel {
        let localStore = InMemoryMapStore()
        return MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: gateway, localStore: localStore),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            applyMapCommandOffline: ApplyMapCommandOffline(localStore: localStore, profileId: "profile-1"),
            listGardenPlanMedia: ListGardenPlanMedia(gateway: mediaGateway),
            loadPlanBackgroundImage: LoadPlanBackgroundImage(gateway: mediaGateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    private func makeTestImage() -> PlanBackgroundImage {
        let context = CGContext(
            data: nil,
            width: 4,
            height: 3,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        return PlanBackgroundImage(id: "derivative-1", image: context.makeImage()!, pixelWidth: 4, pixelHeight: 3)
    }

    private func plan(
        id: String = "plan-1",
        contentType: String = "image/png",
        uploadState: MediaUploadState = .available,
        processingState: MediaProcessingState? = .processed
    ) -> Media {
        Media(
            id: id,
            gardenId: "garden-1",
            uploadedByProfileId: "profile-1",
            mediaClass: .importedPlan,
            displayFilename: "plan.png",
            declaredContentType: contentType,
            verifiedContentType: contentType,
            declaredByteSize: 1024,
            verifiedByteSize: 1024,
            checksumSha256: nil,
            uploadState: uploadState,
            processingState: processingState,
            sensitivityClassification: .sensitive,
            derivatives: [MediaDerivativeSummary(derivativeKind: .screenPreview, mediaId: "derivative-1")],
            revision: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func background(
        id: String = "bg-1",
        calibration: ImportedBackgroundCalibration? = nil,
        isVisible: Bool = true,
        revision: Int = 1
    ) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .importedBackground,
            geometry: .polygon([[
                Position(x: -10, y: -10), Position(x: 10, y: -10), Position(x: 10, y: 10),
                Position(x: -10, y: 10), Position(x: -10, y: -10),
            ]]),
            coordinateSpaceId: "space-1",
            label: "Scanned plan",
            categoryDetails: .importedBackground(
                ImportedBackgroundDetails(
                    planMediaId: "plan-1",
                    isBackgroundVisible: isVisible,
                    calibrationState: calibration == nil ? .uncalibrated : .calibrated,
                    calibration: calibration
                )
            ),
            lifecycleState: .active,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func storedCalibration() -> ImportedBackgroundCalibration {
        ImportedBackgroundCalibration(
            transformRevision: 1,
            pageAspectRatio: 0.75,
            knownDistance: calibrationInputFixture.knownDistance,
            referencePoints: [],
            manualAdjustment: nil,
            transform: PlanTransform(
                metresPerPlanUnit: 20,
                rotationRadians: 0,
                translationMetres: PlanTranslation(x: 0, y: 0)
            ),
            rmsErrorMetres: nil
        )
    }

    // MARK: - Placement

    @Test("Adding a plan creates an uncalibrated background at the placeholder placement")
    func addBackgroundCreatesUncalibratedObject() async {
        let model = makeModel(gateway: FakeMapGateway())
        await model.load()

        await model.addBackgroundToMap(plan: plan(), pageNumberText: "1")

        let created = model.importedBackgroundObjects.first
        #expect(created != nil)
        #expect(created?.label == "plan.png")
        guard case let .importedBackground(details)? = created?.categoryDetails else {
            Issue.record("Expected importedBackground details")
            return
        }
        #expect(details.planMediaId == "plan-1")
        #expect(details.isBackgroundVisible)
        #expect(details.calibrationState == .uncalibrated)
        #expect(details.calibration == nil)
        // A raster plan (and page 1 for any plan) never records a page.
        #expect(details.sourcePageNumber == nil)
        // The placeholder placement: the web's exact 20 m square at origin.
        #expect(created?.geometry == MapEditorViewModel.placeholderBackgroundGeometry())
    }

    @Test("A PDF page above 1 is recorded; a raster plan's page entry is ignored")
    func pageNumberParsing() async {
        let model = makeModel(gateway: FakeMapGateway())
        await model.load()

        await model.addBackgroundToMap(
            plan: plan(id: "plan-pdf", contentType: "application/pdf"), pageNumberText: " 3 "
        )
        await model.addBackgroundToMap(plan: plan(id: "plan-raster"), pageNumberText: "3")

        let pages = model.importedBackgroundObjects.compactMap { object -> Int? in
            guard case let .importedBackground(details)? = object.categoryDetails else { return nil }
            return details.sourcePageNumber
        }
        let allDetails = model.importedBackgroundObjects.compactMap { object -> ImportedBackgroundDetails? in
            guard case let .importedBackground(details)? = object.categoryDetails else { return nil }
            return details
        }
        #expect(allDetails.count == 2)
        #expect(pages == [3])
        #expect(allDetails.first { $0.planMediaId == "plan-pdf" }?.sourcePageNumber == 3)
        #expect(allDetails.first { $0.planMediaId == "plan-raster" }?.sourcePageNumber == nil)
    }

    @Test("The plan picker lists only placeable plans")
    func placeablePlansFilter() async {
        let mediaGateway = FakeMapMediaGateway()
        mediaGateway.planList = [
            plan(id: "ready"),
            plan(id: "still-processing", processingState: .processing),
            plan(id: "not-uploaded", uploadState: .uploading, processingState: nil),
        ]
        let model = makeModel(gateway: FakeMapGateway(), mediaGateway: mediaGateway)
        await model.load()

        await model.loadPlanList()

        #expect(model.placeablePlans.map(\.id) == ["ready"])
    }

    // MARK: - Visibility

    @Test("The visibility toggle echoes the stored state and strips the server-owned block")
    func visibilityToggleStripsCalibration() async {
        let calibrated = background(calibration: storedCalibration())
        let model = makeModel(gateway: FakeMapGateway(objects: [calibrated]))
        await model.load()

        await model.setBackgroundVisibility(objectId: "bg-1", isVisible: false)

        guard case let .importedBackground(details)? = model.objectsById["bg-1"]?.categoryDetails else {
            Issue.record("Expected importedBackground details")
            return
        }
        #expect(!details.isBackgroundVisible)
        // The state is echoed, never flipped, by a properties change.
        #expect(details.calibrationState == .calibrated)
    }

    @Test("A hidden background contributes no underlay layer; its outline object remains")
    func hiddenBackgroundHasNoLayer() async {
        let hidden = background(isVisible: false)
        let model = makeModel(gateway: FakeMapGateway(objects: [hidden]))
        await model.load()

        #expect(model.backgroundLayers.isEmpty)
        guard case let .loaded(snapshot) = model.state else {
            Issue.record("Expected a loaded snapshot")
            return
        }
        #expect(snapshot.objects.map(\.id) == ["bg-1"])
    }

    @Test("An uncalibrated background draws contain-fit; a calibrated one draws at its transform")
    func layerPlacementFollowsCalibrationState() async {
        let model = makeModel(
            gateway: FakeMapGateway(objects: [
                background(id: "bg-uncalibrated"),
                background(id: "bg-calibrated", calibration: storedCalibration()),
            ])
        )
        model.backgroundImages["plan-1"] = .ready(makeTestImage())
        await model.load()

        let placements = Dictionary(
            uniqueKeysWithValues: model.backgroundLayers.map { ($0.id, $0.placement) }
        )
        guard case .containFit = placements["bg-uncalibrated"] else {
            Issue.record("Expected contain-fit for the uncalibrated background")
            return
        }
        guard case let .planTransform(transform, pageAspectRatio) = placements["bg-calibrated"] else {
            Issue.record("Expected transform placement for the calibrated background")
            return
        }
        #expect(transform.metresPerPlanUnit == 20)
        #expect(pageAspectRatio == 0.75)
    }

    @Test("The badge is the honest state text: never a fabricated zero below two control points")
    func badgeTextIsHonest() async {
        let model = makeModel(
            gateway: FakeMapGateway(objects: [
                background(id: "bg-uncalibrated"),
                background(id: "bg-calibrated", calibration: storedCalibration()),
            ])
        )
        await model.load()

        let uncalibrated = model.objectsById["bg-uncalibrated"].map { model.backgroundStateText(for: $0) }
        let calibrated = model.objectsById["bg-calibrated"].map { model.backgroundStateText(for: $0) }

        #expect(uncalibrated == "Not calibrated")
        #expect(calibrated == "Calibrated · accuracy not estimated")
    }

    // MARK: - Geometry lock

    @Test("Vertex editing is not offered for a calibrated background")
    func calibratedBackgroundBlocksVertexEdit() async {
        let model = makeModel(
            gateway: FakeMapGateway(objects: [
                background(id: "bg-uncalibrated"),
                background(id: "bg-calibrated", calibration: storedCalibration()),
            ])
        )
        await model.load()

        #expect(model.supportsVertexEdit(model.objectsById["bg-uncalibrated"]!))
        #expect(!model.supportsVertexEdit(model.objectsById["bg-calibrated"]!))
    }

    @Test("Dragging a calibrated background recalibrates with the delta composed into the manual adjustment")
    func dragRoutesToManualAdjustmentRecalibration() async {
        let gateway = FakeMapGateway(objects: [background(calibration: storedCalibration())])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))

        // At the fitted viewport this screen translation converts to a
        // local delta; assert against the transform's own conversion.
        let translation = CGSize(width: 50, height: -30)
        let dx = model.transform.localDistance(forScreenDistance: 50)
        let dy = model.transform.localDistance(forScreenDistance: 30)
        await model.handleObjectDragEnded(objectId: "bg-1", translationScreen: translation)

        guard case let .upsertCalibration(payload)? = gateway.submittedCommands.last else {
            Issue.record("Expected an upsertCalibration submission, got \(gateway.submittedCommands)")
            return
        }
        #expect(payload.backgroundObjectId == "bg-1")
        #expect(payload.expectedRevision == 1)
        #expect(abs((payload.manualAdjustment?.translationMetres.dx ?? 0) - dx) < 1e-9)
        #expect(abs((payload.manualAdjustment?.translationMetres.dy ?? 0) - dy) < 1e-9)

        // The confirmed recalibration folded in: a new transform revision
        // and the derived footprint replacing the stored geometry.
        guard case let .importedBackground(details)? = model.objectsById["bg-1"]?.categoryDetails else {
            Issue.record("Expected importedBackground details")
            return
        }
        #expect(details.calibration?.transformRevision == 2)
        #expect(model.saveStatus == .saved)
    }

    // MARK: - Calibration session

    @Test("A session cannot start without a resolved plan image")
    func calibrationNeedsImage() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [background()]))
        // Pre-seeding the slot keeps `load()`'s own fire-and-forget image
        // resolution from racing this test's later state changes.
        model.backgroundImages["plan-1"] = .loading
        await model.load()

        model.beginCalibration(objectId: "bg-1")
        #expect(model.calibrationDraft == nil)

        model.backgroundImages["plan-1"] = .ready(makeTestImage())
        model.beginCalibration(objectId: "bg-1")
        #expect(model.calibrationDraft?.objectId == "bg-1")
        #expect(model.calibrationDraft?.capture == .segment)
    }

    @Test("Applying a session submits upsertCalibration online and folds the calibrated result")
    func applyCalibrationSubmitsOnline() async {
        let gateway = FakeMapGateway(objects: [background()])
        let model = makeModel(gateway: gateway)
        model.backgroundImages["plan-1"] = .ready(makeTestImage())
        await model.load()

        model.beginCalibration(objectId: "bg-1")
        // Drive the session through its public transitions: segment points
        // arrive via taps in production; the draft transitions are already
        // covered in MapCalibrationSessionTests, so seed them directly.
        var draft = model.calibrationDraft!
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.1, y: 0.1))
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.6, y: 0.1))
        model.calibrationDraft = draft
        model.setCalibrationDistanceText("10")
        #expect(model.canApplyCalibration)

        await model.applyCalibration()

        guard case .upsertCalibration? = gateway.submittedCommands.last else {
            Issue.record("Expected an upsertCalibration submission")
            return
        }
        #expect(model.calibrationDraft == nil)
        #expect(model.saveStatus == .saved)
        guard case let .importedBackground(details)? = model.objectsById["bg-1"]?.categoryDetails else {
            Issue.record("Expected importedBackground details")
            return
        }
        #expect(details.calibrationState == .calibrated)
        #expect(details.calibration?.transformRevision == 1)
        // The badge now reads the honest no-estimate text (no control points).
        #expect(model.backgroundStateText(for: model.objectsById["bg-1"]!) == "Calibrated · accuracy not estimated")
        // Undo stops at a calibration — no single-command inverse exists.
        #expect(model.undoIsBlocked)
    }

    @Test("A failed online submission keeps the session so Apply can be retried")
    func failedSubmissionKeepsDraft() async {
        let gateway = FakeMapGateway(objects: [background(revision: 5)])
        let model = makeModel(gateway: gateway)
        model.backgroundImages["plan-1"] = .ready(makeTestImage())
        await model.load()

        model.beginCalibration(objectId: "bg-1")
        var draft = model.calibrationDraft!
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.5, y: 0.5))
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0.5, y: 0.5))
        model.calibrationDraft = draft
        model.setCalibrationDistanceText("10")
        // Degenerate segment: the fake (like the server) rejects it. The
        // preview already said invalid, so Apply is not offered…
        #expect(!model.canApplyCalibration)

        // …but a stale-revision race can still fail a valid-looking apply:
        // force one through with a valid segment against a bumped revision.
        var valid = MapCalibrationSession.start(objectId: "bg-1")
        valid = MapCalibrationSession.withPlanPoint(valid, planPoint: Position(x: 0.1, y: 0.1))
        valid = MapCalibrationSession.withPlanPoint(valid, planPoint: Position(x: 0.6, y: 0.1))
        valid = MapCalibrationSession.withDistanceText(valid, distanceText: "10")
        model.calibrationDraft = valid
        model.objectsById["bg-1"] = background(revision: 4)
        await model.applyCalibration()

        #expect(model.saveStatus == .failed)
        #expect(model.errorMessage != nil)
        #expect(model.calibrationDraft != nil)
    }

    @Test("During a session the target's outline is the live preview footprint")
    func sessionSubstitutesPreviewFootprint() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [background()]))
        model.backgroundImages["plan-1"] = .ready(makeTestImage())
        await model.load()

        model.beginCalibration(objectId: "bg-1")
        var draft = model.calibrationDraft!
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 0, y: 0))
        draft = MapCalibrationSession.withPlanPoint(draft, planPoint: Position(x: 1, y: 0))
        model.calibrationDraft = draft
        model.setCalibrationDistanceText("40")

        guard case let .loaded(snapshot) = model.state,
            let rendered = snapshot.objects.first(where: { $0.id == "bg-1" })
        else {
            Issue.record("Expected a loaded snapshot with the background")
            return
        }
        // 40 m wide footprint (aspect 0.75 -> 30 m tall), seeded to stay
        // centered on the placeholder box's center (the origin).
        let footprint = model.calibrationPreviewFootprint(for: "bg-1")
        #expect(footprint != nil)
        #expect(rendered.geometry == footprint)
        let center = MapEditorViewModel.boundingBoxCenter(of: rendered.geometry)
        #expect(abs((center?.x ?? .infinity) - 0) < 0.001)
        #expect(abs((center?.y ?? .infinity) - 0) < 0.001)
    }

    @Test("Duplicating a calibrated background resets the copy to uncalibrated")
    func duplicateResetsCalibration() throws {
        let source = background(calibration: storedCalibration())
        let projected = try MapCommandProjection.apply(
            .duplicateObject(
                DuplicateObjectPayload(
                    sourceObjectId: "bg-1",
                    newObjectId: "bg-2",
                    offsetMetres: PlanarOffset(dx: 1, dy: 1)
                )
            ),
            to: ["bg-1": source],
            gardenId: "garden-1",
            coordinateSpaceId: "space-1",
            now: Date(timeIntervalSince1970: 0)
        )

        guard case let .importedBackground(details)? = projected.first?.categoryDetails else {
            Issue.record("Expected importedBackground details on the duplicate")
            return
        }
        #expect(details.calibrationState == .uncalibrated)
        #expect(details.calibration == nil)
        #expect(details.planMediaId == "plan-1")
    }
}
