# Web Application Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines the detailed architecture of the Grow Garden web application. The web application uses TypeScript, React, Next.js, TanStack Query, Zustand, React Hook Form, Zod, and Firebase App Hosting.

## 2. Product Role

The web application is a first-class authenticated product surface. It is optimized for:

- Large-screen garden-map editing.
- Property-plan import, tracing, and calibration.
- Plant, observation, task, recommendation, and history management.
- Media review.
- Collaboration and account administration.
- Viewing results produced by mobile-only AR and capture flows.

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
│   └── application/
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

## 6. State Ownership

| State | Owner |
|---|---|
| Server data and request status | TanStack Query |
| Map selection, tools, gesture preview, undo stack | Dedicated Zustand editor store |
| Form input and validation | React Hook Form and Zod |
| Authentication session | Server-issued Firebase session cookie |
| Route state | Next.js router and URL |
| Recoverable drafts | IndexedDB or local storage adapter with explicit schema |
| Upload progress | Media feature store backed by server upload records |

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

## 11. Forms and Validation

Zod schemas validate user input at the client boundary and may be generated or aligned with OpenAPI schemas. Server validation remains authoritative.

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

## 15. Localization

English and Russian are supported from the first production release. Localization uses shared message identifiers and ICU-compatible formatting semantics.

The client owns interface strings. Server responses provide stable error codes and structured values rather than final English sentences for ordinary validation.

Dates, time zones, seasons, units, and decimal formatting use the user's locale and garden location as appropriate. Canonical API measurements remain metric.

## 16. Security

- Content Security Policy is defined and monitored before enforcement.
- Trusted Types are considered for rich content surfaces.
- User-authored text renders as text, not raw HTML.
- Third-party scripts require privacy and security review.
- Secrets never use `NEXT_PUBLIC_` variables.
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
- Accessibility checks.
- Mock Service Worker tests for typed API outcomes.
- Playwright end-to-end tests against a controlled environment.
- Browser compatibility runs for supported Safari, Chrome, Firefox, and Edge versions.
- Visual regression tests for stable editor and responsive-layout states.

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
