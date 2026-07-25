/**
 * Bounded deadline for a provider call — external-integrations.md section
 * 11's "Interactive provider calls use strict deadlines" as a small,
 * self-contained racing helper.
 *
 * The deadline aborts the passed `AbortSignal` (so a real HTTP adapter can
 * cancel its request) and resolves `timedOut` instead of letting the caller
 * hang. A rejection from the wrapped work AFTER the deadline already won is
 * swallowed deliberately: the outcome was decided, and an unhandled
 * rejection from an abandoned promise must not crash the process.
 *
 * Source: architecture/external-integrations.md, section "11. Reliability";
 * architecture/backend-modular-monolith.md, section "18. External
 * Providers".
 */

export type DeadlineOutcome<T> =
  { readonly kind: 'completed'; readonly value: T } | { readonly kind: 'timedOut' };

export async function withDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<DeadlineOutcome<T>> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<DeadlineOutcome<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'timedOut' });
    }, timeoutMs);
  });

  const work = run(controller.signal);

  try {
    const outcome = await Promise.race([
      work.then((value): DeadlineOutcome<T> => ({ kind: 'completed', value })),
      deadline,
    ]);
    if (outcome.kind === 'timedOut') {
      // The abandoned call may still reject (typically with an abort error);
      // that rejection is no longer an outcome anyone is waiting for.
      work.catch(() => undefined);
    }
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}
