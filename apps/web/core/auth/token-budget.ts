/**
 * A bounded wait for a value that a request may proceed without.
 *
 * Written for the App Check token, whose absence is harmless — App Check is
 * a monitor-only signal — but whose delay is not. A promise that rejects and
 * a promise that never settles are different failures with the same
 * consequence for the caller, and only the first of them is handled by an
 * ordinary `catch`. Everything that awaits an optional credential therefore
 * needs a deadline, not just a rejection handler.
 *
 * Source: architecture/identity-and-authorization.md, section "12. App Check";
 * architecture/web-application-design.md, section "9. Online-First Behavior".
 */

/**
 * Resolves to `work()`'s value, or to `null` when that work rejects or does
 * not settle within `budgetMs`.
 *
 * A rejection arriving after the budget has already elapsed is absorbed by
 * the same handler, so a late failure never surfaces as an unhandled
 * rejection. The timer is cleared as soon as the work settles, so a resolved
 * call leaves nothing pending behind it.
 */
export function resolveWithinBudget<T>(
  work: () => Promise<T>,
  budgetMs: number,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, budgetMs);

    work().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
