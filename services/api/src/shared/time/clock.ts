/**
 * Time as an injected dependency.
 *
 * Application code never calls `new Date()` directly, so a test controls
 * "now" explicitly instead of racing the real clock for revision timestamps,
 * idempotency expiration, and account-state transitions.
 *
 * Source: architecture/backend-modular-monolith.md, section "7. Shared Kernel".
 */

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
