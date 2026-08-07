# iOS distribution — TestFlight and the App Store

How a Verdery build gets from this repository onto a device, and everything App Store Connect
asks for that a human has to paste in. Work package `P8-STORE-01`.

The build mechanics, the store copy, and the privacy declarations are all finished and checked in.
Verdery 1.0 build 192 was accepted for TestFlight processing on July 27, 2026, and build 245 — the
identical source tree, since no `apps/ios/**` file changed between the two — was uploaded and
accepted for processing on August 1, 2026, confirming the same authenticated-Xcode-account upload
path (section 4) still works unattended run to run. The remaining owner-account actions are
enumerated once in [1. Owner action checklist](#1-owner-action-checklist).

## 0. Where things stand

| Piece                                                 | State                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| An iOS app target that compiles for a real device     | Done — `xcodebuild archive` succeeds                                       |
| App icon, launch screen, privacy manifest, Info.plist | Done — `apps/ios/Resources/`, `apps/ios/project.yml`                       |
| A signed, distribution-ready `.ipa`                   | **Produced and verified locally** — see [2](#2-what-has-actually-been-run) |
| TestFlight upload                                     | **Build 192 uploaded successfully; Apple processing started**              |
| Store listing copy, English and Russian               | Done — [6](#6-store-listing-english) and [7](#7-store-listing-russian)     |
| App Privacy declarations                              | Done, derived from the code — [8](#8-app-privacy-declarations)             |
| Review notes and demo account                         | Drafted — [9](#9-app-review-notes); the account itself is an owner action  |
| In-app account deletion                               | **Blocked** on `P8-DELETE-01` — [10](#10-account-deletion-a-hard-blocker)  |
| Screenshots                                           | **Not captured** — [11](#11-screenshots)                                   |

Bundle identifier `com.verdery.app`. Apple Developer team `3M68DG8S7N`. Deployment target iOS 18.0,
iPhone only (`TARGETED_DEVICE_FAMILY = "1"`).

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
- The App Store Connect app record exists. App Store Connect accepted Verdery 1.0 build 192 and
  started processing it.
- A distribution signing certificate and a matching provisioning profile exist.
- The signed upload path through the Xcode account is operational.

**Still required, in order:**

1. **Confirm the Agreements, Tax, and Banking status** — App Store Connect → Business. The Free
   Applications agreement must read "Active". _A pending agreement leaves an uploaded build stuck in
   "Processing" forever with no error shown anywhere._ (The Program License Agreement is separately
   confirmed accepted, above; this is the paid/free applications one, which is not exercised by
   signing and so could not be verified here.)
2. **Add the first TestFlight internal testers after build 192 finishes processing** — App Store
   Connect → your app → TestFlight →
   Internal Testing. Internal testers need only an App Store Connect user account, and receive builds
   with no Apple review of any kind. _This is the step that puts the app on the owner's phone._

For unattended CI uploads, preserve the App Store Connect team key's Issuer ID alongside the existing
Key ID and private `.p8` file. The July 27 upload did not need that missing value because it used the
authenticated Xcode account. This is operational hardening, not a blocker for the accepted build.

Those two actions are the entire remaining path to a build in the owner's hands. Everything below is App Store
submission only, and none of it blocks TestFlight:

3. **Create the reviewer demo account** — see [9](#9-app-review-notes).
4. **Decide the support and privacy-policy URLs** — see [5](#5-named-decisions-still-open).
5. **Ship in-app account deletion** — see [10](#10-account-deletion-a-hard-blocker). This is
   engineering work, not an account action, and it is the largest remaining item.

## 2. What has actually been run

Distinguishing verified from assumed, because most of this document's value depends on the
difference.

**Verified on this machine:**

- `swift build` and `swift test` — 934 tests in 129 suites, all passing.
- `xcodebuild -scheme Verdery -destination 'generic/platform=iOS Simulator' build` — the complete
  SwiftUI application, including `FeatureMap`, compiles and links for both simulator architectures.
- `xcodebuild -target Verdery -sdk iphoneos -arch arm64 build` — the shipped app compiles for a real
  device. This had **never been run before**, and it failed the first time; see
  [12. Known gaps](#12-known-gaps) for what it found.
- `xcodebuild archive -destination 'generic/platform=iOS'` — a real `.xcarchive` with a dSYM.
- `./scripts/archive-and-upload.sh --validate-only` — end to end, producing a **signed 8.7 MB
  `Verdery.ipa`** with:
  - certificate type `Cloud Managed Apple Distribution`,
  - `application-identifier` `3M68DG8S7N.com.verdery.app`,
  - `beta-reports-active: true`, `get-task-allow: false`,
  - `com.apple.developer.applesignin: [Default]`,
  - `CFBundleVersion 192`, `CFBundleShortVersionString 1.0`,
  - `Assets.car` carrying all 17 icon slots including the 1024×1024 marketing icon,
  - `GoogleService-Info.plist`, `PrivacyInfo.xcprivacy`, `embedded.mobileprovision`,
    `_CodeSignature`.

**Uploaded:** Xcode reported `Upload succeeded` for Verdery 1.0 build 192 on July 27, 2026, and App
Store Connect started processing the package. **Repeated for build 245 on August 1, 2026** — same
signing identity (`Apple Distribution: Boris Tsekinovsky (3M68DG8S7N)`), same `beta-reports-active`/
`get-task-allow: false`/`com.apple.developer.applesignin` entitlement shape, `Upload succeeded`
again — confirming this path is reproducible, not a one-off. Availability to testers follows Apple's
processing and the internal-group assignment in owner action 2.

**Not verifiable anywhere but a real device:** Sign in with Apple, Google sign-in, and App Attest.
See [12](#12-known-gaps).

## 3. Building

Everything below runs today, with no Apple credentials.

```sh
cd apps/ios
swift build && swift test           # the package: 934 tests, 129 suites
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

# The unattended CLI upload, after recording the team key's Issuer ID.
VERDERY_ASC_KEY_ID=XXXXXXXXXX \
VERDERY_ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
VERDERY_ASC_KEY_PATH=~/private_keys/AuthKey_XXXXXXXXXX.p8 \
  ./scripts/archive-and-upload.sh
```

The script archives with `xcodebuild archive`, exports a signed IPA, and uploads it with `altool`
using the App Store Connect API key. It chooses plain `xcodebuild` over fastlane deliberately — the
reasoning is in the script's own header, and the short version is that fastlane would be the only
Ruby in this repository to wrap three commands Apple now supports first-party.

Build 192 used the equivalent authenticated-Xcode fallback: the same archive was exported with
`destination=upload` and App Store Connect reported `Upload succeeded`. This path is appropriate for
an attended developer machine; the API-key script remains the reproducible CI path once the Issuer ID
is stored securely.

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
- ~~**iPad support.**~~ Resolved: the family is `"1"`, iPhone only. The redesign is drawn for one
  hand outdoors — thumb-reachable actions, a bottom chassis, a camera-first capture loop — and none
  of that is an iPad layout scaled up. Declaring a device nobody designs for or tests on buys an
  audience an unfinished experience. Done before release deliberately: dropping a declared device
  family after release is not a one-line change. An iPhone-only binary still installs on iPad in
  compatibility mode, which App Review does not treat as a defect, and the iPad screenshot set is no
  longer required.

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
2. ~~Photo bytes are uploaded unmodified, so any EXIF GPS tag travels with them.~~ Fixed:
   `CoreMediaTransfer.PhotoPreparation` reads the coordinate out and then removes it, before the
   file is persisted or uploaded. The removal is structural rather than a deletion — the image is
   redrawn from pixels into a fresh destination, so nothing survives that was not explicitly
   copied, which is stronger than deleting the GPS dictionary and hoping no other tag carries a
   location. The coordinate stays on the device, where it proposes which bed a plant is in.

Declaring "no location" on the strength of "we never called CoreLocation" would be the dishonest
reading of the same facts, and point 1 still stands: a georeference anchor is a real coordinate of
somebody's property, entered as content.

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

1. ~~**No in-app account deletion.**~~ Built. `FeatureAuthentication.DeleteAccountView`, reachable
   in two taps — the console strip's avatar, then one button on the account screen. It names what is
   destroyed rather than saying "your account", states each garden's resolution before the deadline
   rather than after it, discloses the recovery deadline (Apple accepts a disclosed grace period and
   rejects an undisclosed one), and requires a typed confirmation.

   Two parts of it were prerequisites rather than screen work. The Apple authorization code is now
   retained in the Keychain at sign-in (`CoreAuthentication.AppleAuthorizationCodeStore`) because
   `revokeToken(withAuthorizationCode:)` needs it and the sign-in flow used to discard it — without
   that, revocation is impossible and Apple checks for revocation specifically. And the local
   teardown erases the whole profile directory, not the database file: section 10.3's warning that a
   surviving cache "would repopulate the UI from cache and look like it failed" applies equally to
   SQLite's `-wal` and `-shm` companions and to the media files beside them.

   Still unverifiable here: the revocation call itself has never run on a device. See section 13.

2. **No screenshots.** Blocks submission; needs a seeded demo account. See
   [11](#11-screenshots).
3. **No privacy policy URL.** Blocks submission and TestFlight _external_ testing. Blocked on
   `P8-PRIV-01`. Internal TestFlight is unaffected.
4. ~~**Photo EXIF is uploaded unmodified**, GPS tags included.~~ Closed:
   `CoreMediaTransfer.PhotoPreparation` strips it, and reduces an oversized capture to a 2048-pixel
   longest edge on the same pass — which also stops the identification provider refusing a
   thirty-megabyte original with a bare `400` that a person reads as "no species found".
5. **Push notifications are implemented; one portal action remains.** `project.yml` declares the
   `aps-environment` entitlement (`development` locally) and the `remote-notification` background
   mode, and `scripts/archive-and-upload.sh` rewrites the entitlement to `production` before
   archiving — it is a plist entry, not a build setting, so an `xcodebuild` override cannot reach
   it. Getting that value wrong fails **silently**: the app registers a token APNs never delivers
   to and nothing reports an error, which is why the rewrite is a script step rather than a
   convention.

   **Owner action, not a code change:** the App ID `com.verdery.app` needs the Push Notifications
   capability enabled in the developer portal, and an APNs authentication key uploaded to the
   Firebase project, before any real device receives a push. Until then the client registers
   nothing (no token is issued) and every notification screen still works — the inbox is the
   durable record and push only announces it.

6. **App Check was not provisioned for `verdery-dev` during this inventory.**
   `firebaseappcheck.googleapis.com` was enabled on July 27, 2026, and the web
   reCAPTCHA provider was registered. Native enforcement is still blocked:
   the App Attest provider for `com.verdery.app` and a real-device `valid`
   classification have not been verified. App Check remains monitor-only and
   the client correctly sends requests without the header when attestation
   fails (see [what build 156 found](#what-build-156-found)).
7. **An emailed sign-in link cannot return to the app.** It now points at the deployed web handler
   (`/auth/email-link`), which completes the sign-in in a browser. Capturing it in the app instead
   needs three things that do not exist: the `ASSOCIATED_DOMAINS` capability on the `com.verdery.app`
   App ID (which carries only `IN_APP_PURCHASE` and `APPLE_ID_AUTH`), a
   `com.apple.developer.associated-domains` entitlement listing
   `applinks:verdery-web-dev-t6amsr5o6a-uc.a.run.app`, and an `apple-app-site-association` document
   served by that host at `/.well-known/` over HTTPS with no redirect. All three must land together;
   any one alone changes nothing.
8. **Sign in with Apple and Google now use each provider's native SDK, and only Google has been
   exercised on a device.** Build 157 was the first genuine test of either, and it found that
   Firebase's generic IDP web flow cannot complete Google sign-in at all — see
   [what build 157 found](#what-build-157-found). Both providers now present their own sheet, so
   neither depends on Firebase's `/__/auth/handler` page any more. Apple's native path still has
   never run on a device.
9. **The `Verdery.xcodeproj` remains committed** even though it is fully generated. CI and the upload
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

### What build 156 found

The first build a real person signed into on a real device. Both findings share the shape of the
four above: invisible to every test, because both depend on cloud project configuration that no
test environment has.

1. **Every authenticated screen reported "Something went wrong on our side."**
   `HTTPTransport.makeRequest` awaited the App Check token with `try`, so a failure to obtain one
   aborted the request before it was built. At the time, `verdery-dev` did not
   have `firebaseappcheck.googleapis.com` enabled, so obtaining one always
   failed — in Release via App Attest and in DEBUG via the debug provider,
   both refused at the exchange with `SERVICE_DISABLED`. The API was enabled
   on July 27, 2026; this paragraph records the build-156 incident, not current
   project state.
   The thrown error was not an `APIGatewayError`, so it fell into each view model's generic `catch`,
   which reports `error.server.unexpected`.

   The evidence that settles it, rather than the reasoning that suggests it: `verdery-api-dev`'s
   Cloud Run request log contains **no iOS user agent at all** over fourteen days, while
   `GET /v1/gardens` issued by hand with a real Firebase ID token and **no App Check header**
   answers `200 {"items":[]}`. The app was never talking to the server; the server was never
   refusing it.

   The owner reported this as "it happens when there are no gardens". That was an accurate
   observation of _when_ they saw it and a coincidence of _why_: the garden list is the first screen
   after sign-in, so an account with no gardens has nothing else to look at. Any account would have
   seen it. Fixed by making the App Check token best-effort — see
   [identity-and-authorization.md, section 12](../architecture/identity-and-authorization.md#12-app-check).

2. **The emailed sign-in link led to a 404.** `ActionCodeSettings.url` was hard-coded to
   `https://verdery-dev.firebaseapp.com/emailSignIn`. Firebase accepted it, generated the link, and
   mailed it; the host simply serves Firebase's "Site Not Found" page, because this project has no
   Firebase Hosting site. From the reader's side that is indistinguishable from the email never
   arriving. The continue URL is now a build input (`WEB_ORIGIN` → `VerderyWebOrigin`, the same
   shape as `API_ORIGIN`) pointing at the deployed web application's own working
   `/auth/email-link` handler, which the web client has always used.

### What build 157 found

The first build a real person tried to sign into with Google. One finding, and it has the same shape
as the crash that moved Apple off the same flow one build earlier: Firebase's generic IDP web flow is
not a supported way to sign a native app in with a first-party provider.

1. **Google sign-in failed with "Unable to process request due to missing initial state."** That
   string comes from Firebase's own web auth handler page. `signInWithGoogle()` was
   `signIn(providerID: "google.com")`, which opens the project's
   `/__/auth/handler` page in an `SFSafariViewController`. That page writes the flow's state into
   the browser's `sessionStorage` before redirecting to Google and looks it up again on the way
   back — but that storage is partitioned from Safari's and discarded with the view controller, so
   the lookup finds nothing.

   What the evidence ruled out matters as much as what it showed.
   `https://verdery-dev.firebaseapp.com/` answers `404` (this project has no Hosting site), but
   `/__/auth/handler` and `/__/auth/iframe` both answer `200`: the page is served, only its state
   is gone. The archive's
   `CFBundleURLSchemes` entry matches `REVERSED_CLIENT_ID` exactly, so the callback scheme was never
   the fault either.

   Fixed by moving Google to its own SDK — `GoogleSignIn-iOS`, pinned `from: "9.2.0"`, the single
   dependency the repository owner approved for this. `GIDSignIn` presents Google's sheet, and the
   returned `idToken`/`accessToken` become a `GoogleAuthProvider` credential for
   `Auth.auth().signIn(with:)`. The client ID is read from the bundled `GoogleService-Info.plist`
   through `FirebaseApp.app()?.options.clientID`, so it appears in no source file. Nothing in the
   app uses Firebase's federated web flow now, so the private generic `signIn(providerID:scopes:)`
   helper was deleted with it; `.onOpenURL` still reaches `Auth.auth().canHandle`, which the email
   magic link continues to need, after `GIDSignIn.handle(_:)` has had its turn.

   Adding the SDK downgrades `gtm-session-fetcher` from 5.3.0 to 3.5.0. That is forced by
   GTMAppAuth 5.0.0 and is inside the range firebase-ios-sdk 12.16.0 itself declares, which is why
   the resolver accepted it.

   A real Google sign-in still cannot be verified anywhere but a device: it needs interactive
   consent. What is verified is that the SDK is linked into `Verdery.app` (225 `GIDSignIn` symbols,
   plus `GoogleSignIn_GoogleSignIn.bundle`), that the client ID is read rather than hard-coded, and
   that a dismissed sheet now reports `CoreAuthenticationError.cancelledByUser`, which the sign-in
   screen treats as a return to rest rather than an error banner.

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
