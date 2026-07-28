import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The plant inventory's entry point.
///
/// There is still no `GET /gardens/{gardenId}/plants` list operation in the
/// contract — only a single-plant `GET` — so this screen still cannot show an
/// inventory, and this pass deliberately did not invent one: a client-side
/// aggregation no endpoint backs would go stale or incomplete the moment a
/// plant were added from another client. That constraint is what shapes the
/// screen: it leads with the act it *can* perform, adding a plant, and keeps
/// opening a known plant as a secondary affordance below it.
///
/// What changed is how the adding reads. It was thirteen labelled `Form` rows
/// in one column; grouping kind, acquisition-date type, and — on the detail
/// screen — lifecycle stage and status are now chip rows, each led by the
/// symbol that stands for that value, so choosing one is a single tap against
/// a recognisable shape rather than a `Picker` wheel. Optional fields stay
/// collapsed behind their toggles.
///
/// `AddPlantFromPhoto` (ADR-0015) gets its own entry point below the manual
/// `addCard` — see `makePlantAddFromPhotoViewModel`'s own doc comment for the
/// upload capability this screen previously lacked.
public struct PlantsHomeView: View {
    @State private var model: PlantsHomeViewModel
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
    @FocusState private var isOpenIdFocused: Bool
    private let destination: (String) -> AnyView
    private let makeAddFromPhotoModel: () -> PlantAddFromPhotoViewModel

    public init(
        model: PlantsHomeViewModel,
        destination: @escaping (String) -> AnyView,
        makeAddFromPhotoModel: @escaping () -> PlantAddFromPhotoViewModel
    ) {
        _model = State(wrappedValue: model)
        self.destination = destination
        self.makeAddFromPhotoModel = makeAddFromPhotoModel
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space5) {
                addCard
                addFromPhotoCard
                openCard

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
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    isAddPresented = true
                } label: {
                    Label(model.addSectionTitle, systemImage: "plus")
                }
                .accessibilityIdentifier("plants.add.open")
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
    }

    /// The screen's primary act, as a large invitation rather than a form
    /// section — this is what the empty inventory offers, and there is nothing
    /// else for it to show.
    private var addCard: some View {
        Button {
            isAddPresented = true
        } label: {
            SurfaceCard(tone: .accent) {
                HStack(spacing: Metrics.space3) {
                    IconMedallion(
                        symbol: "leaf.fill",
                        label: model.addSectionTitle,
                        tone: .accent,
                        isLarge: true
                    )
                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(model.addSectionTitle)
                            .font(Typography.title)
                            .foregroundStyle(Palette.text)
                        Text(model.displayNameLabel)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "plus.circle.fill")
                        .foregroundStyle(Palette.accent)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("plants.add.card")
    }

    /// A secondary, quieter act next to `addCard`'s primary one — the same
    /// visual demotion `openCard`'s plain `SurfaceCard` (no `.accent` tone)
    /// already gives "open a known plant" relative to "add a plant".
    private var addFromPhotoCard: some View {
        Button {
            isAddFromPhotoPresented = true
        } label: {
            SurfaceCard {
                HStack(spacing: Metrics.space3) {
                    IconMedallion(symbol: "camera.fill", label: model.addFromPhotoButtonTitle, tone: .neutral)
                    Text(model.addFromPhotoButtonTitle)
                        .font(Typography.body.weight(.medium))
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("plants.addFromPhoto.card")
    }

    private var openCard: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "magnifyingglass", title: model.openSectionTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    InlineMessage(model.openHint, tone: .info)

                    HStack(spacing: Metrics.space2) {
                        TextField(model.openIdLabel, text: $model.openPlantId)
                            .textFieldStyle(.roundedBorder)
                            .focused($isOpenIdFocused)
                            .submitLabel(.go)
                            .onSubmit { model.openPlant() }
                            .accessibilityIdentifier("plants.open.idField")

                        Button {
                            model.openPlant()
                        } label: {
                            Label(model.openSubmitTitle, systemImage: "arrow.right.circle.fill")
                                .labelStyle(.iconOnly)
                                .font(Typography.title)
                        }
                        .tint(Palette.accent)
                        .disabled(model.openPlantId.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityLabel(model.openSubmitTitle)
                        .accessibilityIdentifier("plants.open.submit")
                    }
                }
            }
        }
    }
}
