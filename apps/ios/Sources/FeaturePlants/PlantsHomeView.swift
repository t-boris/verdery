import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The plant inventory's entry point: a browsable, searchable list
/// (`PlantsListView`/`PlantsListView`, backed by `SearchPlants`), with
/// "Add a plant" and "Add from photo" folded into a toolbar menu rather than
/// competing with the list for screen space, plus a compact "open by ID"
/// fallback below it for a plant this device's own search has not yet
/// caught up to (e.g. one just created and not yet indexed elsewhere).
///
/// Grouping kind, acquisition-date type, and — on the detail screen —
/// lifecycle stage and status are chip rows, each led by the symbol that
/// stands for that value, so choosing one is a single tap against a
/// recognisable shape rather than a `Picker` wheel. Optional fields stay
/// collapsed behind their toggles.
public struct PlantsHomeView: View {
    @State private var model: PlantsHomeViewModel
    @State private var listModel: PlantsListViewModel
    /// The plant this screen pushed to, if any.
    ///
    /// A local `@State` driving `.navigationDestination(item:)` rather than a
    /// `NavigationStack` of this screen's own: the tab shell already owns a
    /// stack, and nesting a second one inside it — which this screen used to
    /// do — traps every push inside the child and leaves the outer navigation
    /// bar showing the wrong title.
    @State private var openedPlantId: String?
    @State private var isAddPresented = false
    @State private var isAddFromPhotoPresented = false
    @State private var isOpenByIdExpanded = false
    private let destination: (String) -> AnyView
    private let makeAddFromPhotoModel: () -> PlantAddFromPhotoViewModel
    /// A capture asked for from outside the application — the Action button,
    /// Shortcuts, or Siri. Bound rather than observed so the shell can clear it
    /// once it has been honoured, and a stale request cannot re-fire.
    @Binding private var isCaptureRequested: Bool

    public init(
        model: PlantsHomeViewModel,
        listModel: PlantsListViewModel,
        destination: @escaping (String) -> AnyView,
        makeAddFromPhotoModel: @escaping () -> PlantAddFromPhotoViewModel,
        isCaptureRequested: Binding<Bool> = .constant(false)
    ) {
        _isCaptureRequested = isCaptureRequested
        _model = State(wrappedValue: model)
        _listModel = State(wrappedValue: listModel)
        self.destination = destination
        self.makeAddFromPhotoModel = makeAddFromPhotoModel
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space5) {
                PlantsListView(model: listModel) { plant in
                    openedPlantId = plant.id
                }

                openByIdSection

                if let message = model.errorMessage {
                    InlineMessage(message)
                        .accessibilityIdentifier("plants.home.failure")
                }
            }
            .padding(Metrics.space4)
        }
        .navigationTitle(model.title)
        .screenBackground()
        .navigationDestination(item: $openedPlantId) { plantId in
            destination(plantId)
        }
        // Honoured here rather than at the intent, because opening the camera
        // may first require a signed-in profile and a chosen garden — both of
        // which are true by the time this screen exists.
        .onChange(of: isCaptureRequested) { _, requested in
            guard requested else { return }
            isAddFromPhotoPresented = true
            isCaptureRequested = false
        }
        .onAppear {
            guard isCaptureRequested else { return }
            isAddFromPhotoPresented = true
            isCaptureRequested = false
        }
        .toolbar {
            // A door to the review stack, and only when there is something
            // behind it: a permanent button that usually leads to an empty
            // screen teaches people not to press it.
            ToolbarItem(placement: .navigation) {
                if let gardenId = model.reviewGardenId {
                    NavigationLink(value: PlantsReviewRoute(gardenId: gardenId)) {
                        Label(model.reviewOpenTitle, systemImage: "hand.raised")
                            .labelStyle(.iconOnly)
                    }
                    .accessibilityIdentifier("plants.review.open")
                }
            }

            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        isAddPresented = true
                    } label: {
                        Label(model.addSectionTitle, systemImage: "plus")
                    }
                    .accessibilityIdentifier("plants.add.open")

                    Button {
                        isAddFromPhotoPresented = true
                    } label: {
                        Label(model.addFromPhotoButtonTitle, systemImage: "camera.fill")
                    }
                    .accessibilityIdentifier("plants.addFromPhoto.open")
                } label: {
                    Label(model.addSectionTitle, systemImage: "plus")
                }
                .accessibilityIdentifier("plants.add.menu")
            }
        }
        .sheet(isPresented: $isAddPresented) {
            PlantAddSheetView(model: model, onCancel: { isAddPresented = false }) { didSucceed in
                Haptics.play(didSucceed ? .success : .failure)
                if didSucceed { isAddPresented = false }
            }
        }
        .sheet(isPresented: $isAddFromPhotoPresented) {
            PlantAddFromPhotoSheetView(model: makeAddFromPhotoModel()) { plantId in
                isAddFromPhotoPresented = false
                if let plantId {
                    Haptics.play(.success)
                    openedPlantId = plantId
                }
            }
        }
        .onChange(of: model.navigateToPlantId) { _, newValue in
            if let newValue {
                openedPlantId = newValue
                model.consumeNavigation()
            }
        }
        .onChange(of: openedPlantId) { _, newValue in
            // A plant added or confirmed from either sheet should show up in
            // the list without the reader having to pull to refresh — the
            // list reloads once the pushed detail screen is dismissed back
            // to this one.
            if newValue == nil {
                Task { await listModel.load() }
            }
        }
    }

    private var openByIdSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Button {
                isOpenByIdExpanded.toggle()
            } label: {
                HStack {
                    Text(model.openSectionTitle)
                        .font(Typography.detail.weight(.medium))
                        .foregroundStyle(Palette.textMuted)
                    Spacer(minLength: 0)
                    Image(systemName: isOpenByIdExpanded ? "chevron.up" : "chevron.down")
                        .foregroundStyle(Palette.textMuted)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("plants.open.toggle")

            if isOpenByIdExpanded {
                SurfaceCard {
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        InlineMessage(model.openHint, tone: .neutral)

                        // The manual fallback for a plant link, now that a staked QR
                        // label is the ordinary way in. One control rather than a box
                        // beside an arrow.
                        ComposerField(
                            symbol: "arrow.right.circle",
                            accessibilityName: model.openIdLabel,
                            placeholder: model.openIdLabel,
                            commitLabel: model.openSubmitTitle,
                            text: $model.openPlantId,
                            commit: { model.openPlant() }
                        )
                        .accessibilityIdentifier("plants.open.idField")
                    }
                }
            }
        }
    }
}
