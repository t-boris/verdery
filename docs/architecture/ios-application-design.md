# Native Apple Application Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines the detailed architecture of the native Grow Garden application for iPhone and iPad. The application uses Swift, SwiftUI, GRDB, SQLite, Swift concurrency, and platform frameworks for camera, AR, location, media, and notifications.

## 2. Goals

- Provide a responsive native experience on iPhone and iPad.
- Preserve essential garden work without connectivity.
- Support device-specific capture and measurement capabilities.
- Keep presentation, application behavior, persistence, synchronization, and platform integrations independently testable.
- Avoid global mutable state and oversized view models.
- Keep domain meaning aligned with the web client and server contracts.

## 3. Support Policy

The first release targets the current public iOS/iPadOS major version and supported predecessor versions that retain the required SwiftUI, ARKit, background transfer, and security capabilities. The exact minimum deployment version is pinned when implementation begins and reviewed for every major release.

Feature availability is capability-based rather than device-name-based. The application checks camera, depth, LiDAR, AR tracking, memory, and operating-system support at runtime and offers an appropriate capture tier.

## 4. Application Structure

```text
GrowGardenApp
│
├── AppComposition
├── Core
│   ├── Domain
│   ├── Persistence
│   ├── Networking
│   ├── Synchronization
│   ├── Authentication
│   ├── MediaTransfer
│   ├── Observability
│   └── PlatformCapabilities
│
└── Features
    ├── Authentication
    ├── GardenList
    ├── GardenMap
    ├── Plants
    ├── Observations
    ├── Tasks
    ├── Recommendations
    ├── PlanImport
    ├── GardenCapture
    ├── MediaLibrary
    ├── Collaboration
    └── Settings
```

Each feature owns its screens, presentation state, navigation destinations, application use cases, and feature-specific adapters. Core packages contain capabilities that are shared by multiple features and have stable responsibilities.

## 5. Layer Responsibilities

### 5.1 Presentation

SwiftUI views render immutable view state and emit user intents. Views do not call GRDB, Firebase, URLSession, Cloud Storage, or AR services directly.

Feature view models:

- Are isolated to the main actor when they publish UI state.
- Invoke application use cases.
- Convert domain results into display state.
- Own transient interaction state, not durable domain authority.
- Remain small enough to represent one screen or cohesive editor flow.

Every view composes from `CoreDesignSystem`, the shared visual language: the
palette, the type scale, the spacing and radius steps, and the small set of
primitives (`SurfaceCard`, `Chip`, `IconMedallion`, `EmptyStateView`,
`InlineMessage`, the button styles) that screens are built from. It is the iOS
counterpart of `apps/web/shared/ui/tokens.css` and carries the same
"botanical ledger" identity — warm paper canvas, deep fir green, a serif face
for headings — so the two clients read as one product. `CoreDesignSystem`
depends on nothing, not even `CoreDomain`; a domain value's symbol and tone are
chosen by a per-feature table (`TaskSymbols`, `PlantSymbols`, `GardenSymbols`,
`TodaySymbols`, `ObservationSymbols`), because which SF Symbol stands for
"urgent" is a presentation decision.

The interface is icon-led: state that used to be a labelled sentence — task
status and urgency, plant lifecycle stage, garden lifecycle and role,
observation kind, pending synchronization — is rendered as a symbol plus a
short label, never a symbol alone. Symbols are sized by text style and
`imageScale`, never by a point size, so they scale with Dynamic Type and sit on
the adjacent label's baseline; every touch target still clears 44 points
however small the symbol inside it is drawn.

### 5.2 Application

Application use cases coordinate domain rules, repositories, local transactions, synchronization, and platform services. Examples include:

- `CreateGarden`
- `ApplyMapCommand`
- `RecordObservation`
- `CompleteTask`
- `PrepareMediaUpload`
- `StartPlanImport`
- `AcceptCaptureProposal`
- `ResolveSyncConflict`

Use cases return typed outcomes and recoverable errors. They do not depend on SwiftUI.

### 5.3 Domain

The domain layer defines platform-neutral concepts such as garden identifiers, geometry metadata, plant placement, observation, task state, recommendation evidence, revisions, provenance, and measurement uncertainty.

Server transport models and SQLite rows are mapped into domain types. They do not become the domain model directly.

### 5.4 Infrastructure

Infrastructure adapters implement repository, network, authentication, media, capture, location, notification, and telemetry protocols. Adapters are injected through explicit constructors from a single application composition root.

## 6. State Ownership

| State                           | Owner                                     |
| ------------------------------- | ----------------------------------------- |
| Durable garden and plant data   | SQLite                                    |
| Pending synchronized operations | SQLite outbox                             |
| Media transfer state            | SQLite plus background transfer subsystem |
| Current authenticated identity  | Firebase Authentication adapter           |
| Screen presentation state       | Feature view model                        |
| Map selection and gesture state | Garden Map editor session                 |
| Capture session state           | Capture coordinator                       |
| Remote accepted revision        | SQLite synchronization metadata           |

The application must be able to reconstruct important state after process termination. Long-running flows cannot depend only on in-memory objects.

## 7. Local Persistence

GRDB provides access to one application-owned SQLite database per signed-in profile. Guest or pre-authentication state uses a separate disposable store.

The database contains:

- Local read models for synchronized domain records.
- Local-only drafts.
- Pending outbox operations.
- Synchronization cursors and conflict records.
- Media upload records.
- Capture-session recovery metadata.
- Cache metadata for replaceable remote content.

Every user mutation that must survive offline execution uses one SQLite transaction to:

1. Validate the local precondition.
2. Update the local read model.
3. Append an outbox operation.
4. Record the base server revision.

Database migrations are explicit, ordered, reversible where practical, and tested against representative prior schemas. Destructive fallback migration is prohibited for user-created data.

## 8. Synchronization Integration

The synchronization engine is a long-lived application service, not a view responsibility. It reacts to:

- Authentication changes.
- Connectivity changes.
- App foreground/background transitions.
- Explicit user retry.
- Background processing opportunities.
- Local outbox inserts.

It performs bounded push and pull cycles, persists progress after each accepted batch, and exposes summary status through a read-only observable interface.

The user interface distinguishes:

- Saved locally.
- Waiting for connectivity.
- Synchronizing.
- Synchronized.
- Requires attention.
- Upload pending.

Conflict details and recovery actions are persisted so they survive application restart.

## 9. Networking

The API client uses URLSession and generated OpenAPI models or a thin generated transport layer. A handwritten application gateway wraps generated operations and maps transport types to domain types.

Networking requirements include:

- Firebase ID token injection.
- App Check token injection where required.
- Correlation and idempotency headers.
- Bounded retries for safe operations.
- Exponential backoff with jitter.
- Explicit timeouts.
- Structured error decoding.
- Redaction of tokens and sensitive payloads from logs.

Automatic retry is limited to idempotent requests or commands carrying an idempotency key.

## 10. Authentication

The initial sign-in methods are:

- Sign in with Apple.
- Google Sign-In.
- Email magic link.

Firebase Authentication owns credentials and token refresh. The application database owns the mapped application profile, garden memberships, and roles.

On sign-out:

- Active synchronization is cancelled.
- Background transfers are paused or detached according to ownership policy.
- The profile database is closed.
- Sensitive local data is removed or retained only through an explicit offline-account policy.
- Cached tokens are cleared through Firebase APIs.

## 11. Garden Map Feature

The map editor uses an editor-session object with:

- A read-only base document derived from SQLite.
- A selected-object set.
- A transient gesture preview.
- A command stack for undo and redo.
- Snap guides and measurement overlays.
- Local validation results.
- A commit boundary that writes durable domain commands.

SwiftUI Canvas and Core Graphics render the local garden scene. MapKit provides optional geographic and imagery context. The garden editor is not implemented as mutable SwiftUI view state per vertex.

Expensive geometry calculations run outside the main actor. Render snapshots are immutable and replaced atomically.

## 12. Capture Architecture

Device capture uses adapters around:

- AVFoundation.
- PhotosUI.
- Vision.
- ARKit.
- Core Location.
- Core Motion where justified.
- Core ML for approved on-device models.

The capture coordinator owns the session lifecycle and emits application-owned capture observations. Platform framework objects do not cross into persistent domain records.

A capture flow persists a recoverable session record before collecting large media. The result is a proposal that requires user review before it modifies accepted garden geometry.

## 13. Media Transfer

Large media uses background-capable resumable upload coordination. Transfer records contain the media identifier, local file URL, checksum, byte count, upload session state, retry state, and server ownership information.

Local media files move through explicit states:

```text
captured → registered → queued → uploading → verifying → retained/deleted
                                 └──────────→ failed/recoverable
```

The application never deletes the only local copy until the server confirms upload integrity or the user deliberately discards it.

## 14. Navigation

A garden is the workspace every record belongs to, so choosing one is a mode
switch rather than a push. The authenticated root is therefore one of two
things: the garden picker, or — once a garden is chosen — that garden's tab
bar. "Switch garden" returns to the picker.

Inside a garden, the five surfaces a gardener moves between constantly and in
no fixed order are tabs, each with its own `NavigationStack` so each keeps its
own history: **Today**, **Tasks**, **Plants**, **Journal** (observations), and
**Map**. Five, not six — iPhone collapses a sixth into a "More" list.

Garden settings are behind one button present on every tab, presented as a
sheet, and hold only what configures a garden: its name, its lifecycle, the
property plan behind its map, the synchronization conflicts awaiting
resolution, and service status. They are deliberately not the app's front door;
they were until work package P8-UX-01, when the primary surfaces were
`NavigationLink`s inside the settings form.

The account screen is reached from the leading toolbar slot of both signed-in
shells — the garden picker, and every tab of one garden, beside the garden
button — and is presented as a sheet. It is deliberately not a sixth tab, and
deliberately not inside garden settings: an account belongs to no garden. It
shows only what the client genuinely holds about the signed-in profile (display
name or address, sign-in method, whether the address is confirmed) plus this
build's version, build number, and language, and it owns the only sign-out in
the application. Signing out is confirmed first, because work recorded offline
and not yet uploaded stays on the device until the next sign-in.

A typed application router owns major destinations and modal flows. Features declare destinations without reaching into other feature view hierarchies.

Deep links are parsed into typed intents, authenticated, authorized against locally known state where possible, and resolved through normal application use cases.

### 14.1 Collaboration Boundary

The native application supports operational household and professional team participation through ordinary owner/editor/viewer garden membership and assignment-aware synchronization.

The initial professional client experience is responsive web, not a full native operational garden. Client invitation links opened on iOS route to the authenticated web portal or an approved universal-link handoff. If a native client portal is introduced later, it uses a publication-only read model and never opens the operational garden database for a client engagement.

## 15. Concurrency

- Swift structured concurrency is the default asynchronous model.
- UI state is main-actor isolated.
- SQLite writes use controlled GRDB writer queues and transactions.
- Sync, upload, and capture coordinators define cancellation behavior.
- Detached tasks are prohibited unless ownership and cancellation are explicit.
- `Sendable` boundaries are enforced for cross-actor data.
- Platform delegate APIs are wrapped into bounded async streams or continuations.

## 16. Error Handling

Errors are classified as:

- User-correctable validation errors.
- Authentication or authorization failures.
- Connectivity and retryable service failures.
- Synchronization conflicts.
- Media-transfer failures.
- Unsupported-device capability.
- Corrupt or incompatible local data.
- Internal defects.

User-facing errors provide a safe next action. Internal errors retain correlation identifiers but do not reveal tokens, paths, raw provider responses, or private media details.

Plant edit forms validate the same grouping invariant as plant creation before sending a mutation: an individual plant omits quantity, while a row or group requires a positive integer. This prevents a locally editable form from submitting a request the server's plant aggregate must reject.

## 17. Security and Privacy

- Keychain stores authentication-related secrets under appropriate accessibility classes.
- Sensitive files use iOS data protection.
- Precise location and raw capture content are not logged.
- Camera, photo, location, microphone, and notification permissions are requested contextually.
- App Check is integrated before enforcement is enabled server-side.
- Screen captures and previews of sensitive content are minimized where product requirements justify it.
- Local database deletion follows account deletion and sign-out policy.

## 18. Observability

The application emits:

- Crashlytics crashes and selected non-fatal defects.
- Privacy-reviewed performance spans.
- Sync health summaries.
- Media transfer success and failure metrics.
- Capture quality and abandonment events without raw media.
- Product analytics events through an application-owned event schema after consent.

Every backend interaction propagates a correlation identifier where available.

## 19. Testing

Required test layers are:

- Pure domain and use-case tests.
- GRDB migration and transaction tests.
- Deterministic synchronization scenario tests.
- API contract tests using generated fixtures.
- Geometry property and fixture tests shared semantically with web and backend.
- View-model tests.
- SwiftUI accessibility and UI tests for critical flows.
- Accessibility-convention tests over the source itself (see section 19.1).
- Real-device tests for camera, AR, background upload, and lifecycle recovery.
- Operational membership/assignment revocation and client-invitation universal-link tests.

Tests use injected clocks, identifier generators, network gateways, and capability providers.

### 19.1 Accessibility and Localization Coverage

This package has no UI-test target and no simulator in CI's `swift test` step,
so the properties that live in view code are checked two ways.

**As values.** Anything a view model or a presentation type computes is
asserted directly:

- `TodayItemPresentation.accessibilityLabel` is the whole Today row as one
  spoken sentence. The row draws up to eight `Text` views, three of them a bare
  "·" separator; left as separate elements VoiceOver needed eight swipes to
  cross one row and pronounced the separators aloud. The view collapses the row
  into one element named by that property, and
  `Tests/FeatureRecommendationsTests/TodayAccessibilityTests.swift` asserts it
  carries every field the row shows, leads with the action, contains no
  decorative glyph, speaks the elevated-risk tier rather than relying on
  orange, and follows the injected locale.
- `MapAccessibilityLabels` and `MapCalibrationLabels` are covered the same way,
  including the Russian rendering of a calibration figure.
- `Tests/CoreLocalizationTests/LocalizationCatalogueTests.swift` asserts key
  parity between the two catalogues, that every declared key and every
  validation code has an entry, that nothing is orphaned, that no Russian entry
  is still the English text, and that both languages declare the same
  interpolation placeholders. Keys are declared by more than one enum — an
  enum's cases cannot be split across files, and `LocalizationKey.swift` is at
  the repository's 600-line ceiling — so those checks run over
  `LocalizedStrings.declaredKeys`, and one further test asserts that list
  includes every key set.

**As conventions over the source.**
`Tests/ArchitectureTests/AccessibilityConventionTests.swift` scans `Sources`
and fails on:

- a hard-coded font size (`.font(.system(size:))`, `UIFont.systemFont`), which
  ignores Dynamic Type outright;
- a literal `frame` dimension, which clips its own contents at the
  accessibility text sizes — every one is now an `@ScaledMetric`;
- a `withAnimation` or `.animation(` in a file that never reads
  `accessibilityReduceMotion` (the application animates nothing today, so this
  rule is forward-looking by design);
- a user-facing number formatted with `String(format: "%.1f", …)`, which emits
  a POSIX decimal separator regardless of language — those go through
  `LocalizedStrings.number(_:fractionDigits:)`;
- a control declared with an empty title, which leaves it with no accessible
  name at all.

**The map canvas.** `MapCanvasView` is a `Canvas` of drawn pixels, not views,
so its shapes cannot become accessibility elements. It is exposed as one
element whose label says so and names the alternative: `MapObjectListView`,
reachable through the canvas/list picker, is the VoiceOver route to selecting,
inspecting, and deleting every object. Move, resize, rotate, reshape, pan, and
zoom remain touch-only, and the label says that too rather than leaving a
reader to discover it.

**What still needs a device.** Rendering at the accessibility text sizes,
VoiceOver's actual traversal order and pronunciation, Reduce Motion and Reduce
Transparency as the system applies them, and one-handed reachability are all
confirmed only on real hardware or a simulator.

## 20. Performance Budgets

The implementation must establish measured budgets for:

- Initial garden opening.
- Map pan and zoom frame rate.
- Geometry selection latency.
- SQLite query duration.
- Outbox processing rate.
- Memory during photo and video capture.
- Background upload recovery.

Metal, specialized spatial indexes, or denormalized local read models are introduced only after profiling identifies a bottleneck.

## 21. Dependency Rules

- Features may depend on stable Core interfaces.
- Core infrastructure may depend on domain interfaces, not presentation.
- Features do not import each other's private implementation.
- Firebase, GRDB, MapKit, and ARKit types remain inside adapters or feature infrastructure.
- Generated API code remains behind an application gateway.
- Third-party dependencies require an ADR when they become architecturally critical.

## 22. Completion Criteria

The native architecture is implemented correctly when:

- A user can create and edit a garden offline and later synchronize it.
- Process termination does not lose acknowledged local changes.
- Unsupported capture capabilities degrade to valid alternative flows.
- Map editing remains responsive with representative garden complexity.
- Authentication and garden authorization are distinct.
- Media transfer can recover without duplicating domain records.
- Feature modules remain independently testable and within repository code-size rules.
