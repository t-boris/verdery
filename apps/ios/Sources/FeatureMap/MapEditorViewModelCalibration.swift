import CoreDomain
import CoreGraphics
import CoreNetworking
import Foundation

/// The calibration session (P6-PLAN-02 iOS parity): a modal canvas mode for
/// one selected background — tap the two known-distance segment ends on the
/// plan, enter the real distance, optionally pair control points, adjust
/// placement manually (drag / rotation degrees), and apply. The live
/// preview and the final command run the SAME shared math the server runs
/// (``derivePlanCalibration``, pinned by the shared calibration fixtures),
/// so what the user previews is what the server stores.
///
/// ONLINE-ONLY, deliberately: `upsertCalibration` stays
/// `MapCommandError.unsupportedCommand` in the offline projection
/// (`MapCommandProjection`) — the server derives the transform revision,
/// residuals, and footprint in one transaction, an optimistic local
/// projection would have to fabricate a `transformRevision`, and a
/// calibration session needs the rendered plan image (fetched through a
/// signed URL) anyway, so a device that can calibrate is online by
/// construction. `applyCalibration` therefore submits through the retained
/// online path (`SubmitMapCommand`); a transport failure keeps the draft
/// and reports the connectivity error so the user can retry Apply.
extension MapEditorViewModel {
    // MARK: - Session lifecycle

    /// True when the current selection is a background a session can start
    /// for: its display image is resolved (a PDF plan has none —
    /// P6-WORKER-02's documented deferral — and cannot be calibrated; the
    /// panel states this instead of failing).
    public var canCalibrateSelection: Bool {
        guard let object = selectedObject, let details = importedBackgroundDetails(of: object) else {
            return false
        }
        return backgroundImages[details.planMediaId]?.readyImage != nil && !isSubmitting
    }

    /// "Calibrate" for a first calibration, "Recalibrate" after one.
    public var calibrateSelectionTitle: String {
        guard let object = selectedObject, importedBackgroundDetails(of: object)?.calibration != nil else {
            return strings(.mapCalibrationStart)
        }
        return strings(.mapCalibrationRestart)
    }

    public func beginCalibration(objectId: String) {
        guard let object = objectsById[objectId], !isObjectLocked(object),
            let details = importedBackgroundDetails(of: object),
            backgroundImages[details.planMediaId]?.readyImage != nil
        else { return }

        calibrationDraft = MapCalibrationSession.start(objectId: objectId, existing: details.calibration)
        selectedObjectId = objectId
        propertySheetObjectId = nil
        vertexEditObjectId = nil
        armedCreateCategory = nil
        refreshRenderState()
    }

    public func cancelCalibration() {
        calibrationDraft = nil
        refreshRenderState()
    }

    // MARK: - Draft state for the calibration bar

    /// Page height / width, measured from the displayed raster — the
    /// calibration input the contract defines as client-measured. `nil`
    /// while no session is active or its image is not resolved.
    var calibrationPageAspectRatio: Double? {
        guard let draft = calibrationDraft, let object = objectsById[draft.objectId],
            let details = importedBackgroundDetails(of: object)
        else { return nil }
        return backgroundImages[details.planMediaId]?.readyImage?.pageAspectRatio
    }

    public var calibrationPreview: MapCalibrationPreview {
        guard let draft = calibrationDraft, let aspect = calibrationPageAspectRatio else {
            return .incomplete
        }
        return MapCalibrationSession.preview(for: draft, pageAspectRatio: aspect)
    }

    /// The step instruction banner, mirroring the web panel's step text.
    public var calibrationHint: String? {
        guard let draft = calibrationDraft else { return nil }
        switch draft.capture {
        case .segment: return strings(.mapCalibrationStepSegment)
        case .controlPlan: return strings(.mapCalibrationStepControlPlan)
        case .controlLocal: return strings(.mapCalibrationStepControlLocal)
        case .none:
            if case .ready = calibrationPreview {
                return strings(.mapCalibrationStepReady)
            }
            return strings(.mapCalibrationStepDistance)
        }
    }

    public var calibrationDistanceText: String { calibrationDraft?.distanceText ?? "" }

    public func setCalibrationDistanceText(_ text: String) {
        guard let draft = calibrationDraft else { return }
        updateCalibrationDraft(MapCalibrationSession.withDistanceText(draft, distanceText: text))
    }

    /// The manual rotation in degrees, rendered to one decimal — the bar's
    /// rotation field round-trips through
    /// `MapCalibrationSession.withManualRotation` exactly.
    public var calibrationRotationDegreesText: String {
        let radians = calibrationDraft?.manualAdjustment?.rotationRadians ?? 0
        return String(format: "%.1f", radians * 180 / .pi)
    }

    public func setCalibrationRotationDegrees(_ text: String) {
        guard let draft = calibrationDraft, let aspect = calibrationPageAspectRatio,
            let degrees = Double(text.replacingOccurrences(of: ",", with: ".")), degrees.isFinite
        else { return }
        updateCalibrationDraft(
            MapCalibrationSession.withManualRotation(
                draft, pageAspectRatio: aspect, rotationRadians: degrees * .pi / 180
            )
        )
    }

    public func repickCalibrationSegment() {
        guard let draft = calibrationDraft else { return }
        updateCalibrationDraft(MapCalibrationSession.restartSegment(draft))
    }

    public var canAddCalibrationControlPoint: Bool {
        guard let draft = calibrationDraft else { return false }
        return draft.capture != .controlPlan && draft.capture != .controlLocal
    }

    public func beginCalibrationControlPoint() {
        guard let draft = calibrationDraft else { return }
        updateCalibrationDraft(MapCalibrationSession.beginControlPoint(draft))
    }

    public func removeCalibrationControlPoint(at index: Int) {
        guard let draft = calibrationDraft else { return }
        updateCalibrationDraft(MapCalibrationSession.removeReferencePoint(draft, at: index))
    }

    /// One row per control point: "Point {n}: ±{residual}" against the live
    /// preview, or an em dash while no preview exists.
    public var calibrationControlPointRows: [String] {
        guard let draft = calibrationDraft else { return [] }
        let residuals: [Double]
        if case let .ready(derivation) = calibrationPreview {
            residuals = derivation.pointResidualsMetres
        } else {
            residuals = []
        }
        return draft.referencePoints.indices.map { index in
            let value =
                index < residuals.count
                ? "±" + MapCalibrationLabels.formatErrorMetres(residuals[index])
                : "—"
            return strings.string(
                .mapCalibrationPointResidual,
                parameters: ["index": String(index + 1), "value": value]
            )
        }
    }

    /// Section 16's honest quality line: the RMS as a ± estimate, or the
    /// explicit below-two-points statement — never an implied zero.
    public var calibrationQualityText: String? {
        switch calibrationPreview {
        case .incomplete:
            return nil
        case .invalid:
            return strings(.mapCalibrationInvalidInput)
        case let .ready(derivation):
            guard let rms = derivation.rmsErrorMetres else {
                return strings(.mapCalibrationRmsUnavailable)
            }
            return strings.string(
                .mapCalibrationRms,
                parameters: ["value": MapCalibrationLabels.formatErrorMetres(rms)]
            )
        }
    }

    /// True once the live preview is derivable — what enables the rotation
    /// field (a rotation adjusts an existing preview, never creates one).
    public var isCalibrationPreviewReady: Bool {
        if case .ready = calibrationPreview { return true }
        return false
    }

    public var canApplyCalibration: Bool {
        isCalibrationPreviewReady && !isSubmitting
    }

    // MARK: - Canvas interaction

    /// A canvas tap during a session. In a plan-point capture mode the tap
    /// is inverse-projected onto the plan through the CURRENT placement
    /// (live preview, stored transform, or contain-fit — the same rule the
    /// underlay draws by); off-page taps are ignored. In local capture the
    /// tap is the control point's map half. Outside any capture mode taps
    /// do nothing — session taps never select objects, matching the web
    /// overlay's capture rectangle.
    func handleCalibrationTap(atScreen point: CGPoint) {
        guard let draft = calibrationDraft, let aspect = calibrationPageAspectRatio else { return }

        switch draft.capture {
        case .segment, .controlPlan:
            guard let planPoint = calibrationPlanPoint(atScreen: point),
                MapBackgroundPlacement.isPlanPointOnPage(planPoint, pageAspectRatio: aspect)
            else { return }
            updateCalibrationDraft(MapCalibrationSession.withPlanPoint(draft, planPoint: planPoint))

        case .controlLocal:
            updateCalibrationDraft(
                MapCalibrationSession.withLocalPoint(draft, localMetres: transform.localPosition(for: point))
            )

        case .none:
            break
        }
    }

    /// A drag of the session's target while no capture mode is active:
    /// recorded as manual-adjustment INPUT (never a raw transform
    /// overwrite), shifting the live preview.
    func handleCalibrationDragEnded(dxMetres: Double, dyMetres: Double) {
        guard let draft = calibrationDraft else { return }
        updateCalibrationDraft(
            MapCalibrationSession.withManualTranslation(draft, dxMetres: dxMetres, dyMetres: dyMetres)
        )
    }

    /// The plan-fraction point under a screen point through the target's
    /// current placement.
    private func calibrationPlanPoint(atScreen point: CGPoint) -> Position? {
        guard let draft = calibrationDraft, let object = objectsById[draft.objectId],
            let details = importedBackgroundDetails(of: object)
        else { return nil }

        let image = backgroundImages[details.planMediaId]?.readyImage
        switch backgroundPlacement(for: object, details: details, image: image) {
        case let .planTransform(planTransform, _):
            return MapBackgroundPlacement.planPoint(
                atScreen: point, planTransform: planTransform, transform: transform
            )
        case .containFit:
            guard let image,
                let bounds = MapBackgroundPlacement.geometryScreenRect(object.geometry, transform: transform)
            else { return nil }
            let fit = MapBackgroundPlacement.containFitRect(
                bounds: bounds,
                imageAspect: Double(image.pixelWidth) / Double(image.pixelHeight)
            )
            return MapBackgroundPlacement.planPoint(atScreen: point, containFit: fit)
        }
    }

    /// Applies a draft transition, seeds the initial placement when the
    /// preview first becomes derivable (so a scale-only calibration never
    /// teleports the plan to the local origin), and refreshes the render
    /// snapshot so the preview footprint tracks the draft.
    func updateCalibrationDraft(_ draft: MapCalibrationDraft) {
        var next = draft
        if let aspect = calibrationAspectRatio(forDraft: draft),
            let object = objectsById[draft.objectId],
            next.manualAdjustment == nil, next.referencePoints.isEmpty,
            case .ready = MapCalibrationSession.preview(for: next, pageAspectRatio: aspect),
            let center = Self.boundingBoxCenter(of: object.geometry)
        {
            next = MapCalibrationSession.withSeededPlacement(next, pageAspectRatio: aspect, targetCenter: center)
        }
        calibrationDraft = next
        refreshRenderState()
    }

    /// `calibrationPageAspectRatio` for a draft not yet stored — the same
    /// lookup, usable before `calibrationDraft` is reassigned.
    private func calibrationAspectRatio(forDraft draft: MapCalibrationDraft) -> Double? {
        guard let object = objectsById[draft.objectId],
            let details = importedBackgroundDetails(of: object)
        else { return nil }
        return backgroundImages[details.planMediaId]?.readyImage?.pageAspectRatio
    }

    /// The live preview's page footprint for the session's target object,
    /// `nil` for any other object or while the preview is not derivable.
    func calibrationPreviewFootprint(for objectId: String) -> Geometry? {
        guard calibrationDraft?.objectId == objectId, let aspect = calibrationPageAspectRatio,
            case let .ready(derivation) = calibrationPreview
        else { return nil }
        return try? planPageFootprint(derivation.transform, pageAspectRatio: aspect)
    }

    static func boundingBoxCenter(of geometry: Geometry) -> Position? {
        let positions = geometry.positions
        guard let first = positions.first else { return nil }
        var minX = first.x
        var maxX = first.x
        var minY = first.y
        var maxY = first.y
        for position in positions.dropFirst() {
            minX = min(minX, position.x)
            maxX = max(maxX, position.x)
            minY = min(minY, position.y)
            maxY = max(maxY, position.y)
        }
        return Position(x: (minX + maxX) / 2, y: (minY + maxY) / 2)
    }

    // MARK: - Online submission

    /// Submits the session's full input set as `upsertCalibration`; the
    /// server derives the transform, residuals, and footprint. Not undoable
    /// by design (`deriveInverseCommand` -> `nil`); recalibration is the
    /// correction path.
    public func applyCalibration() async {
        guard let draft = calibrationDraft, let object = objectsById[draft.objectId],
            let aspect = calibrationPageAspectRatio,
            let input = MapCalibrationSession.input(for: draft, pageAspectRatio: aspect)
        else { return }

        let payload = UpsertCalibrationPayload(
            backgroundObjectId: object.id,
            expectedRevision: object.revision,
            pageAspectRatio: input.pageAspectRatio,
            knownDistance: input.knownDistance,
            referencePoints: input.referencePoints,
            manualAdjustment: input.manualAdjustment
        )
        await submitCalibrationOnline(.upsertCalibration(payload), endsSession: true)
    }

    /// The "drag a calibrated background" path: its placement IS its
    /// transform (the server rejects `moveObject` for it), so a drag
    /// recalibrates from the STORED inputs with the drag delta composed
    /// into the manual adjustment — "manual origin adjustment" recorded as
    /// re-derivable input, exactly section 16's model and the web's
    /// `adjustCalibratedBackground`.
    func adjustCalibratedBackground(object: GardenMapObject, dxMetres: Double, dyMetres: Double) async {
        guard let calibration = importedBackgroundDetails(of: object)?.calibration else { return }

        let manual = calibration.manualAdjustment
            ?? ManualCalibrationAdjustment(rotationRadians: 0, translationMetres: PlanarOffset(dx: 0, dy: 0))
        let payload = UpsertCalibrationPayload(
            backgroundObjectId: object.id,
            expectedRevision: object.revision,
            pageAspectRatio: calibration.pageAspectRatio,
            knownDistance: calibration.knownDistance,
            referencePoints: calibration.referencePoints.map {
                CalibrationControlPoint(planPoint: $0.planPoint, localMetres: $0.localMetres)
            },
            manualAdjustment: ManualCalibrationAdjustment(
                rotationRadians: manual.rotationRadians,
                translationMetres: PlanarOffset(
                    dx: manual.translationMetres.dx + dxMetres,
                    dy: manual.translationMetres.dy + dyMetres
                )
            )
        )
        await submitCalibrationOnline(.upsertCalibration(payload), endsSession: false)
    }

    /// One submission path for both calibration entries. Unlike `submit`,
    /// this goes through the ONLINE `SubmitMapCommand` — see the extension
    /// doc comment for why calibration is online-only — and reports
    /// `.saved` (server-confirmed), not `.savedLocally`.
    private func submitCalibrationOnline(_ command: MapCommandPayload, endsSession: Bool) async {
        isSubmitting = true
        saveStatus = .saving
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let result = try await submitMapCommand(gardenId: gardenId, command: command)
            saveStatus = .saved
            if endsSession {
                calibrationDraft = nil
            }
            guard let target = foldAffectedObjects(result.affectedObjects) else { return }
            // Recorded with no inverse: undo stops here, honestly, until
            // the next undoable command — the editor's established posture
            // for split/join-like commands.
            undoStack.recordAccepted(
                MapUndoEntry(
                    command: command,
                    beforeSnapshot: nil,
                    afterSnapshot: target.snapshot,
                    revisionAfter: target.revision
                )
            )
        } catch let error as APIGatewayError {
            errorMessage = calibrationMessage(for: error)
            saveStatus = .failed
        } catch {
            errorMessage = strings(.serverUnexpected)
            saveStatus = .failed
        }
    }

    /// Maps a calibration submission failure to guidance: the server's
    /// geometry-lock rejection points at recalibration, connectivity points
    /// at the online-only requirement, everything else falls through to the
    /// shared classification.
    private func calibrationMessage(for error: APIGatewayError) -> String {
        if case let .service(body, _, _) = error {
            let codes = [body.code] + (body.details ?? []).map(\.code)
            if codes.contains(where: { $0.hasSuffix("geometry_locked_by_calibration") }) {
                return strings(.mapBackgroundLockedByCalibration)
            }
        }
        if case .transport = error {
            return strings(.mapCalibrationRequiresConnection)
        }
        return message(for: error)
    }
}
