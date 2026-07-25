import CoreDomain
import CoreGraphics
import CoreNetworking
import Foundation

/// The background panel's plan-document list state — a read query with its
/// own lifecycle, deliberately separate from command submission state.
public enum PlanMediaListState: Equatable, Sendable {
    case idle
    case loading
    case loaded([Media])
    case failed(message: String)
}

/// One imported background as the canvas underlay draws it: the plan image
/// (when resolved), where it goes, and the honest state badge. Computed
/// fresh from view-model state — never cached — so the underlay always
/// agrees with the objects drawn above it.
public struct MapBackgroundRenderLayer: Identifiable {
    /// How the plan image is placed on the canvas.
    public enum Placement {
        /// Uncalibrated: contain-fit inside the object polygon's bounding
        /// box, aspect preserved (`MapBackgroundPlacement.containFitRect`).
        case containFit
        /// Calibrated (or live calibration preview): drawn exactly at the
        /// similarity transform.
        case planTransform(PlanTransform, pageAspectRatio: Double)
    }

    public let id: String
    public let image: PlanBackgroundImage?
    /// The object geometry the contain-fit placement (and the badge) anchor
    /// to — the render geometry, i.e. the preview footprint during a
    /// calibration session.
    public let geometry: Geometry
    public let placement: Placement
    public let opacity: Double
    public let badgeText: String
}

/// Plan-background management (P6-PLAN iOS parity): list the garden's
/// uploaded plan documents, place one on the map as an `importedBackground`
/// object (uncalibrated, placeholder placement), per-background persisted
/// visibility, removal, and the display-image resolution the canvas
/// underlay draws from. The calibration session itself lives in
/// `MapEditorViewModelCalibration.swift`.
extension MapEditorViewModel {
    /// The placeholder placement for a freshly imported background: a 20 m
    /// square at the local origin — deliberately arbitrary and clearly so
    /// (an uncalibrated background has no meaningful plan-to-map
    /// transform); mirrors the web's `placeholderBackgroundGeometry`.
    static let placeholderBackgroundHalfSizeMetres = 10.0

    static func placeholderBackgroundGeometry() -> Geometry {
        let h = placeholderBackgroundHalfSizeMetres
        return .polygon([[
            Position(x: -h, y: -h),
            Position(x: h, y: -h),
            Position(x: h, y: h),
            Position(x: -h, y: h),
            Position(x: -h, y: -h),
        ]])
    }

    static let pdfContentType = "application/pdf"

    static func isPdf(_ media: Media) -> Bool {
        (media.verifiedContentType ?? media.declaredContentType) == pdfContentType
    }

    /// A plan the map can place: fully uploaded and validated — the same
    /// gate the server's own `planMediaId` validation enforces.
    static func isPlaceable(_ media: Media) -> Bool {
        media.uploadState == .available && media.processingState == .processed
    }

    // MARK: - Panel data

    public var backgroundsButtonTitle: String { strings(.mapBackgroundPanelButton) }

    public var importedBackgroundObjects: [GardenMapObject] {
        orderedObjectIds
            .compactMap { objectsById[$0] }
            .filter { $0.category == .importedBackground && $0.lifecycleState == .active }
    }

    /// The picker's rows: the garden's processed plan documents.
    public var placeablePlans: [Media] {
        guard case let .loaded(items) = planListState else { return [] }
        return items.filter(Self.isPlaceable)
    }

    public func isPdfPlan(_ media: Media) -> Bool { Self.isPdf(media) }

    /// Section 16's honest state/quality text for one background — the
    /// same wording on the canvas badge, the panel row, and the property
    /// sheet (`MapCalibrationLabels`).
    public func backgroundStateText(for object: GardenMapObject) -> String {
        MapCalibrationLabels.stateText(
            for: importedBackgroundDetails(of: object)?.calibration,
            strings: strings
        )
    }

    func importedBackgroundDetails(of object: GardenMapObject) -> ImportedBackgroundDetails? {
        guard case let .importedBackground(details)? = object.categoryDetails else { return nil }
        return details
    }

    /// True when this background's derived footprint is locked by its
    /// calibration: geometry commands are rejected server-side for it
    /// (`map.imported_background.geometry_locked_by_calibration`) — a drag
    /// recalibrates instead, and vertex editing is not offered.
    public func isGeometryLockedByCalibration(_ object: GardenMapObject) -> Bool {
        importedBackgroundDetails(of: object)?.calibrationState == .calibrated
    }

    // MARK: - Plan list

    public func loadPlanList() async {
        planListState = .loading
        do {
            planListState = .loaded(try await listGardenPlanMedia(gardenId: gardenId))
        } catch let error as APIGatewayError {
            planListState = .failed(message: message(for: error))
        } catch {
            planListState = .failed(message: strings(.serverUnexpected))
        }
    }

    // MARK: - Create / visibility / removal

    /// Places `plan` on the map as an uncalibrated background at the
    /// placeholder placement, through the ordinary offline `createObject`
    /// path. `pageNumberText` is the panel's PDF page field; a raster plan
    /// never sends a page (the server rejects pages above 1 for it).
    public func addBackgroundToMap(plan: Media, pageNumberText: String) async {
        let details = ImportedBackgroundDetails(
            planMediaId: plan.id,
            sourcePageNumber: parsedSourcePageNumber(pageNumberText, isPdf: Self.isPdf(plan)),
            isBackgroundVisible: true,
            calibrationState: .uncalibrated,
            calibration: nil
        )
        let command = MapCommandPayload.createObject(
            CreateObjectPayload(
                objectId: UUIDv7.generate(),
                category: .importedBackground,
                geometry: Self.placeholderBackgroundGeometry(),
                label: plan.displayFilename,
                categoryDetails: .importedBackground(details)
            )
        )

        await submit(command, undoBeforeSnapshot: nil) { created in
            self.selectedObjectId = created.id
        }
        ensureBackgroundImagesLoaded()
    }

    /// The panel's 1-based page field, parsed the way the web panel parses
    /// it: only meaningful for a PDF source, and a page of 1 (the default)
    /// is expressed as absence.
    func parsedSourcePageNumber(_ text: String, isPdf: Bool) -> Int? {
        guard isPdf else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard let page = Int(trimmed), page > 1 else { return nil }
        return page
    }

    /// Flips the per-background persisted `isBackgroundVisible` flag — the
    /// Phase 6 exit criterion's "independently hideable" — as an ordinary
    /// revision-guarded `changeProperties` command, undoable like any other
    /// property change. The server-owned calibration block is stripped from
    /// the echoed details (`withBackgroundVisible`), and the current
    /// `calibrationState` echoed, both of which the server requires.
    public func setBackgroundVisibility(objectId: String, isVisible: Bool) async {
        guard let object = objectsById[objectId],
            let details = importedBackgroundDetails(of: object)
        else { return }

        let command = MapCommandPayload.changeProperties(
            ChangePropertiesPayload(
                objectId: objectId,
                expectedRevision: object.revision,
                label: object.label,
                categoryDetails: .importedBackground(details.withBackgroundVisible(isVisible))
            )
        )
        await submit(command, undoBeforeSnapshot: object.snapshot)
    }

    /// Removal reuses the generic soft delete — the uploaded document
    /// itself is kept, exactly like the web panel's remove action.
    public func removeBackground(objectId: String) async {
        await delete(objectId: objectId)
    }

    // MARK: - Display images

    public func backgroundImageState(planMediaId: String) -> PlanBackgroundImageState? {
        backgroundImages[planMediaId]
    }

    /// Starts a display-image resolution for every active background whose
    /// plan image is not already resolved (or in flight). Fire-and-forget
    /// per plan; a failure lands as `.unavailable`, and a plan still
    /// processing re-queues on the next call rather than sticking as
    /// `.loading` forever.
    func ensureBackgroundImagesLoaded() {
        for object in importedBackgroundObjects {
            guard let details = importedBackgroundDetails(of: object) else { continue }
            loadBackgroundImageIfNeeded(planMediaId: details.planMediaId)
        }
    }

    private func loadBackgroundImageIfNeeded(planMediaId: String) {
        guard backgroundImages[planMediaId] == nil else { return }
        backgroundImages[planMediaId] = .loading

        let load = loadPlanBackgroundImage
        let gardenId = gardenId
        Task { [weak self] in
            let resolved: PlanBackgroundImageState
            do {
                resolved = try await load(gardenId: gardenId, planMediaId: planMediaId)
            } catch {
                resolved = .unavailable
            }
            guard let self else { return }
            if case .loading = resolved {
                // Still processing server-side: clear the slot so a later
                // `ensureBackgroundImagesLoaded()` (next load or panel
                // open) retries instead of showing "loading" forever.
                self.backgroundImages[planMediaId] = nil
            } else {
                self.backgroundImages[planMediaId] = resolved
            }
        }
    }

    // MARK: - Canvas layers

    /// The underlay layers the canvas draws beneath garden geometry, in
    /// document order. A background hidden by its own persisted flag
    /// contributes NO layer (its outline still renders as an object — the
    /// editing handle stays); one whose layer-2 visibility is toggled off
    /// is excluded with every other hidden-layer object.
    public var backgroundLayers: [MapBackgroundRenderLayer] {
        guard !hiddenLayers.contains(.importedBackgrounds) else { return [] }

        return importedBackgroundObjects.compactMap { object in
            guard let details = importedBackgroundDetails(of: object), details.isBackgroundVisible else {
                return nil
            }

            let image = backgroundImages[details.planMediaId]?.readyImage
            return MapBackgroundRenderLayer(
                id: object.id,
                image: image,
                geometry: renderGeometry(for: object),
                placement: backgroundPlacement(for: object, details: details, image: image),
                opacity: backgroundOpacity,
                badgeText: MapCalibrationLabels.stateText(for: details.calibration, strings: strings)
            )
        }
    }

    /// The single placement rule every consumer shares (drawing AND
    /// tap-picking): the live calibration preview wins, then the stored
    /// transform, then the honest contain-fit.
    func backgroundPlacement(
        for object: GardenMapObject,
        details: ImportedBackgroundDetails,
        image: PlanBackgroundImage?
    ) -> MapBackgroundRenderLayer.Placement {
        if calibrationDraft?.objectId == object.id,
            let aspect = calibrationPageAspectRatio,
            case let .ready(derivation) = calibrationPreview
        {
            return .planTransform(derivation.transform, pageAspectRatio: aspect)
        }
        if let calibration = details.calibration {
            return .planTransform(calibration.transform, pageAspectRatio: calibration.pageAspectRatio)
        }
        _ = image
        return .containFit
    }

    /// The geometry an object currently renders with — the calibration
    /// preview footprint for the session's target, its stored geometry
    /// otherwise.
    func renderGeometry(for object: GardenMapObject) -> Geometry {
        calibrationPreviewFootprint(for: object.id) ?? object.geometry
    }
}
