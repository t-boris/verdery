import CoreDesignSystem
import CoreDomain
import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif

/// Which notifications reach you, and when they may not.
public struct NotificationPreferencesView: View {
    @State private var model: NotificationPreferencesViewModel
    private let close: () -> Void

    /// Quiet hours are edited as two instants because that is what a draggable
    /// window is; they are converted back to minutes-after-midnight on write.
    /// The date part is arbitrary and never leaves this screen.
    @State private var quietStart = Date()
    @State private var quietEnd = Date()

    private let calendar = Calendar.current

    private let pushRegistration: PushPermissionPresenting?

    public init(
        model: NotificationPreferencesViewModel,
        pushRegistration: PushPermissionPresenting? = nil,
        close: @escaping () -> Void
    ) {
        _model = State(wrappedValue: model)
        self.pushRegistration = pushRegistration
        self.close = close
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    SurfaceCard {
                        // The load-bearing sentence: push is an accelerator,
                        // the inbox is the record. Somebody who switches
                        // everything off here still loses nothing.
                        Text(model.explanation)
                            .font(FieldConsoleType.body.font)
                            .foregroundStyle(Palette.text)
                    }
                    permissionSection
                    content
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.closeTitle, action: close)
                }
            }
            .task {
                await pushRegistration?.refreshAuthorization()
                await model.load()
                syncQuietHoursFromModel()
            }
        }
    }

    /// The system permission, stated for what it is.
    ///
    /// Asked for here and nowhere else: iOS grants the prompt exactly once, and
    /// a prompt raised at launch — before anything has shown why it is worth
    /// anything — is the prompt people refuse permanently.
    @ViewBuilder
    private var permissionSection: some View {
        if let pushRegistration {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: "bell.badge", title: pushRegistration.permissionTitle)
                Text(pushRegistration.permissionExplanation)
                    .font(FieldConsoleType.secondary.font)
                    .foregroundStyle(Palette.textMuted)

                if pushRegistration.isGranted {
                    InlineMessage(pushRegistration.grantedText, tone: .positive)
                        .accessibilityIdentifier("push.granted")
                } else if pushRegistration.isDenied {
                    // Not a nag and not a second prompt: iOS will not show one
                    // again, so the only honest offer is the Settings door.
                    InlineMessage(pushRegistration.deniedText, tone: .neutral)
                        .accessibilityIdentifier("push.denied")
                    Button(pushRegistration.openSettingsTitle) { openSystemSettings() }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("push.openSettings")
                } else {
                    Button(pushRegistration.askTitle) {
                        Task { await pushRegistration.requestAuthorization() }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("push.ask")
                }
            }
        }
    }

    private func openSystemSettings() {
        #if canImport(UIKit) && os(iOS)
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        #endif
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.title)
                .accessibilityIdentifier("notificationPreferences.loading")

        case .unreachable:
            FailureStateView(
                message: model.offlineMessage,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("notificationPreferences.offline")

        case .loaded:
            VStack(alignment: .leading, spacing: Metrics.space5) {
                ForEach(NotificationPreferencesViewModel.editableTypes, id: \.self) { type in
                    typeSection(type)
                }
                quietHoursSection

                if let message = model.failureMessage {
                    InlineMessage(message)
                        .accessibilityIdentifier("notificationPreferences.failure")
                } else if let message = model.statusMessage {
                    InlineMessage(message, tone: .positive)
                        .accessibilityIdentifier("notificationPreferences.saved")
                }
            }
        }
    }

    private func typeSection(_ type: String) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            SectionEyebrow(symbol: "bell", title: model.typeName(type))

            SwitchTile(
                title: model.inAppLabel,
                explanation: model.inAppHint,
                onSymbol: "tray.full",
                offSymbol: "tray",
                isOn: Binding(
                    get: { model.inAppEnabled(type) },
                    set: { enabled in Task { await model.setInApp(enabled, for: type) } }
                )
            )
            .accessibilityIdentifier("notificationPreferences.inApp.\(type)")

            SwitchTile(
                title: model.pushLabel,
                explanation: model.pushHint,
                onSymbol: "bell.badge",
                offSymbol: "bell.slash",
                isOn: Binding(
                    get: { model.pushEnabled(type) },
                    set: { enabled in Task { await model.setPush(enabled, for: type) } }
                )
            )
            .accessibilityIdentifier("notificationPreferences.push.\(type)")
        }
    }

    /// A genuinely optional value gating a window, which is exactly what
    /// `OptionalValueCard` exists for — not a `Toggle` beside a hidden picker.
    private var quietHoursSection: some View {
        OptionalValueCard(
            fieldName: model.quietHoursLabel,
            addPrompt: model.quietHoursHint,
            clearLabel: model.quietHoursLabel,
            symbol: "moon.zzz",
            displayValue: model.quietHours.map(model.quietWindowText),
            clear: { Task { await model.setQuietHours(nil) } }
        ) {
            TimeWindowBar(
                fieldName: model.quietHoursLabel,
                start: Binding(
                    get: { quietStart },
                    set: { quietStart = $0; commitQuietHours() }
                ),
                end: Binding(
                    get: { quietEnd },
                    set: { quietEnd = $0; commitQuietHours() }
                ),
                calendar: calendar,
                timeText: { date in model.clockText(minuteOfDay(date)) }
            )
        }
        .accessibilityIdentifier("notificationPreferences.quietHours")
    }

    // MARK: - Quiet-hour conversion

    private func minuteOfDay(_ date: Date) -> Int {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        return (components.hour ?? 0) * 60 + (components.minute ?? 0)
    }

    private func date(fromMinuteOfDay minute: Int) -> Date {
        calendar.date(
            bySettingHour: minute / 60,
            minute: minute % 60,
            second: 0,
            of: Date()
        ) ?? Date()
    }

    private func syncQuietHoursFromModel() {
        guard let quietHours = model.quietHours else { return }
        quietStart = date(fromMinuteOfDay: quietHours.startMinute)
        quietEnd = date(fromMinuteOfDay: quietHours.endMinute)
    }

    private func commitQuietHours() {
        // The time zone is left `nil` on purpose: the server then applies the
        // profile's own zone, which stays right when this phone travels.
        let window = NotificationQuietHours(
            startMinute: minuteOfDay(quietStart),
            endMinute: minuteOfDay(quietEnd),
            timeZone: nil
        )
        Task { await model.setQuietHours(window) }
    }
}
