import CoreDesignSystem
import CoreLocalization
import FeatureCandidates
import FeatureGardens
import FeatureMap
import FeatureObservations
import FeaturePlants
import FeatureHealth
import FeatureRecommendations
import FeatureSeasonalPlan
import FeatureSyncConflicts
import FeatureTasks
import SwiftUI

/// One garden's five primary surfaces, as a tab bar.
///
/// This replaces the arrangement where `GardenSettingsView` — a `Form` holding
/// rename and archive — also held `NavigationLink`s to Today, the map, plants,
/// observations, tasks, and sync conflicts. That made the app's entire
/// substance a sub-page of its settings: opening the app landed on a settings
/// screen, and reaching anything took two or three pushes.
///
/// A tab bar is the right primary-navigation pattern here rather than, say, a
/// sidebar or a stack, because these five surfaces are peers a gardener moves
/// between constantly and in no fixed order — check Today, glance at the map,
/// log what you saw, tick a task off. None is a step in a sequence, so none
/// belongs behind another. Settings went where settings belong: behind one
/// button, presented as a sheet, holding only the things that configure the
/// garden rather than the things it is made of.
///
/// Five, not six: iPhone collapses a sixth tab into a "More" list, which would
/// bury whichever surface lost the draw. Plan upload, sync conflicts, and
/// service status are configuration, not daily surfaces, so they live inside
/// the settings sheet.
///
/// Source: architecture/ios-application-design.md, section "14. Navigation";
/// work package P8-UX-01.
struct GardenTabView: View {
    private let composition: AppCompositionRoot
    private let gardenId: String
    private let gardenName: String
    private let onSwitchGarden: () -> Void

    @State private var isSettingsPresented = false
    /// The account sheet, raised from the console strip's avatar.
    @State private var isAccountPresented = false
    /// Whether the Plants tab's own candidates section is pushed — see the
    /// Plants `Tab`'s own `.navigationDestination(isPresented:)` below.
    @State private var isCandidatesPresented = false
    /// Which tab is showing.
    ///
    /// Held here rather than left to `TabView`'s own default so the shell —
    /// not the framework — owns the answer to "where is the reader", which a
    /// deep link or a post-conversion jump will need.
    @State private var selection = 0

    init(
        composition: AppCompositionRoot,
        gardenId: String,
        gardenName: String,
        onSwitchGarden: @escaping () -> Void
    ) {
        self.composition = composition
        self.gardenId = gardenId
        self.gardenName = gardenName
        self.onSwitchGarden = onSwitchGarden
    }

    private var strings: LocalizedStrings { composition.localizedStrings }

    var body: some View {
        TabView(selection: $selection) {
            Tab(strings(.shellTabToday), systemImage: "sun.max.fill", value: 0) {
                stack {
                    TodayView(model: composition.makeTodayViewModel(gardenId: gardenId))
                        // The durable inbox. Reachable with push refused or
                        // never asked for, because the inbox is the record and
                        // push only announces it.
                        .navigationDestination(for: TodayNotificationsRoute.self) { _ in
                            NotificationInboxView(
                                model: composition.makeNotificationInboxViewModel(),
                                open: { composition.openNotificationDeepLink($0) }
                            )
                        }
                        .navigationDestination(for: TodayTasksRoute.self) { _ in
                            TasksListView(model: composition.makeTasksListViewModel(gardenId: gardenId))
                        }
                        // Seasonal plan (P9D-UX-01): a card near the top of
                        // Today's own list, pushed onto this same
                        // `NavigationStack` — this package's own resolved
                        // navigation placement decision, not a sixth tab.
                        .navigationDestination(for: TodaySeasonalPlanRoute.self) { route in
                            SeasonalPlanView(model: composition.makeSeasonalPlanViewModel(gardenId: route.gardenId))
                        }
                        // Seasonal plan's own hemisphere-unknown empty state
                        // reaches the map/georeference calibration flow from
                        // within this same stack — see
                        // `SeasonalPlanCalibrationRoute`'s own doc comment.
                        .navigationDestination(for: SeasonalPlanCalibrationRoute.self) { route in
                            MapEditorView(
                                model: composition.makeMapEditorViewModel(gardenId: route.gardenId),
                                makeGeoreferenceModel: { existing in
                                    composition.makeGeoreferenceViewModel(
                                        gardenId: route.gardenId,
                                        existing: existing
                                    )
                                }
                            )
                        }
                }
            }

            Tab(strings(.shellTabTasks), systemImage: "checklist", value: 1) {
                stack {
                    TasksListView(model: composition.makeTasksListViewModel(gardenId: gardenId))
                }
            }

            Tab(strings(.shellTabPlants), systemImage: "leaf.fill", value: 2) {
                stack {
                    PlantsHomeView(
                        model: composition.makePlantsHomeViewModel(gardenId: gardenId),
                        listModel: composition.makePlantsListViewModel(gardenId: gardenId),
                        destination: { plantId in
                            AnyView(
                                PlantDetailView(
                                    model: composition.makePlantDetailViewModel(gardenId: gardenId, plantId: plantId)
                                )
                                // The plant's journal sequence, wired here for
                                // the same reason the candidates screen is:
                                // `FeaturePlants` must never name
                                // `FeatureObservations`, and only this
                                // composition layer may import both.
                                .toolbar {
                                    ToolbarItem(placement: .secondaryAction) {
                                        NavigationLink {
                                            PlantJournalView(
                                                model: composition.makePlantJournalViewModel(
                                                    gardenId: gardenId, plantId: plantId
                                                )
                                            )
                                        } label: {
                                            Label(
                                                strings(.observationsJournalOpenButton),
                                                systemImage: "photo.stack"
                                            )
                                        }
                                        .accessibilityIdentifier("plants.detail.openJournal")
                                    }
                                }
                            )
                        },
                        makeAddFromPhotoModel: {
                            composition.makePlantAddFromPhotoViewModel(gardenId: gardenId)
                        }
                    )
                    // Plant candidates (P11-IOS-01) — a peer section of the
                    // Plants tab, not a sixth tab of its own, pushed onto
                    // this same `NavigationStack`. Wired here rather than
                    // inside `PlantsHomeView` itself so `FeaturePlants`
                    // never has to name `FeatureCandidates` — only this
                    // composition layer is allowed to import both.
                    .toolbar {
                        ToolbarItem(placement: .secondaryAction) {
                            Button {
                                isCandidatesPresented = true
                            } label: {
                                Label(strings(.candidatesTitle), systemImage: "lightbulb")
                            }
                            .accessibilityIdentifier("candidates.tab.open")
                        }
                    }
                    .navigationDestination(isPresented: $isCandidatesPresented) {
                        CandidatesScreenView(
                            model: composition.makeCandidatesListViewModel(gardenId: gardenId),
                            makeAddModel: { composition.makeAddCandidateViewModel(gardenId: gardenId) },
                            destination: { candidateId in
                                AnyView(
                                    CandidateDetailView(
                                        model: composition.makeCandidateDetailViewModel(
                                            gardenId: gardenId, candidateId: candidateId
                                        )
                                    )
                                )
                            }
                        )
                    }
                }
            }

            Tab(strings(.shellTabJournal), systemImage: "book.closed.fill", value: 3) {
                stack {
                    ObservationsTimelineView(
                        model: composition.makeObservationsTimelineViewModel(gardenId: gardenId)
                    )
                }
            }

            Tab(strings(.shellTabMap), systemImage: "map.fill", value: 4) {
                stack {
                    MapEditorView(
                        model: composition.makeMapEditorViewModel(gardenId: gardenId),
                        makeGeoreferenceModel: { existing in
                            composition.makeGeoreferenceViewModel(
                                gardenId: gardenId,
                                existing: existing
                            )
                        }
                    )
                        // The one screen allowed to rotate: a garden canvas is
                        // wider than it is tall, and tracing a lot benefits
                        // from the whole screen. Every other screen stays
                        // portrait — see `OrientationPolicy`.
                        .allowsLandscape(composition.orientationPolicy)
                }
            }
        }
        .tint(Palette.interaction)
        // The shell-appear half of this feature's two refresh triggers — see
        // `AppCompositionRoot.refreshIncomingOwnershipTransfers()`'s own doc
        // comment; `RootView`'s own app-foreground trigger is the other
        // (P9A-OWNER-02). Opening a garden this way reflects a pending
        // ownership offer immediately, rather than waiting for the next
        // foregrounding.
        .task {
            await composition.refreshIncomingOwnershipTransfers()
            // Read the outbox on the way in, so opening a garden reports what
            // is actually queued rather than whatever the last cycle left
            // behind. Deliberately not a sync: opening a garden is not a
            // reason to spend the network.
            await composition.syncStatusCenter.noteLocalMutation()
        }
        // Shown across every tab, not tucked inside Settings — see
        // `IncomingOwnershipTransferBanner`'s own doc comment for why this is
        // the more discoverable placement the task calls for (P9A-IOS-01).
        .safeAreaInset(edge: .top) {
            IncomingOwnershipTransferBanner(
                sessionState: composition.collaborationSessionState,
                gardenId: gardenId,
                strings: strings,
                makeReviewModel: {
                    composition.makeIncomingOwnershipTransferReviewViewModel(gardenId: gardenId, gardenName: gardenName)
                }
            )
        }
        // The console chassis: a 24-point status strip sitting directly on the
        // tab bar, so the two questions a person has on every screen — which
        // garden, and is my work safe — are answered without either one
        // occupying a toolbar slot on all five tabs.
        .safeAreaInset(edge: .bottom) {
            ConsoleStatusStrip(
                gardenName: gardenName,
                gardenSymbol: "tree.fill",
                status: composition.syncStatusCenter.consoleStatus(strings: strings),
                accountInitials: composition.accountInitials,
                accountLabel: strings(.profileTitle),
                openGardens: { isSettingsPresented = true },
                openStatus: { isSettingsPresented = true },
                openAccount: { isAccountPresented = true }
            )
        }
        .accountSheet(composition: composition, isPresented: $isAccountPresented)
        .sheet(isPresented: $isSettingsPresented) {
            GardenSettingsSheet(
                composition: composition,
                gardenId: gardenId,
                onSwitchGarden: {
                    isSettingsPresented = false
                    onSwitchGarden()
                }
            )
        }
    }

    /// One tab: its own `NavigationStack`, so each surface keeps its own
    /// history and switching tabs never discards where the reader was.
    ///
    /// The garden and account buttons used to be applied here, repeated on
    /// all five tabs. They now live in the console status strip, which answers
    /// "who and where am I" for the whole shell at once — so each screen's
    /// navigation bar is free for that screen's own title and actions.
    private func stack<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content()
        }
    }
}

/// The garden's settings, presented as a sheet from any tab.
///
/// Holds what actually configures a garden — its name, its lifecycle, the
/// property plan behind its map, the conflicts its synchronization is waiting
/// on, and the service's own health — plus the way back to the garden list.
private struct GardenSettingsSheet: View {
    let composition: AppCompositionRoot
    let gardenId: String
    let onSwitchGarden: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            GardenSettingsView(
                model: composition.makeGardenSettingsViewModel(gardenId: gardenId),
                onSwitchGarden: onSwitchGarden
            )
            .navigationDestination(for: GardenCollaboratorsRoute.self) { route in
                CollaboratorsView(
                    model: composition.makeCollaboratorsViewModel(gardenId: route.gardenId, isOwner: route.isOwner)
                )
            }
            .navigationDestination(for: GardenContextQualityRoute.self) { route in
                ContextQualityView(
                    model: composition.makeContextQualityViewModel(gardenId: route.gardenId, callerRole: route.callerRole)
                )
            }
            .navigationDestination(for: GardenPlanUploadRoute.self) { route in
                GardenPlanUploadView(
                    model: composition.makeGardenPlanUploadViewModel(gardenId: route.gardenId)
                )
            }
            .navigationDestination(for: GardenSyncConflictsRoute.self) { route in
                SyncConflictsView(model: composition.makeSyncConflictsViewModel(gardenId: route.gardenId))
            }
            .navigationDestination(for: GardenServiceHealthRoute.self) { _ in
                ServiceHealthView(model: composition.makeServiceHealthViewModel())
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(composition.localizedStrings(.plantsClose)) { dismiss() }
                }
            }
        }
    }
}
