import { describe, expect, it } from 'vitest';

import { STATIC_SECURITY_HEADERS } from './security-headers';

function headerValue(name: string): string | undefined {
  return STATIC_SECURITY_HEADERS.find(({ key }) => key === name)?.value;
}

describe('static security headers', () => {
  it('preserves the opener relationship required by OAuth popups', () => {
    expect(headerValue('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
  });

  it('retains the baseline browser hardening headers', () => {
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue('X-Frame-Options')).toBe('DENY');
    expect(headerValue('Strict-Transport-Security')).toContain('max-age=31536000');
  });
});
