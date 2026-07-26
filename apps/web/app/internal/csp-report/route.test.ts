/**
 * The violation sink, tested as the untrusted-input handler it is.
 *
 * The interesting assertions here are not "does it parse a report" but "what
 * does it refuse to write down". A CSP report carries a `document-uri` and a
 * `blocked-uri`, and in this application both can hold credentials: the
 * email-link sign-in URL carries the `oobCode` that IS the credential, and a
 * signed Cloud Storage URL is a bearer credential for its TTL (`T-SIGN-09`).
 * A reporting endpoint that logged them verbatim would be a credential
 * exfiltration path dressed as observability.
 *
 * Source: docs/development/threat-model.md, section 16.4;
 * architecture/observability-and-analytics.md, section "6. Prohibited Telemetry".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The one shape a recorded line can have. `JSON.parse` alone yields `any`, which lints. */
interface LoggedViolation {
  readonly severity: string;
  readonly event: string;
  readonly violatedDirective?: string;
  readonly blockedOrigin?: string;
  readonly documentPath?: string;
  readonly disposition?: string;
}

function recorded(index = 0): LoggedViolation {
  return JSON.parse(logged[index] as string) as LoggedViolation;
}

function reportUriRequest(body: unknown): Request {
  return new Request('http://localhost/internal/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify(body),
  });
}

function violation(overrides: Record<string, unknown> = {}) {
  return {
    'csp-report': {
      'document-uri': 'https://verdery.example/application/gardens',
      'violated-directive': 'script-src',
      'blocked-uri': 'https://evil.example/payload.js',
      disposition: 'report',
      ...overrides,
    },
  };
}

describe('what it records', () => {
  it('writes one structured line per violation', async () => {
    const response = await POST(reportUriRequest(violation()));

    expect(response.status).toBe(204);
    expect(logged).toHaveLength(1);
    expect(recorded()).toMatchObject({
      severity: 'WARNING',
      event: 'csp.violation',
      violatedDirective: 'script-src',
      blockedOrigin: 'https://evil.example',
      documentPath: '/application/gardens',
      disposition: 'report',
    });
  });

  it('records the disposition, which says whether anything was actually blocked', async () => {
    await POST(reportUriRequest(violation({ disposition: 'enforce' })));

    expect(recorded().disposition).toBe('enforce');
  });

  it('keeps keyword blocked-uri values verbatim: "inline" is the diagnosis', async () => {
    await POST(reportUriRequest(violation({ 'blocked-uri': 'inline' })));

    expect(recorded().blockedOrigin).toBe('inline');
  });

  it('accepts the report-to wire shape as well as report-uri', async () => {
    const response = await POST(
      new Request('http://localhost/internal/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/reports+json' },
        body: JSON.stringify([
          {
            type: 'csp-violation',
            body: {
              'violated-directive': 'img-src',
              'blocked-uri': 'https://cdn.example/a.png',
              'document-uri': 'https://verdery.example/status',
            },
          },
        ]),
      }),
    );

    expect(response.status).toBe(204);
    expect(recorded()).toMatchObject({
      violatedDirective: 'img-src',
      blockedOrigin: 'https://cdn.example',
    });
  });
});

describe('what it refuses to record', () => {
  it('strips the query from document-uri, which on /auth/email-link IS the credential', async () => {
    await POST(
      reportUriRequest(
        violation({
          'document-uri':
            'https://verdery.example/auth/email-link?oobCode=SUPER_SECRET_SIGN_IN_CODE&apiKey=k',
        }),
      ),
    );

    expect(logged[0]).not.toContain('SUPER_SECRET_SIGN_IN_CODE');
    expect(recorded().documentPath).toBe('/auth/email-link');
  });

  it('reduces blocked-uri to its origin: a signed URL is a bearer credential', async () => {
    await POST(
      reportUriRequest(
        violation({
          'blocked-uri':
            'https://storage.googleapis.com/verdery-dev-user-media/x.jpg?X-Goog-Signature=SECRET_SIGNATURE',
        }),
      ),
    );

    expect(logged[0]).not.toContain('SECRET_SIGNATURE');
    expect(logged[0]).not.toContain('verdery-dev-user-media');
    expect(recorded().blockedOrigin).toBe('https://storage.googleapis.com');
  });

  it('never records the script sample, which contains a fragment of the page itself', async () => {
    await POST(
      reportUriRequest(
        violation({ 'script-sample': 'const sessionToken = "LEAKED_FROM_THE_PAGE"' }),
      ),
    );

    expect(logged[0]).not.toContain('LEAKED_FROM_THE_PAGE');
    expect(Object.keys(recorded())).not.toContain('scriptSample');
  });

  it('bounds every field, so one report cannot produce an unbounded log line', async () => {
    // Under MAX_REPORT_BYTES so the request is accepted, well over
    // MAX_FIELD_LENGTH so field truncation is what is being tested rather
    // than the body cap.
    await POST(reportUriRequest(violation({ 'violated-directive': 'x'.repeat(4_000) })));

    expect(logged).toHaveLength(1);
    expect((logged[0] as string).length).toBeLessThan(1_000);
  });

  it('refuses a javascript: document-uri, whose pathname is attacker-authored text', async () => {
    // `new URL('javascript:alert(1)//')` parses happily and yields a pathname
    // of `alert(1)//`. Found by this test, fixed by a scheme check.
    await POST(reportUriRequest(violation({ 'document-uri': 'javascript:alert(1)//' })));

    expect(logged[0]).not.toContain('alert(1)');
    expect(recorded().documentPath).toBeUndefined();
  });

  it('refuses a blocked-uri that is neither a CSP keyword nor an http(s) URL', async () => {
    await POST(reportUriRequest(violation({ 'blocked-uri': 'javascript:/*attacker-authored*/' })));

    expect(logged[0]).not.toContain('attacker-authored');
    expect(recorded().blockedOrigin).toBeUndefined();
  });
});

describe('what it refuses to do work for', () => {
  it('rejects a content type no browser sends', async () => {
    const response = await POST(
      new Request('http://localhost/internal/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );

    expect(response.status).toBe(415);
    expect(logged).toHaveLength(0);
  });

  it('refuses a body larger than a CSP report can be', async () => {
    const response = await POST(
      new Request('http://localhost/internal/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: JSON.stringify({ padding: 'x'.repeat(20_000) }),
      }),
    );

    expect(response.status).toBe(413);
    expect(logged).toHaveLength(0);
  });

  it('swallows malformed JSON without logging: it must not become its own amplifier', async () => {
    const response = await POST(
      new Request('http://localhost/internal/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: 'not json at all',
      }),
    );

    expect(response.status).toBe(204);
    expect(logged).toHaveLength(0);
  });

  it('ignores a well-formed body that is not a report', async () => {
    const response = await POST(reportUriRequest({ hello: 'world' }));

    expect(response.status).toBe(204);
    expect(logged).toHaveLength(0);
  });

  it('answers 204 with no body, so there is nothing worth probing', async () => {
    const response = await POST(reportUriRequest(violation()));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});
