import { describe, expect, it } from 'vitest';

import { isConcealedAccessFailure } from './garden-read-access';

function contractFailure(code: string) {
  return {
    ok: false as const,
    kind: 'contract' as const,
    code,
    fallbackMessage: 'x',
    correlationId: 'corr-1',
    retryable: false,
    details: [],
    status: 403,
  };
}

describe('isConcealedAccessFailure', () => {
  it('treats auth.forbidden as a concealed, not-for-this-caller failure', () => {
    expect(isConcealedAccessFailure(contractFailure('auth.forbidden'))).toBe(true);
  });

  it('treats garden.not_found as a concealed, not-for-this-caller failure', () => {
    expect(isConcealedAccessFailure(contractFailure('garden.not_found'))).toBe(true);
  });

  it('does not conceal an unrelated contract failure', () => {
    expect(isConcealedAccessFailure(contractFailure('garden.stale_revision'))).toBe(false);
  });

  it('does not conceal a transport failure even if it happened to share a code', () => {
    expect(
      isConcealedAccessFailure({
        ok: false,
        kind: 'transport',
        code: 'auth.forbidden',
        fallbackMessage: 'x',
        correlationId: 'corr-1',
        retryable: true,
        details: [],
        status: null,
      }),
    ).toBe(false);
  });
});
