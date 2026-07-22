import { afterEach, describe, expect, it } from 'vitest';

import { CSRF_HEADER_NAME, csrfHeader } from './csrf';

afterEach(() => {
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('csrfHeader', () => {
  it('is empty before any session cookie exists', () => {
    expect(csrfHeader()).toEqual({});
  });

  it('reads the csrf_token cookie into the expected header name', () => {
    document.cookie = 'csrf_token=a-token-value';

    expect(csrfHeader()).toEqual({ [CSRF_HEADER_NAME]: 'a-token-value' });
  });

  it('decodes a URI-encoded cookie value', () => {
    document.cookie = `csrf_token=${encodeURIComponent('token/with special+chars')}`;

    expect(csrfHeader()).toEqual({ [CSRF_HEADER_NAME]: 'token/with special+chars' });
  });

  it('ignores an unrelated cookie', () => {
    document.cookie = 'other_cookie=value';

    expect(csrfHeader()).toEqual({});
  });
});
