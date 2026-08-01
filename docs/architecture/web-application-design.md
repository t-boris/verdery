# Web Application Design

> Status: Draft 0.3
> Decision status: Approved baseline  
> Last updated: July 28, 2026

## 1. Purpose

This document defines the detailed architecture of the Grow Garden web application. The web application uses TypeScript, React, Next.js, TanStack Query, Zustand, React Hook Form, Zod, and Firebase App Hosting.

## 2. Product Role

The web application is a first-class authenticated product surface. It is optimized for:

- Large-screen garden-map editing.
- Property-plan import, tracing, and calibration.
- Plant, observation, task, recommendation, and history management.
- Media review.
- Collaboration and account administration.
- Viewing and editing synchronized results produced by mobile-only AR and capture flows.
- Authoring and reviewing garden location, confirmed address, true-north orientation, geographic
  context, and versioned solar/shadow analysis.
- A responsive client portal for explicitly published results, completed work, selected media, actual garden history, and published future Time Machine scenarios.

The initial web release is online-first. It may preserve recoverable drafts but does not claim a successful server save while disconnected.

## 3. Runtime and Hosting

Use an active Firebase App Hosting-supported Next.js release pinned in the repository. Upgrades occur deliberately after compatibility, accessibility, bundle, and regression testing.

Firebase App Hosting builds the application and runs its server components on managed Cloud Run infrastructure. The web application does not use its hosting runtime as a second domain backend. Domain operations go through the versioned Grow Garden API.

## 4. Rendering Model

Use a hybrid rendering strategy:

- Server rendering for the application shell, authentication-aware routing, metadata, and suitable public pages.
- Client rendering for the garden editor, rich forms, drag interactions, uploads, and live status.
- Static generation only for stable public content where appropriate.

The garden editor is loaded as a client component and is not server-rendered as an interactive canvas.

## 5. Application Structure

```text
apps/web/
├── app/
│   ├── public/
│   ├── auth/
│   ├── application/
│   └── client-portal/
├── features/
│   ├── gardens/
│   ├── map-editor/
│   ├── plants/
│   ├── observations/
│   ├── tasks/
│   ├── recommendations/
│   ├── media/
│   ├── imports/
│   ├── collaboration/
│   ├── organizations/
│   ├── publications/
│   ├── client-portal/
│   └── settings/
├── core/
│   ├── api/
│   ├── auth/
│   ├── geometry/
│   ├── validation/
│   ├── analytics/
│   └── observability/
└── shared/
    ├── ui/
    ├── accessibility/
    └── localization/
```

Feature folders own their route-level orchestration, queries, commands, forms, presentation components, and tests. Shared UI must remain domain-neutral.

Visual styling uses CSS modules over a single design-token stylesheet (`shared/ui/tokens.css`): the palette (light and dark, WCAG AA-clearing pairs), typography scale, spacing, radii, shadows, focus, and motion tokens. Components never hard-code visual values. Icons are a small set of hand-authored inline SVGs in `shared/ui/icons.tsx`. No UI framework, icon font, or externally hosted font is used; every visual asset resolves locally, consistent with the Content Security Policy posture.

Type is one locally hosted family for text (headings and body alike, differentiated by size and weight rather than by a second face) plus a monospace family reserved for labels and other machine-ish text. Corner radii are zero and the elevation tokens `--shadow-xs`/`--shadow-sm` are `none`: separation is carried by hairline rules, so a hairline is load-bearing wherever it appears and must not be removed as decoration.

Buttons size to their own content and never stretch to fill a container, so a submit inside a form column stays the width of its label rather than becoming a full-width bar. Actions whose meaning is carried by an established symbol — retry, load more, save, pause, resume, discard, cancel, add, open — are icon-only squares exactly one touch-target across, declared through the `Button` primitive's `iconOnly` prop rather than inferred from the button's children; every such control carries both an accessible name and a tooltip, because the icons themselves are hidden from assistive technology. Controls that exist to distinguish one option from its siblings — filter segments and other mutually exclusive choices — keep visible text, since the distinction between them lives in the words and no symbol set encodes it.

## 6. State Ownership

| State                                             | Owner                                                   |
| ------------------------------------------------- | ------------------------------------------------------- |
| Server data and request status                    | TanStack Query                                          |
| Map selection, tools, gesture preview, undo stack | Dedicated Zustand editor store                          |
| Form input and validation                         | React Hook Form and Zod                                 |
| Authentication session                            | Server-issued Firebase session cookie                   |
| Route state                                       | Next.js router and URL                                  |
| Recoverable drafts                                | IndexedDB or local storage adapter with explicit schema |
| Upload progress                                   | Media feature store backed by server upload records     |

Server records must not be copied into a global client store without a demonstrated editor requirement. The editor store references record identifiers and keeps only intentional working state.

## 7. Authentication Session

The browser signs in through Firebase client authentication, exchanges the short-lived Firebase ID token at a protected session endpoint, and receives a secure HTTP-only session cookie.

Session requirements are:

- `Secure` in all deployed environments.
- `HttpOnly`.
- An explicit `SameSite` policy.
- CSRF protection on session creation, mutation endpoints exposed through cookies, and logout.
- Server-side verification and revocation handling.
- No long-lived Firebase credentials in browser storage after exchange.

Client invitations are email-bound and expiring. Email magic link is the lowest-friction default, but invitation acceptance still creates an ordinary authenticated session. The URL token proves invitation possession only; it is not a permanent bearer credential for garden data.

The Next.js server may use the session to render the application shell. The domain API accepts and verifies the approved session credential path or an exchanged short-lived API token as defined by the authentication design.

## 8. API Access

Generated OpenAPI types and a generated low-level client are wrapped by application-specific gateways. UI components never construct endpoint URLs or transport payloads directly.

TanStack Query owns:

- Cache keys.
- Request cancellation.
- Revalidation.
- Mutation status.
- Optimistic display updates where safely reversible.
- Invalidating affected resources after accepted commands.

Mutations include an idempotency key and expected revision when required. Conflict responses are shown as domain-specific recovery, not generic network errors.

## 9. Online-First Behavior

When connectivity is lost:

- Existing loaded data remains visible with a stale indicator.
- Unsaved editor work remains in a local draft.
- Server mutations are disabled or explicitly queued only for supported draft workflows.
- The interface never displays a server-confirmed state before confirmation.
- Large imports preserve local recovery metadata when browser capabilities allow it.

Full record synchronization in the browser is deferred. Its future design must reuse server revisions and conflict rules rather than create a separate last-write-wins path.

## 10. Map Editor Integration

The map editor is a bounded subsystem containing:

- A Konva-based local garden scene.
- A MapLibre geographic context layer.
- A coordinate transformation service.
- Selection and tool state.
- Command-based undo and redo.
- Snap, measurement, and validation overlays.
- Accessible non-canvas property controls.

The editor receives immutable map snapshots and emits typed edit commands. It does not issue API mutations for every pointer movement. Commands are committed at stable interaction boundaries.

On desktop, the route uses a wide three-region workspace: utility controls, a flexible canvas, and a
dedicated object/property inspector. The object list and selected-object properties remain adjacent
and visible independently of the utility-panel height. Responsive layouts preserve canvas priority,
move utilities below the canvas and inspector at intermediate widths, and stack all regions on
narrow screens.

Drawing tools use category-specific icons, short labels, and stable category colors. Common actions
with established symbols may be icon-only when accessible names and tooltips are present. Exact
geometry dimensions are edited from the selected-object inspector: polygons use overall
map-axis-aligned width and depth, lines use total length, and derived area or perimeter remains
read-only. These controls update canonical local-metre geometry through a single typed command and
retain the planning-only accuracy disclosure.

### 10.1 Client Portal Boundary

The client portal is a separate route and feature boundary with a deliberately simpler read-only experience.

It may render:

- Published garden overview and accepted snapshot.
- Immutable client update versions.
- Published completed-work entries.
- Selected before/after media.
- Actual historical publication timeline.
- Explicitly published future Time Machine scenarios.

It must not fetch operational tasks, internal notes, recommendations, drafts, sync conflicts, capture proposals, raw media, organization membership, or provider diagnostics. The portal does not obtain a full garden response and hide fields or controls in the browser.

Actual historical timeline and future Time Machine are distinct views. Historical entries state what was accepted and published at a real time. Future scenarios show assumptions, horizon, uncertainty, and non-prediction disclosure.

## 11. Forms and Validation

Zod schemas validate user input at the client boundary and may be generated or aligned with OpenAPI schemas. Server validation remains authoritative.
Browser code imports Zod through `shared/validation/zod.ts`, which enables
Zod's `jitless` mode. This avoids its `new Function` capability probe and
keeps production validation compatible with the CSP prohibition on
`unsafe-eval`; adding `unsafe-eval` is not an acceptable workaround.

Forms must:

- Preserve user input after recoverable failures.
- Display field and form-level errors accessibly.
- Avoid clearing a form after an unknown mutation outcome.
- Warn before abandoning unsaved changes.
- Use locale-aware units and dates while sending canonical API values.

## 12. Media Upload

The web application requests an upload record and resumable Cloud Storage session from the API, uploads directly, then asks the API to verify completion.

The upload controller persists recoverable metadata for large imports where browser storage and security policy permit it. Raw signed session URLs are not written to analytics or ordinary logs.

## 13. Error Boundaries

Use error boundaries at:

- Application shell.
- Route feature.
- Garden editor.
- Media import and processing panels.

Expected API errors remain typed feature state. Error boundaries are reserved for unexpected rendering or runtime defects.

## 14. Accessibility

- All non-decorative controls are keyboard accessible.
- Canvas operations have equivalent property panels or structured object lists where practical.
- Selection, validation, and save state are announced through accessible live regions.
- Color is not the only carrier of confidence, sync, or error state.
- Focus is restored predictably after dialogs and tool changes.
- Pointer targets support touch-capable laptops and tablets.
- Motion and animation respect user preferences.

### 14.1 Measurable Commitments

The rules above are held to specific, tested thresholds:

- **Contrast.** Body text, muted text, brand text, and every tone colour clear
  WCAG 2.2 SC 1.4.3 (4.5:1) against every surface they are painted on, in both
  palettes. A control's visual boundary clears SC 1.4.11 (3:1), which is why
  `--color-control-border` exists separately from the decorative
  `--color-border`: a form field and a secondary button have no fill of their
  own, so their border is the whole of the information identifying them.
- **Target size.** Every standalone control is at least `--control-min-size`
  (2.75rem, 44px) in its block dimension — buttons, navigation links, and the
  garden tabs alike. This is the outdoor-use requirement of
  technical-specification.md section 11, not merely SC 2.5.8's 24px minimum.
- **Structure.** Every route has exactly one `main` landmark and one `h1`, and
  no heading level is skipped. A list row that opens its own detail panel
  carries a heading, so the panel's contents sit under something.
- **Disclosures.** A control that shows or hides a panel carries
  `aria-expanded` and `aria-controls`; its panel container exists whether or
  not it is open, so the reference always resolves.
- **Navigation state.** The current garden tab carries `aria-current="page"`,
  and never more than one tab at a time.
- **Motion.** Under `prefers-reduced-motion: reduce`, every transition and
  animation is suppressed — durations _and_ delays, since a zero-duration
  transition behind a delay is still a freeze.
- **The map canvas.** The Konva stage is a `role="application"` region with a
  label and an `aria-describedby` that states its keyboard contract: arrow
  keys pan the camera or nudge the selected object, plus and minus zoom,
  Delete removes the selection, Escape clears it. The same description states
  plainly that drawing a shape and dragging a vertex are pointer gestures with
  no keyboard equivalent in the current implementation, and points at the
  structured object list beside the map as the keyboard route to selecting,
  renaming, repositioning, and deleting every object. An honest statement of
  the gap is preferred to silence.

### 14.2 How This Is Verified

- `shared/ui/contrast.test.ts` parses `tokens.css` itself and asserts every
  permitted colour pairing in both palettes, including the SC 1.4.11 control
  boundaries for which axe implements no rule.
- `e2e/accessibility.spec.ts` runs `@axe-core/playwright` (a dev dependency)
  against every route the E2E harness can reach, in the light and dark themes,
  with disclosures expanded and a form error showing, and asserts zero
  violations across the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
  `wcag22aa`, and `best-practice` rule sets. axe runs in a real browser
  because contrast, target size, and visibility all depend on computed layout,
  which jsdom does not produce.
- `e2e/keyboard.spec.ts` drives real key presses: the skip link, a
  keyboard-only sign-in, a visible focus indicator on every focusable control
  on every route, the Today disclosures, the map toolbar's `aria-pressed`
  state, and canvas pan and zoom.
- `e2e/responsive.spec.ts` asserts no horizontal document overflow at 360,
  834, and 1440 CSS pixels, the target-size minimum at 360, and that the
  garden tab bar scrolls sideways on one line rather than wrapping.
- `e2e/reduced-motion.spec.ts` reads computed durations and delays under both
  motion preferences, so the suppression is proved and the unsuppressed
  default is proved not to be vacuous.

## 15. Localization

English and Russian are supported from the first production release. Localization uses shared message identifiers and ICU-compatible formatting semantics.

The client owns interface strings. Server responses provide stable error codes and structured values rather than final English sentences for ordinary validation.

Dates, time zones, seasons, units, and decimal formatting use the user's locale and garden location as appropriate. Canonical API measurements remain metric.

### 15.1 Presentation Rules

- **Instants** (`completedAt`, `observedAt`, a recommendation window bound)
  render in the reader's own time zone. The server's quiet-hours logic reasons
  in the garden's zone; the client displays wall-clock time where the reader
  is. `shared/localization/formatting.ts` owns this.
- **Calendar days** (`dueDate`) are bare `YYYY-MM-DD` with no zone, and are
  never passed through `new Date(...)`, which would parse them as UTC midnight
  and shift them a day west of Greenwich.
- **The negotiated locale is always passed explicitly.** A bare
  `toLocaleString()` follows the JavaScript runtime's default locale — the
  browser's, not the one this application negotiated — so a reader who chose
  Russian would get Russian prose around an English date.
- **Numbers carry the reader's separator.** `toFixed` emits a POSIX full stop;
  measurement figures go through `formatFixed`, which pins the digit count
  (never more precision than the estimate supports) while formatting for the
  locale.
- **Units are translated words, not literals appended to a number.**
  `map.units.centimetres` / `map.units.metres` carry the abbreviation, so a
  calibration figure reads "±1,5 см" in Russian rather than "±1.5 cm".
  Canonical measurements remain metric throughout, per the geometry model.

### 15.2 How This Is Verified

- `shared/localization/keyed-copy.test.ts` scans every component for prose in
  a JSX text child or a naming attribute (`aria-label`, `placeholder`,
  `title`, `alt`, `label`) and fails on any string that is not a catalogue
  key. It also asserts the two catalogues define identical key sets —
  including the keys the `*-today` modules contribute — that no entry is
  empty, that no Russian entry is still the English text, and that both
  languages declare the same interpolation placeholders.
- `shared/localization/formatting.test.ts` asserts locale-dependent output,
  reader-zone rendering, and the calendar-day boundary.

## 16. Security

- Content Security Policy is defined and monitored before enforcement.
- Trusted Types are considered for rich content surfaces.
- User-authored text renders as text, not raw HTML.
- Third-party scripts require privacy and security review.
- Secrets never use `NEXT_PUBLIC_` variables.
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` preserves the
  deliberate Firebase OAuth popup relationship without opting unrelated
  windows out of opener isolation.
- App Check is integrated for supported browser flows.
- Upload and download access is short lived.
- Precise location and media URLs are excluded from browser telemetry.

## 17. Performance

The implementation defines and measures budgets for:

- Initial authenticated shell load.
- Garden editor bundle size.
- Map opening time.
- Pointer-to-render latency.
- Large garden pan and zoom frame rate.
- Plan preview generation.
- Upload responsiveness.

Use route-level code splitting and lazy-load the editor, capture viewers, and heavy geometry libraries. Move CPU-heavy parsing or geometry preparation to Web Workers when profiling justifies it.

## 18. Observability

The web application emits privacy-reviewed:

- JavaScript errors with source maps.
- Web-vital measurements.
- API correlation identifiers.
- Editor performance spans.
- Upload and processing outcome events.
- Product analytics through an application-owned schema after consent.

Raw geometry, addresses, exact coordinates, tokens, signed URLs, and private media are not attached to telemetry.

## 19. Testing

Required layers are:

- Unit tests with Vitest.
- Component tests with Testing Library.
- Geometry fixture and property tests.
- Accessibility checks: automated axe passes over every reachable route in both
  themes, keyboard-operability, responsive, and reduced-motion suites, and
  token-level contrast arithmetic (see section 14.2).
- Mock Service Worker tests for typed API outcomes.
- Playwright end-to-end tests against a controlled environment.
- Browser compatibility runs for supported Safari, Chrome, Firefox, and Edge versions.
- Visual regression tests for stable editor and responsive-layout states.
- Client portal tests for engagement acceptance, publication-only rendering, withdrawal, revocation, cross-client isolation, selected-media entitlement, timeline stability, and future-scenario disclosure.

Critical end-to-end flows include authentication, garden creation, map editing, plan calibration, media upload, task completion, conflict recovery, and account deletion request.

## 20. Dependency Rules

- Features import public Core and Shared interfaces only.
- Shared UI does not import product features.
- Next.js server-only modules cannot be imported by client components.
- Firebase SDK usage remains inside authentication, App Check, messaging, or hosting adapters.
- MapLibre and Konva types remain inside the map subsystem.
- API transport models remain behind feature gateways.
- Browser globals are accessed through adapters when they affect testability or server rendering.

## 21. Completion Criteria

The web design is implemented correctly when:

- A user can perform all non-device-specific core workflows.
- Authentication state is protected by a server-managed cookie.
- The map editor remains responsive and keyboard operable.
- Disconnection cannot be confused with a successful server save.
- Large uploads bypass the application server while remaining authorized.
- Server data, editor working state, and form state have distinct owners.
- The application can upgrade supported Next.js versions without changing domain behavior.
- A client can use a responsive portal without receiving any internal operational resource.
- Revoking an engagement or withdrawing a publication affects the next authorized request.
