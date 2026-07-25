# iOS distribution — TestFlight and the App Store

How a Verdery build gets from this repository onto a device, and everything App Store Connect
asks for that a human has to paste in. Work package `P8-STORE-01`.

The build mechanics, the store copy, and the privacy declarations are all finished and checked in.
What is **not** finished is the set of actions only the repository owner's Apple account can
perform. Those are enumerated once, in [1. Owner action checklist](#1-owner-action-checklist), and
nothing else in this document is blocked on anything except them.

## 0. Where things stand

| Piece                                                 | State                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| An iOS app target that compiles for a real device     | Done — `xcodebuild archive` succeeds                                             |
| App icon, launch screen, privacy manifest, Info.plist | Done — `apps/ios/Resources/`, `apps/ios/project.yml`                             |
| A signed, distribution-ready `.ipa`                   | **Produced and verified locally** — see [2](#2-what-has-actually-been-run)       |
| TestFlight upload automation                          | Written and run to the edge of upload — `apps/ios/scripts/archive-and-upload.sh` |
| Store listing copy, English and Russian               | Done — [6](#6-store-listing-english) and [7](#7-store-listing-russian)           |
| App Privacy declarations                              | Done, derived from the code — [8](#8-app-privacy-declarations)                   |
| Review notes and demo account                         | Drafted — [9](#9-app-review-notes); the account itself is an owner action        |
| In-app account deletion                               | **Blocked** on `P8-DELETE-01` — [10](#10-account-deletion-a-hard-blocker)        |
| Screenshots                                           | **Not captured** — [11](#11-screenshots)                                         |

Bundle identifier `com.verdery.app`. Apple Developer team `3M68DG8S7N`. Deployment target iOS 18.0,
iPhone and iPad.

## 1. Owner action checklist

Ordered, each item saying what it unblocks. **The list is shorter than expected**, because running
the signing path locally proved that several prerequisites are already satisfied — see
[2](#2-what-has-actually-been-run) for the evidence rather than taking this on trust.

**Already done, verified, no action needed:**

- The Apple Developer Program membership is active, and the Program License Agreement is accepted.
  Apple issued a _Cloud Managed Apple Distribution_ certificate for team `3M68DG8S7N` during the
  local archive; it does not issue those otherwise.
- The App ID `com.verdery.app` exists in the developer portal with the **Sign in with Apple**
  capability enabled, and it carries the `beta-reports-active` entitlement — the entitlement that
  exists specifically to permit TestFlight distribution.
- A distribution signing certificate and a matching provisioning profile exist.

**Still required, in order:**

1. **Create the App Store Connect app record** — App Store Connect → Apps → `+`. Platform iOS, bundle
   ID `com.verdery.app`, SKU `verdery-ios-01`, primary language English (U.S.). For the app **name**
   see [6](#6-store-listing-english) — it must be globally unique across the entire App Store, so
   have the fallback in that section ready. _Unblocks uploading: without a record, an upload for this
   bundle ID is rejected after the whole binary has transferred._
2. **Confirm the Agreements, Tax, and Banking status** — App Store Connect → Business. The Free
   Applications agreement must read "Active". _A pending agreement leaves an uploaded build stuck in
   "Processing" forever with no error shown anywhere._ (The Program License Agreement is separately
   confirmed accepted, above; this is the paid/free applications one, which is not exercised by
   signing and so could not be verified here.)
3. **Create an App Store Connect API key** — App Store Connect → Users and Access → Integrations →
   App Store Connect API → Team Keys → `+`. Name it `verdery-ci`, access role **App Manager**.
   Download the `AuthKey_<KeyID>.p8` **once**; Apple never shows it again. Then note three values:
   - the **Key ID** (10 characters, beside the key),
   - the **Issuer ID** (a UUID above the key list, one per team),
   - the path you saved the `.p8` to — keep it outside this repository; it is a real credential.

   _Unblocks the automated upload in [4](#4-uploading-to-testflight). Without it, an upload is still
   possible by opening the archive in Xcode's Organizer and clicking through Distribute App._

4. **Add the first TestFlight internal testers** — App Store Connect → your app → TestFlight →
   Internal Testing. Internal testers need only an App Store Connect user account, and receive builds
   with no Apple review of any kind. _This is the step that puts the app on the owner's phone._

Those four are the entire path to a build in the owner's hands. Everything below is App Store
submission only, and none of it blocks TestFlight:

5. **Create the reviewer demo account** — see [9](#9-app-review-notes).
6. **Decide the support and privacy-policy URLs** — see [5](#5-named-decisions-still-open).
7. **Ship in-app account deletion** — see [10](#10-account-deletion-a-hard-blocker). This is
   engineering work, not an account action, and it is the largest remaining item.

## 2. What has actually been run

Distinguishing verified from assumed, because most of this document's value depends on the
difference.

**Verified on this machine:**

- `swift build` and `swift test` — 808 tests in 114 suites, all passing.
- `xcodebuild -target Verdery -sdk iphoneos -arch arm64 build` — the shipped app compiles for a real
  device. This had **never been run before**, and it failed the first time; see
  [12. Known gaps](#12-known-gaps) for what it found.
- `xcodebuild archive -destination 'generic/platform=iOS'` — a real `.xcarchive` with a dSYM.
- `./scripts/archive-and-upload.sh --validate-only` — end to end, producing a **signed 7.5 MB
  `Verdery.ipa`** with:
  - certificate type `Cloud Managed Apple Distribution`,
  - `application-identifier` `3M68DG8S7N.com.verdery.app`,
  - `beta-reports-active: true`, `get-task-allow: false`,
  - `com.apple.developer.applesignin: [Default]`,
  - `CFBundleVersion 138` (from `git rev-list --count HEAD`), `CFBundleShortVersionString 1.0`,
  - `Assets.car` carrying all 17 icon slots including the 1024×1024 marketing icon,
  - `GoogleService-Info.plist`, `PrivacyInfo.xcprivacy`, `embedded.mobileprovision`,
    `_CodeSignature`.

**Not run, and why:** the upload itself, which needs the App Store Connect API key from owner action 3. That single step is the entire remaining distance to TestFlight.

**Not verifiable anywhere but a real device:** Sign in with Apple, Google sign-in, and App Attest.
See [12](#12-known-gaps).

## 3. Building

Everything below runs today, with no Apple credentials.

```sh
cd apps/ios
swift build && swift test           # the package: 808 tests, 114 suites
xcodegen generate                   # regenerate Verdery.xcodeproj from project.yml
xcodebuild -project Verdery.xcodeproj -target Verdery \
  -configuration Release -sdk iphoneos -arch arm64 \
  CODE_SIGNING_ALLOWED=NO build     # the real device build, unsigned
```

`Verdery.xcodeproj` is generated by [XcodeGen](https://github.com/yonaskolb/XcodeGen) from
`project.yml` and **must never be hand-edited**. It is committed for the benefit of anyone opening
the repository in Xcode, but a committed generated file drifts: between Phase 2 and Phase 8 the
checked-in project silently lost a source file that had been added to `project.yml`, and nothing
caught it because nothing ever built the app target. Two things now prevent a repeat — CI builds the
app target on every change to `apps/ios/**` (`.github/workflows/ci.yml`), and
`scripts/archive-and-upload.sh` regenerates the project unconditionally before archiving.

### Why `-target` and `-sdk` rather than `-scheme` and `-destination`

On a machine without the iOS **device platform** component installed, `xcodebuild -scheme … 
-destination 'generic/platform=iOS'` fails during destination resolution before it compiles
anything ("iOS 26.5 is not installed"). `-target … -sdk iphoneos` skips run-destination resolution
entirely and compiles against the iPhoneOS SDK that ships inside Xcode. The archive path in
`scripts/archive-and-upload.sh` uses `-scheme`/`-destination`, because a real archive does need the
platform component; install it with `xcodebuild -downloadPlatform iOS`.

## 4. Uploading to TestFlight

```sh
cd apps/ios

# Dry run: archive, sign, export a local .ipa, upload nothing.
./scripts/archive-and-upload.sh --validate-only

# The real upload, after owner action 5.
VERDERY_ASC_KEY_ID=XXXXXXXXXX \
VERDERY_ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
VERDERY_ASC_KEY_PATH=~/private_keys/AuthKey_XXXXXXXXXX.p8 \
  ./scripts/archive-and-upload.sh
```

The script archives with `xcodebuild archive` and then exports **and uploads** in one step with
`xcodebuild -exportArchive`, authenticating with the App Store Connect API key. It chooses plain
`xcodebuild` over fastlane deliberately — the reasoning is in the script's own header, and the short
version is that fastlane would be the only Ruby in this repository to wrap three commands Apple now
supports first-party.

The build number defaults to `git rev-list --count HEAD`, which is monotonic and needs no state
file. Override with `VERDERY_BUILD_NUMBER` when re-uploading the same commit — App Store Connect
permanently rejects a `(version, build)` pair it has already seen.

Processing takes 5–30 minutes after upload before the build appears in TestFlight.

## 5. Named decisions still open

Neither blocks TestFlight; both block App Store submission.

- **Support URL** (required). No support surface exists yet — `P8-SUPPORT-01` establishes one. Until
  it does, the honest options are a `mailto:`-backed page or a single static page on the deployed web
  app. Recommendation: add `/support` to the web client and point here; a bare `mailto:` is accepted
  but reviewers occasionally query it.
- **Marketing URL** (optional). Omit it rather than pointing at a placeholder.
- **Privacy policy URL** (required, and required for TestFlight _external_ testing too). Blocked on
  `P8-PRIV-01`, which is itself blocked on provider contracts (`P0-PROV-01`). Internal TestFlight
  testing does not need it.
- **iPad support.** The app is built for iPhone _and_ iPad (`TARGETED_DEVICE_FAMILY = "1,2"`), which
  makes a full set of iPad screenshots mandatory at submission and puts iPad layout in scope for
  review. If iPad is not genuinely supported, set the family to `"1"` in `project.yml` now — it is a
  one-line change, and dropping a declared device family after release is not.

## 6. Store listing (English)

**App name** (30 characters max): `Verdery`
Verify availability at app record creation. If taken, use `Verdery Garden` (14 characters).

**Subtitle** (30 max): `A living map of your garden` (27)

**Promotional text** (170 max, editable without a new build):

> Draw your garden once. Verdery keeps the map, the plants, and the history in one place — and works
> the same offline, out where the beds are.

**Description** (4000 max):

> Verdery turns your garden into a map you can actually use.
>
> Draw the real shape of your space — beds, paths, fences, trees, structures, water — and place your
> plants where they truly grow. Everything you record afterwards hangs off that map: what you
> planted, what you noticed, what you did, and what still needs doing.
>
> **Map your garden properly**
> Sketch beds and borders, trace paths and fences, and mark every tree and structure. Import a
> photograph or a site plan and trace over it, calibrated to real-world scale, so your map matches
> the ground rather than approximating it.
>
> **Keep a real record**
> Log observations with photos and notes against a specific plant or a specific place. Track tasks
> you actually intend to do. Months later you can see what happened where, instead of trying to
> remember it.
>
> **Works where gardens are**
> Gardens have poor signal. Verdery is built offline-first: create, edit, and record with no
> connection at all, and everything reconciles when you are back in range. Nothing waits on a
> loading spinner.
>
> **On every device**
> Your garden is on your iPhone, your iPad, and the web, always the same map.
>
> **English and Russian**, with full VoiceOver support and Dynamic Type throughout.
>
> Verdery contains no advertising, no tracking, and no analytics SDKs. Your garden is yours.

**Keywords** (100 characters total, comma-separated, no spaces after commas):

```
garden,planner,vegetable,plot,allotment,landscape,plants,map,layout,journal,orchard,greenhouse
```

(92 characters. Do not repeat the app name or the category — Apple already indexes both.)

**What's New in This Version** (for 1.0):

> First release. Map your garden, place your plants, keep observations and tasks against real
> locations, and work fully offline.

**Category**: Primary `Lifestyle`, secondary `Productivity`.
**Age rating**: 4+ — no objectionable content of any kind.
**Copyright**: `2026 Boris Tsekinovsky`

## 7. Store listing (Russian)

The app ships an `ru` catalogue, so a Russian listing should exist. `CFBundleLocalizations` in
`project.yml` declares both languages; without it the store would list the app as English-only
regardless of the bundle's contents.

**Subtitle** (30 max): `Живая карта вашего сада` (23)

**Promotional text**:

> Начертите сад один раз. Verdery сохранит карту, растения и всю историю ухода — и продолжит работать
> без интернета, прямо на грядках.

**Description**:

> Verdery превращает ваш сад в карту, которой действительно можно пользоваться.
>
> Начертите настоящую форму участка — грядки, дорожки, заборы, деревья, постройки, водоёмы — и
> разместите растения там, где они на самом деле растут. Всё, что вы записываете дальше, привязано к
> этой карте: что посадили, что заметили, что сделали и что ещё предстоит.
>
> **Точная карта участка**
> Рисуйте грядки и границы, ведите дорожки и заборы, отмечайте деревья и постройки. Загрузите
> фотографию или план участка и обведите его — с привязкой к реальному масштабу, чтобы карта
> совпадала с землёй, а не приблизительно её напоминала.
>
> **Настоящий дневник сада**
> Записывайте наблюдения с фотографиями и заметками — к конкретному растению или конкретному месту.
> Ведите задачи, которые действительно собираетесь выполнить. Через несколько месяцев вы увидите, что
> и где происходило, вместо того чтобы вспоминать.
>
> **Работает там, где растут сады**
> В саду редко бывает хорошая связь. Verdery работает offline-first: создавайте, редактируйте и
> записывайте вообще без соединения — всё синхронизируется, когда связь вернётся.
>
> **На всех устройствах**
> Ваш сад — на iPhone, на iPad и в вебе. Всегда одна и та же карта.
>
> **Русский и английский языки**, полная поддержка VoiceOver и динамического размера шрифта.
>
> В Verdery нет рекламы, трекинга и аналитических SDK. Ваш сад принадлежит вам.

**Keywords**:

```
сад,огород,грядки,участок,дача,растения,карта,план,планировщик,теплица,дневник,ландшафт
```

**What's New**:

> Первый выпуск. Карта сада, размещение растений, наблюдения и задачи с привязкой к реальным местам,
> полная работа без интернета.

## 8. App Privacy declarations

Derived by auditing `apps/ios/Sources/`, not from a template. The machine-readable half is
`apps/ios/Resources/PrivacyInfo.xcprivacy`; this section is the same content in the shape App Store
Connect's questionnaire asks for.

**Does this app collect data? Yes.**
**Does this app use data for tracking? No.** No advertising identifier is read, no
`AppTrackingTransparency` prompt exists, no analytics or attribution SDK is linked. Only
`FirebaseAuth`, `FirebaseAppCheck`, `FirebaseCore`, and `GRDB` are linked — deliberately no
Analytics, no Crashlytics.

| Data type          | Collected | Linked to identity | Used for tracking | Purpose           | Where it comes from                                               |
| ------------------ | --------- | ------------------ | ----------------- | ----------------- | ----------------------------------------------------------------- |
| Email address      | Yes       | Yes                | No                | App Functionality | Sign-in (Apple, Google, or email link)                            |
| User ID            | Yes       | Yes                | No                | App Functionality | Firebase UID, stamped on every synchronised record                |
| Photos or Videos   | Yes       | Yes                | No                | App Functionality | Plant/observation photos and imported garden plans                |
| Other User Content | Yes       | Yes                | No                | App Functionality | Garden and plant names, observation notes, map labels, soil notes |
| Precise Location   | Yes       | Yes                | No                | App Functionality | See the note below                                                |

**Everything else: not collected.** No name, no phone number, no physical address, no contacts, no
browsing or search history, no purchases, no health or fitness data, no financial data, no
advertising data, no product interaction or performance analytics, no crash data collected by us.

**Why Precise Location is declared even though the app never asks for location permission.** The app
contains no `CoreLocation` code at all — no `CLLocationManager`, no authorisation request, no
`NSLocationWhenInUseUsageDescription`, and its one MapKit view is a non-interactive backdrop that
never shows the user's position. Two things still amount to precise location leaving the device:

1. A garden's georeference anchor is a real-world coordinate of the user's property, entered as
   content and synchronised to the server.
2. Photo bytes are uploaded **unmodified**, so any EXIF GPS tag the camera wrote travels with them.
   No stripping code exists (`apps/ios/Sources/CoreMediaTransfer/`).

Declaring "no location" on the strength of "we never called CoreLocation" would be the dishonest
reading of the same facts. Point 2 is also worth fixing on its own merits — see
[12. Known gaps](#12-known-gaps).

**Diagnostics stay on device.** `CoreObservability` logs only through Apple's `OSLog`. There is no
crash reporter and no remote log sink.

## 9. App Review notes

Paste into App Store Connect → App Review Information → Notes. Not needed for TestFlight internal
testing.

> **Sign-in is required**, because a garden is private, synchronised, per-account data; there is no
> useful signed-out state. A demo account is provided below.
>
> **Demo account**: `<email>` / `<password>`
> Sign in with the "Continue with email" option on the sign-in screen and enter the demo address.
> The account is pre-seeded with one garden that already has a drawn map, several plants,
> observations with photos, and open tasks, so no setup is needed to see the app's purpose.
>
> **Sign in with Apple and Google** are also offered, but please use the email demo account —
> the federated flows are tied to real accounts we cannot share.
>
> **Suggested walkthrough**
>
> 1. Sign in with the demo account. The gardens list appears with one garden.
> 2. Open the garden → "Map". The drawn garden loads. Beds, paths, and plants are tappable; the
>    accessible object list beside the canvas is a full VoiceOver-navigable alternative to tapping
>    shapes.
> 3. Open "Plants" → any plant → the detail screen shows its photos, condition notes, and history.
> 4. Open "Tasks" for the same garden to see scheduled care.
> 5. To see the offline behaviour, enable Airplane Mode and edit anything. Changes are accepted
>    locally and reconcile when connectivity returns.
>
> **Account deletion** is available in-app at Settings → Account → Delete Account, which permanently
> deletes the account and all associated gardens, photos, and history.
>
> **Photo access**: the app uses SwiftUI's `PhotosPicker` only, which runs out of process and grants
> the app no photo-library access, so no photo-library permission prompt appears. This is why no
> `NSPhotoLibraryUsageDescription` is present.
>
> The app contains no advertising, no third-party analytics, and no tracking.

The account-deletion paragraph above **describes something that does not exist yet**. Do not submit
this text until [10](#10-account-deletion-a-hard-blocker) is resolved.

## 10. Account deletion — a hard blocker

App Store Review Guideline **5.1.1(v)** requires any app that supports account creation to offer
account deletion _from within the app_. Verdery creates accounts and currently offers only sign-out.
There is no `deleteAccount` path anywhere in `apps/ios/Sources/`. **This alone will fail review.** It
does not affect TestFlight.

`P8-DELETE-01` is building the server side in parallel. What the iOS client must then add:

1. A **Settings → Account** screen with a "Delete Account" action, reachable in a small number of
   taps from the app's main navigation — Apple checks that it is not buried.
2. A confirmation step that names what is destroyed: every garden, map, plant, observation, task, and
   photo — not just the login.
3. A call to `P8-DELETE-01`'s account-deletion endpoint, plus local teardown: sign out of Firebase,
   delete the per-profile SQLite database (`CorePersistence.LocalDatabase`), and discard any queued
   outbox operations and pending media in `CoreMediaTransfer`'s local store. A deletion that leaves
   the local database intact would repopulate the UI from cache and look like it failed.
4. Honest handling of the asynchronous case. If deletion is queued rather than immediate, the app
   must say so and state when it completes; Apple accepts a grace period that is disclosed and
   rejects one that is not.
5. If the account was created with Sign in with Apple, **revoke the Apple token** at deletion
   (`Auth.auth().revokeToken(withAuthorizationCode:)`). Apple requires this specifically and checks
   for it.

This is the single largest remaining item between the current state and a submittable app, and it is
client work that cannot start until `P8-DELETE-01`'s endpoint contract lands.

## 11. Screenshots

**None have been captured, and none can be captured from the current codebase without an owner
action first.** Two independent reasons, and it is worth being exact about which is which:

1. **Environment.** This machine's Xcode has no iOS _device_ platform component and no simulator
   runtime matching its iphonesimulator SDK. That is a download
   (`xcodebuild -downloadPlatform iOS`), not a code problem.
2. **Content.** A screenshot of an empty app is worthless and Apple rejects placeholder screenshots.
   Meaningful screenshots need a signed-in account with a drawn garden, plants, photos, and tasks —
   i.e. the same seeded demo account that App Review needs (owner action 7). This is the real
   blocker; the environment half resolves itself with a download.

### Required sizes

App Store Connect derives smaller sizes from larger ones, so only these two sets must be uploaded —
and the iPad set is required only for as long as the app declares iPad support (see
[5](#5-named-decisions-still-open)).

| Set         | Pixels (portrait) | Count | Captured on                    |
| ----------- | ----------------- | ----- | ------------------------------ |
| iPhone 6.9" | 1320 × 2868       | 3–10  | iPhone 16 Pro Max / 17 Pro Max |
| iPad 13"    | 2064 × 2752       | 3–10  | iPad Pro 13-inch (M4)          |

Landscape orientations are accepted at the transposed resolutions. Minimum three per set.

### Suggested shots, in order

1. The garden map, drawn and populated — this is the product in one image.
2. A plant detail screen with photos and condition history.
3. The observations timeline.
4. The tasks list.
5. Plan import / calibration, showing a traced site plan.

### The automation, once a simulator exists

`apps/ios/scripts/capture-screenshots.sh` boots the required simulators, installs a simulator build,
and captures whatever is on screen to correctly-named files. It automates the mechanical half only:
it cannot navigate the app. Driving it to specific screens needs either manual interaction while the
script waits, or an `XCUITest` target with `XCUIScreen.main.screenshot()` at each checkpoint, which
this project does not have — the package's test suite is unit tests only, by design
(`apps/ios/README.md`, "Testability"). Adding that target is the right long-term answer and is not in
this work package.

## 12. Known gaps

Ordered by how much they matter.

1. **No in-app account deletion.** Fails App Store review outright. See
   [10](#10-account-deletion-a-hard-blocker). Does not block TestFlight.
2. **No screenshots.** Blocks submission; needs a seeded demo account. See
   [11](#11-screenshots).
3. **No privacy policy URL.** Blocks submission and TestFlight _external_ testing. Blocked on
   `P8-PRIV-01`. Internal TestFlight is unaffected.
4. **Photo EXIF is uploaded unmodified**, GPS tags included. Not a submission blocker — it is
   declared honestly in [8](#8-app-privacy-declarations) — but stripping location metadata on upload,
   or asking the user, is the behaviour most users would expect. `CoreMediaTransfer` is where it
   would go.
5. **Push notifications are declared nowhere because the client implements nothing.** `P7-NOTIF-02`
   built server-side device registration, but `apps/ios/Sources/` contains no
   `UNUserNotificationCenter`, no `registerForRemoteNotifications`, and no `FirebaseMessaging`. The
   app has no `aps-environment` entitlement, correctly. When the client half is built, the entitlement
   and a `UIBackgroundModes` entry must be added to `project.yml` and the App ID's push capability
   enabled in the developer portal.
6. **App Check runs in debug-provider mode for any DEBUG build** and its tokens are rejected unless
   registered in the Firebase console. Release builds use App Attest. This is expected while App
   Check is monitor-only, but a TestFlight build is a Release build, so App Attest runs for real
   there for the first time.
7. **Sign in with Apple and Google have never been exercised on a device or simulator.** They compile
   and are wired correctly, but the first genuine test of the OAuth redirect and the
   `CFBundleURLSchemes` entry will be the first TestFlight install.
8. **The `Verdery.xcodeproj` remains committed** even though it is fully generated. CI and the upload
   script both regenerate it, so drift is now detected rather than silent; removing it from version
   control entirely would be tidier and is a reasonable follow-up.

### What the first-ever iOS build found

All four were fixed in this work package. They are recorded because each was invisible to
`swift build`, `swift test`, and CI for four phases, and the shape of the blind spot matters more
than the individual bugs.

1. **`CoreAuthentication/FirebaseAuthenticationGateway.swift` did not compile for iOS.** Both
   `signInWithGoogle()` and `signInWithApple()` resumed a continuation with `AuthDataResult`, a
   main-actor-isolated non-`Sendable` type — a hard Swift 6 error. The code lives behind
   `#if os(iOS)`, and `swift build` compiles the package for macOS, so nothing had ever type-checked
   it. Fixed by reading the ID token inside the callback so only a `String` crosses the boundary,
   and by factoring the two near-identical wrappers into one helper.
2. **`Verdery.xcodeproj` had drifted four phases behind `project.yml`.** It was generated in Phase 2
   and never regenerated, so `Sources/VerderyApp/AppDelegate.swift`, added in Phase 6, was absent
   from it — the app would not link.
3. **`GoogleService-Info.plist` was never in the app bundle.** `project.yml` listed it under a
   `resources:` key, which XcodeGen does not have and silently ignores. Every build since Phase 2
   would have trapped in `FirebaseApp.configure()` on launch. Resources now sit under `sources:`,
   where XcodeGen routes them to the Copy Bundle Resources phase by file type.
4. **The build number could not be overridden.** XcodeGen baked `CFBundleVersion` into the generated
   `Info.plist` as the literal `1` rather than `$(CURRENT_PROJECT_VERSION)`, so
   `xcodebuild CURRENT_PROJECT_VERSION=…` had no effect. Every TestFlight upload after the first
   would have been rejected for a duplicate build number, with nothing in the output explaining why.

The common cause is that nothing ever built the app target — CI ran `swift build`/`swift test`
only, both of which target macOS. CI now builds for `iphoneos` and fails if a fresh
`xcodegen generate` would change the committed project.

## 13. Staged rollout and rollback

- **TestFlight internal** (up to 100 App Store Connect users, no review) is the whole of the current
  goal. Builds are available minutes after processing.
- **TestFlight external** (up to 10,000 testers) needs a Beta App Review and a privacy policy URL.
- **App Store phased release** (App Store Connect → Version → Phased Release for Automatic Updates)
  rolls an update to 1/2/5/10/20/50/100% of existing users over seven days. Use it for every update
  after 1.0. It does not apply to the first release.
- **Rollback.** There is no way to un-ship an iOS build. The only real controls are: pause a phased
  release (immediate, from App Store Connect, and it stops further rollout without reverting anyone
  already updated), then ship a fixed build via **Expedited Review** if the fault is severe. Plan the
  server side accordingly — a released client must stay compatible with the API, because the fleet
  cannot be rolled back the way `verdery-web-dev` can. Removing the app from sale is available but
  affects only new downloads, not installed copies.
