import CoreDomain
import CoreGraphics
import CoreNetworking

/// Selection, creation, movement, property editing, delete, and restore.
///
/// Every method here submits exactly one command and, only once the server
/// confirms it, folds the result into local state — this pass has no
/// optimistic local mutation, so a rejected or dropped request never leaves
/// the canvas showing a change the server did not actually make. The
/// trade-off is a brief round trip before the UI updates; wiring an
/// optimistic-then-reconcile path is future polish, not correctness this
/// pass depends on.
extension MapEditorViewModel {
    public func handleCanvasTap(atScreen point: CGPoint) async {
        if let category = armedCreateCategory {
            armedCreateCategory = nil
            await createObject(category: category, atScreen: point)
        } else if pendingJoinFirstObjectId != nil {
            await completeJoinSelection(atScreen: point)
        } else {
            selectedObjectId = selectableObjectId(atScreen: point)
        }
    }

    /// The object id at `point`, or `nil` when nothing is there *or* the hit
    /// object's layer is currently locked — a locked-layer object is exactly
    /// as unselectable as empty canvas. See `MapEditorViewModelLayers.swift`.
    private func selectableObjectId(atScreen point: CGPoint) -> String? {
        guard let hitId = hitTestObjectId(atScreen: point), let object = objectsById[hitId], !isObjectLocked(object)
        else { return nil }
        return hitId
    }

    /// Shared by ordinary tap-to-select and the join-selection flow
    /// (`MapEditorViewModelLinework.swift`), which needs the same hit test
    /// without mutating ``selectedObjectId`` itself.
    func hitTestObjectId(atScreen point: CGPoint) -> String? {
        guard case let .loaded(snapshot) = state else { return nil }

        let local = transform.localPosition(for: point)
        let toleranceMetres = transform.localDistance(
            forScreenDistance: Double(GeometryTolerances.snapToleranceScreenPixels)
        )

        return MapHitTesting.hitTest(objects: snapshot.objects, at: local, toleranceMetres: toleranceMetres)
    }

    public func beginCreatePlacement(_ category: CreatableMapObjectCategory) {
        armedCreateCategory = category
        selectedObjectId = nil
    }

    public func cancelCreatePlacement() {
        armedCreateCategory = nil
    }

    private func createObject(category: CreatableMapObjectCategory, atScreen point: CGPoint) async {
        // A gate always belongs to an existing fence (`GateDetails.fenceObjectId`
        // is required, never fabricated) — the toolbar button is disabled
        // when `hasFence` is false, and this is the defensive re-check for
        // any path that reaches here regardless (e.g. a tap already in
        // flight when the last fence was deleted). Once a fence exists, the
        // tap location is held until the user picks which one in the
        // fence-picker sheet; see `createGate(fenceObjectId:)`.
        if category == .gate {
            armedCreateCategory = nil
            guard hasFence else {
                errorMessage = strings(.mapCreateGateNoFence)
                return
            }
            pendingGateCreationScreenPoint = point
            return
        }

        let center = transform.localPosition(for: point)
        let command = MapGestureCommands.createCommand(
            objectId: UUIDv7.generate(),
            category: category,
            at: center,
            label: nil
        )

        await submit(command, undoBeforeSnapshot: nil) { created in
            // Opens the property sheet immediately so a plant's required
            // common name (defaulted empty by `MapGestureCommands`, never
            // fabricated) gets a real value right away instead of sitting
            // blank until the user happens to reopen it.
            self.selectedObjectId = created.id
            self.propertySheetObjectId = created.id
        }
    }

    /// Completes a gate placement once the user has chosen which fence it
    /// belongs to in the fence-picker sheet. No-op if no placement is
    /// pending (defensive; the sheet is only ever shown while one is).
    public func createGate(fenceObjectId: String) async {
        guard let point = pendingGateCreationScreenPoint else { return }
        pendingGateCreationScreenPoint = nil

        let center = transform.localPosition(for: point)
        let command = MapGestureCommands.createCommand(
            objectId: UUIDv7.generate(),
            category: .gate,
            at: center,
            label: nil,
            fenceObjectId: fenceObjectId
        )

        await submit(command, undoBeforeSnapshot: nil) { created in
            self.selectedObjectId = created.id
            self.propertySheetObjectId = created.id
        }
    }

    /// Abandons a gate placement without creating anything — the fence-picker
    /// sheet's Cancel action.
    public func cancelGateCreation() {
        pendingGateCreationScreenPoint = nil
    }

    /// Called from `MapCanvasView`'s `.onEnded` drag handler — see
    /// `MapGestureCommands`'s doc comment on why exactly one command is
    /// built, here, and never from `.onChanged`.
    public func handleObjectDragEnded(objectId: String, translationScreen: CGSize) async {
        guard let object = objectsById[objectId], !isObjectLocked(object) else { return }

        let dxMetres = transform.localDistance(forScreenDistance: Double(translationScreen.width))
        // Screen y grows downward, garden-local y grows north — see
        // `MapViewportTransform`'s doc comment.
        let dyMetres = -transform.localDistance(forScreenDistance: Double(translationScreen.height))

        guard
            let command = MapGestureCommands.moveCommand(
                objectId: objectId,
                expectedRevision: object.revision,
                translationMetres: PlanarOffset(dx: dxMetres, dy: dyMetres)
            )
        else { return }

        await submit(command, undoBeforeSnapshot: object.snapshot)
    }

    public func openPropertySheetForSelection() {
        guard let selectedObjectId else { return }
        propertySheetObjectId = selectedObjectId
    }

    /// The accessible list's row-tap handler: "selecting a row selects the
    /// object and opens its property view" — a stronger action than a canvas
    /// tap, which only selects. Also the warnings sheet's "select an affected
    /// object" handler (`MapValidationSummaryView`). Bypasses hit testing
    /// entirely, so locking is re-checked here independently of
    /// `selectableObjectId(atScreen:)`.
    public func selectFromList(_ objectId: String) {
        guard let object = objectsById[objectId], !isObjectLocked(object) else { return }
        selectedObjectId = objectId
        propertySheetObjectId = objectId
    }

    public func closePropertySheet() {
        propertySheetObjectId = nil
    }

    /// Submits one `changeProperties` command carrying both the label and
    /// the category details together — a single Save commits a single
    /// coherent edit, not one command per field.
    public func saveProperties(objectId: String, label: String, details: GardenObjectDetails?) async {
        guard let object = objectsById[objectId] else { return }

        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let command = MapCommandPayload.changeProperties(
            ChangePropertiesPayload(
                objectId: objectId,
                expectedRevision: object.revision,
                label: trimmed.isEmpty ? nil : trimmed,
                categoryDetails: details
            )
        )

        await submit(command, undoBeforeSnapshot: object.snapshot) { _ in
            self.propertySheetObjectId = nil
        }
    }

    public func deleteSelected() async {
        guard let objectId = selectedObjectId else { return }
        await delete(objectId: objectId)
    }

    /// Soft delete: the affected object comes back from the server with
    /// `lifecycleState == .deleted`, still fully described, so the accessible
    /// list can keep showing it with a Restore action — see
    /// `MapRenderSnapshot`'s doc comment on why the canvas itself omits it.
    /// This is the one function every delete entry point funnels through
    /// (`deleteSelected()`, the selection bar, the property sheet, and the
    /// list's swipe action), so gating it here covers all of them.
    public func delete(objectId: String) async {
        guard let object = objectsById[objectId], !isObjectLocked(object) else { return }

        let command = MapCommandPayload.deleteObject(
            DeleteObjectPayload(objectId: objectId, expectedRevision: object.revision)
        )

        await submit(command, undoBeforeSnapshot: object.snapshot) { _ in
            self.propertySheetObjectId = nil
            if self.selectedObjectId == objectId {
                self.selectedObjectId = nil
            }
        }
    }

    public func restore(objectId: String) async {
        guard let object = objectsById[objectId] else { return }

        let command = MapCommandPayload.restoreObject(
            RestoreObjectPayload(objectId: objectId, expectedRevision: object.revision)
        )

        await submit(command, undoBeforeSnapshot: object.snapshot)
    }

    /// Submits a user-initiated command (never an undo/redo resubmission —
    /// see `MapEditorViewModelUndoRedo.swift`, which manages the stack
    /// itself), folds the confirmed result into local state, and records an
    /// undo entry.
    ///
    /// Also drives ``MapEditorViewModel/saveStatus`` — `.saving` for the
    /// duration of the request, then `.saved` or `.failed` depending on the
    /// outcome. `.failed` is left standing (not reset to `.idle`) until the
    /// next command actually succeeds, per ``MapSaveStatus``'s doc comment.
    func submit(
        _ command: MapCommandPayload,
        undoBeforeSnapshot: ObjectSnapshot?,
        onSuccess: ((GardenMapObject) -> Void)? = nil
    ) async {
        isSubmitting = true
        saveStatus = .saving
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let result = try await submitMapCommand(gardenId: gardenId, command: command)
            saveStatus = .saved
            guard let target = foldAffectedObjects(result.affectedObjects) else { return }

            undoStack.recordAccepted(
                MapUndoEntry(
                    command: command,
                    beforeSnapshot: undoBeforeSnapshot,
                    afterSnapshot: target.snapshot,
                    revisionAfter: target.revision
                )
            )
            onSuccess?(target)
        } catch let error as APIGatewayError {
            errorMessage = message(for: error)
            saveStatus = .failed
        } catch {
            errorMessage = strings(.serverUnexpected)
            saveStatus = .failed
        }
    }
}
