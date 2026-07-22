# Notification Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines notification intent, scheduling, preferences, in-app inbox, Firebase Cloud Messaging delivery, localization, deduplication, and failure behavior.

## 2. Channels

Initial channels are:

- In-app notification inbox.
- Firebase Cloud Messaging push notifications.

Transactional email is added through a provider adapter when product flows require it. SMS is not part of the initial architecture.

## 3. Ownership

The application owns:

- Why a notification exists.
- Recipient selection.
- Timing in the garden/user time zone.
- Deduplication.
- User preferences and quiet hours.
- Localized template and parameters.
- Deep-link target.
- Audit and product outcome.

FCM owns push transport only.

## 4. Notification Intent

An intent contains:

- Intent UUIDv7.
- Type and version.
- Recipient profile.
- Garden context where applicable.
- Stable template key and structured parameters.
- Priority.
- Earliest delivery and expiration.
- Deduplication key.
- Channel eligibility.
- Deep-link destination.
- Source event and trace context.

Intents contain no rendered secrets or signed URLs.

## 5. Flow

```text
domain event
    │
    ▼
notification policy
    │
    ▼
persist in-app intent
    │
    ▼
Cloud Task at eligible time
    │
    ▼
preference and freshness recheck
    │
    ▼
FCM delivery attempt
```

Domain transactions do not wait for FCM.

## 6. Device Tokens

FCM registration tokens are stored as revocable device-channel records containing profile, application installation, platform, last-seen time, environment, status, and provider metadata.

Invalid or unregistered tokens are disabled idempotently. Tokens are secrets and excluded from logs and analytics.

## 7. Preferences

Preferences support:

- Notification type.
- Channel.
- Garden.
- Quiet hours.
- Time zone.
- Immediate versus digest behavior where offered.

Security and account-integrity notices may have different opt-out rules and must be classified explicitly.

## 8. Localization

Store template key and structured parameters. Render as late as practical using recipient locale.

Push payloads remain concise and avoid private garden details on lock screens unless the user enabled detailed previews.

## 9. Scheduling

Garden-care timing uses the garden or user time zone inside application logic. Cloud Tasks schedules the resolved UTC delivery time.

Before delivery, the worker rechecks:

- Recipient access.
- Notification preference.
- Task or recommendation freshness.
- Deduplication state.
- Expiration.

## 10. Deduplication

Deduplication keys are purpose-specific, such as recommendation ID plus reminder window. Repeated event delivery must not create repeated user notifications.

## 11. Deep Links

Deep links contain stable application routes and resource IDs, not bearer access. The client authenticates and authorizes after opening.

If the resource is unavailable, the client opens a safe fallback rather than revealing prior existence.

## 12. In-App Inbox

The inbox is the durable user-facing record for eligible notifications. It supports read state, expiration, and source navigation. Push delivery success does not determine inbox state.

## 13. Failure Behavior

- FCM failure does not roll back the domain event.
- Transient errors retry within intent expiration.
- Permanent token errors disable the device channel.
- Expired or stale intents close without delivery.
- Dead-letter failures are observable and replayable when still relevant.

## 14. Security and Privacy

- Device tokens are secret.
- Payloads minimize sensitive content.
- Shared-garden role changes are rechecked at send time.
- Notification preferences are application-authorized.
- Provider responses are not exposed directly to clients.

## 15. Observability

Measure intent creation, suppression reason, queue delay, send attempt, provider acceptance, invalid token, open/deep-link outcome, and user preference changes.

Provider acceptance is not treated as confirmed device display.

## 16. Testing

- Duplicate source event.
- Quiet hours and daylight-saving transitions.
- Membership removal before delivery.
- Recommendation superseded before delivery.
- Invalid FCM token.
- Locale fallback.
- Privacy-safe lock-screen text.
- Deep link to deleted or unauthorized resource.

## 17. Completion Criteria

- Notification intent is durable and independent of provider delivery.
- User preferences are checked at send time.
- Duplicate events do not spam users.
- Push payloads do not act as authorization.
- In-app inbox remains correct when FCM fails.
