import Foundation
import Testing

@testable import CoreDomain

/// Notification preferences, where absence is meaningful.
///
/// A type/garden combination with no row defaults to every channel enabled. A
/// client that read a missing row as "off" would silently mute somebody who
/// never chose to be muted, which is the failure this suite exists to prevent.
@Suite("Notification preferences")
struct NotificationPreferencesTests {
    private func entry(
        _ type: String,
        gardenId: String? = nil,
        inApp: Bool = true,
        push: Bool = true
    ) -> NotificationPreferenceEntry {
        NotificationPreferenceEntry(
            notificationType: type,
            gardenId: gardenId,
            inAppEnabled: inApp,
            pushEnabled: push
        )
    }

    @Test("treats a missing row as every channel enabled")
    func absenceMeansEnabled() {
        let preferences = NotificationPreferences(revision: 0, quietHours: nil, entries: [])
        let setting = preferences.setting(for: "care_recommendation", gardenId: nil)
        #expect(setting.inAppEnabled)
        #expect(setting.pushEnabled)
    }

    @Test("lets a garden row override the global one")
    func gardenOverridesGlobal() {
        let preferences = NotificationPreferences(
            revision: 3,
            quietHours: nil,
            entries: [
                entry("care_recommendation", push: false),
                entry("care_recommendation", gardenId: "garden-1", push: true),
            ]
        )
        #expect(!preferences.setting(for: "care_recommendation", gardenId: nil).pushEnabled)
        #expect(preferences.setting(for: "care_recommendation", gardenId: "garden-1").pushEnabled)
        // A garden with no row of its own falls back to the global setting
        // rather than to the default.
        #expect(!preferences.setting(for: "care_recommendation", gardenId: "garden-2").pushEnabled)
    }

    /// The document is replaced whole, so an edit must carry every other row
    /// through — dropping one would remove it server-side.
    @Test("replaces one row and keeps the rest")
    func replacingKeepsSiblings() {
        let preferences = NotificationPreferences(
            revision: 2,
            quietHours: nil,
            entries: [entry("care_recommendation"), entry("export_ready")]
        )
        let updated = preferences.replacing(entry("care_recommendation", push: false))

        #expect(updated.entries.count == 2)
        #expect(!updated.setting(for: "care_recommendation", gardenId: nil).pushEnabled)
        #expect(updated.setting(for: "export_ready", gardenId: nil).pushEnabled)
        // The revision is carried, because it is what the next write quotes.
        #expect(updated.revision == 2)
    }

    @Test("a garden row and a global row of the same type are different rows")
    func rowIdentityIncludesGarden() {
        #expect(entry("care_recommendation").id != entry("care_recommendation", gardenId: "g").id)
    }

    /// 22:00 to 07:00 is the ordinary case for a sleeping window, and a naive
    /// `start...end` range gets it exactly backwards.
    @Test("recognises a window that crosses midnight")
    func wrappingWindow() {
        let overnight = NotificationQuietHours(startMinute: 1320, endMinute: 420, timeZone: nil)
        #expect(overnight.wrapsMidnight)
        #expect(!overnight.isDegenerate)

        let daytime = NotificationQuietHours(startMinute: 540, endMinute: 1020, timeZone: nil)
        #expect(!daytime.wrapsMidnight)
    }

    /// Rejected by the server; refused here before a request is spent. An
    /// always-quiet day is expressed by switching push off, not by a window
    /// that reads as "always" or "never" depending on who implements it.
    @Test("refuses a degenerate window")
    func degenerateWindow() {
        #expect(NotificationQuietHours(startMinute: 600, endMinute: 600, timeZone: nil).isDegenerate)
    }

    @Test("clears quiet hours by setting them to nothing")
    func clearingQuietHours() {
        let preferences = NotificationPreferences(
            revision: 1,
            quietHours: NotificationQuietHours(startMinute: 1320, endMinute: 420, timeZone: nil),
            entries: []
        )
        #expect(preferences.withQuietHours(nil).quietHours == nil)
    }
}
