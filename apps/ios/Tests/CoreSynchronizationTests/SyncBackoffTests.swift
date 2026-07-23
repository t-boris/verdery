import Foundation
import Testing

@testable import CoreSynchronization

/// Covers `SyncBackoff`'s pure math — deterministic throughout, per this
/// stage's own testing requirement ("deterministic, not flaky"): every test
/// injects a fixed `randomUnitInterval` rather than `Double.random`, the
/// same `now: @Sendable () -> Date` injection pattern applied to jitter.
@Suite("Sync backoff")
struct SyncBackoffTests {
    @Test("delay is zero for a never-attempted (attemptCount <= 0) operation")
    func delayIsZeroBeforeFirstAttempt() {
        #expect(SyncBackoff.delay(forAttempt: 0, randomUnitInterval: { 0.5 }) == 0)
        #expect(SyncBackoff.delay(forAttempt: -1, randomUnitInterval: { 0.5 }) == 0)
    }

    @Test("delay grows exponentially with attemptCount, before the cap, at a fixed jitter draw")
    func delayGrowsExponentially() {
        // A fixed draw of 1.0 (the top of `0..<1`) makes the jittered delay
        // equal the uncapped exponential exactly, so the doubling is exact
        // and assertable.
        let first = SyncBackoff.delay(forAttempt: 1, randomUnitInterval: { 1.0 })
        let second = SyncBackoff.delay(forAttempt: 2, randomUnitInterval: { 1.0 })
        let third = SyncBackoff.delay(forAttempt: 3, randomUnitInterval: { 1.0 })

        #expect(first == SyncBackoff.baseDelaySeconds)
        #expect(second == SyncBackoff.baseDelaySeconds * 2)
        #expect(third == SyncBackoff.baseDelaySeconds * 4)
    }

    @Test("delay never exceeds maxDelaySeconds, however large attemptCount grows")
    func delayIsCappedAtMaxDelay() {
        let delay = SyncBackoff.delay(forAttempt: 30, randomUnitInterval: { 1.0 })
        #expect(delay == SyncBackoff.maxDelaySeconds)
    }

    @Test("delay scales linearly with the injected jitter draw, for a fixed attemptCount")
    func delayScalesWithJitterDraw() {
        let quarter = SyncBackoff.delay(forAttempt: 1, randomUnitInterval: { 0.25 })
        let half = SyncBackoff.delay(forAttempt: 1, randomUnitInterval: { 0.5 })

        #expect(quarter == SyncBackoff.baseDelaySeconds * 0.25)
        #expect(half == SyncBackoff.baseDelaySeconds * 0.5)
    }

    @Test("isEligible is true before any attempt has been recorded")
    func eligibleBeforeFirstAttempt() {
        let now = Date(timeIntervalSince1970: 1_000)
        #expect(SyncBackoff.isEligible(attemptCount: 0, lastAttemptedAt: nil, now: now, randomUnitInterval: { 1.0 }))
    }

    @Test("isEligible is false immediately after a recorded attempt, before the computed delay elapses")
    func notEligibleImmediatelyAfterAttempt() {
        let attemptedAt = Date(timeIntervalSince1970: 1_000)
        let now = attemptedAt.addingTimeInterval(SyncBackoff.baseDelaySeconds - 1)

        #expect(!SyncBackoff.isEligible(
            attemptCount: 1, lastAttemptedAt: attemptedAt, now: now, randomUnitInterval: { 1.0 }
        ))
    }

    @Test("isEligible is true once the computed delay has fully elapsed")
    func eligibleOnceDelayElapses() {
        let attemptedAt = Date(timeIntervalSince1970: 1_000)
        let now = attemptedAt.addingTimeInterval(SyncBackoff.baseDelaySeconds)

        #expect(SyncBackoff.isEligible(
            attemptCount: 1, lastAttemptedAt: attemptedAt, now: now, randomUnitInterval: { 1.0 }
        ))
    }

    @Test("isEligible honors a Retry-After floor larger than the computed backoff")
    func retryAfterFloorsEligibility() {
        let attemptedAt = Date(timeIntervalSince1970: 1_000)
        // The computed backoff for attempt 1 is `baseDelaySeconds` (2s) at
        // this fixed jitter draw; a much larger `Retry-After` must still
        // govern.
        let now = attemptedAt.addingTimeInterval(SyncBackoff.baseDelaySeconds + 1)

        #expect(!SyncBackoff.isEligible(
            attemptCount: 1, lastAttemptedAt: attemptedAt, retryAfter: 120, now: now, randomUnitInterval: { 1.0 }
        ))
        #expect(SyncBackoff.isEligible(
            attemptCount: 1, lastAttemptedAt: attemptedAt, retryAfter: 120,
            now: attemptedAt.addingTimeInterval(120), randomUnitInterval: { 1.0 }
        ))
    }

    @Test("isEligible never lets a smaller Retry-After shorten the computed backoff")
    func retryAfterNeverShortensComputedBackoff() {
        let attemptedAt = Date(timeIntervalSince1970: 1_000)
        // attempt 3's computed backoff (at jitter draw 1.0) is baseDelaySeconds * 4.
        let computed = SyncBackoff.delay(forAttempt: 3, randomUnitInterval: { 1.0 })
        let now = attemptedAt.addingTimeInterval(computed - 1)

        #expect(!SyncBackoff.isEligible(
            attemptCount: 3, lastAttemptedAt: attemptedAt, retryAfter: 1, now: now, randomUnitInterval: { 1.0 }
        ))
    }
}
