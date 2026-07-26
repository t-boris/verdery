/**
 * The CSP violation sink.
 *
 * threat-model.md section 16.4 recorded that the report-only policy "declares
 * no `report-uri`/`report-to`, so no violation is collected anywhere except a
 * browser console". This route is the answer, and the decision behind it is
 * deliberate: violations are collected FIRST-PARTY, into this application's
 * own stdout, which on Cloud Run is Cloud Logging — where every other
 * operational signal in this system already goes.
 *
 * The alternative considered and rejected was a hosted collector
 * (report-uri.com and similar). It would have meant a new vendor, a new
 * outbound flow carrying URLs out of real users' sessions to a third party,
 * and — per this project's own rule in security-and-privacy.md section 23 — a
 * threat-model review for a new provider. All to solve a problem `console.log`
 * on a server that is already aggregating logs solves for nothing.
 *
 * WHAT IS AND IS NOT RECORDED
 *
 * A violation report is attacker-influenceable data arriving on an
 * unauthenticated endpoint, so this handler treats it as untrusted input
 * throughout. It records only the four fields that identify WHICH RULE broke
 * and WHERE, each truncated: the violated directive, the blocked origin (the
 * origin alone — a blocked URL can carry a path and query that belong to the
 * user, not to the diagnosis), the document PATH (never its query string,
 * which on `/auth/email-link` carries the sign-in credential itself), and the
 * disposition. It never records the script sample, which by design contains a
 * fragment of the offending code and therefore potentially of the page's own
 * data.
 *
 * ABUSE EXPOSURE, STATED PLAINLY
 *
 * This is a public, unauthenticated endpoint that causes a log write. It is
 * therefore subject to `T-COST-01` — the same unmitigated request-flood
 * exposure every other endpoint in this system has today, closed by
 * `P8-NET-01`'s edge rather than here. What this handler does control is the
 * cost of a single request: it reads at most `MAX_REPORT_BYTES`, refuses any
 * content type that is not a CSP report, and emits at most one bounded log
 * line. It never touches the database and has no dependencies.
 *
 * Source: docs/development/threat-model.md, sections 16.4 and 13
 * (`T-COST-01`); architecture/observability-and-analytics.md, section
 * "6. Prohibited Telemetry".
 */

import { NextResponse } from 'next/server';

/**
 * A CSP report is a small, fixed-shape JSON object. Anything larger is not a
 * report, and reading it would be doing an unauthenticated caller's work for
 * them.
 */
const MAX_REPORT_BYTES = 8_192;

/** Bound on every string that reaches a log line, so one report cannot produce an unbounded one. */
const MAX_FIELD_LENGTH = 256;

/**
 * The two content types browsers actually send. `application/csp-report` is
 * `report-uri`'s; `application/reports+json` is `report-to`'s. Both are
 * emitted by the policy, so both are accepted here.
 */
const ACCEPTED_CONTENT_TYPES = ['application/csp-report', 'application/reports+json'];

function truncate(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value.slice(0, MAX_FIELD_LENGTH) : undefined;
}

/**
 * The keyword values the CSP specification defines for `blocked-uri`. These
 * are not URLs and are exactly the ones worth keeping verbatim — "inline" is
 * the whole diagnosis when a nonce fails to reach a script.
 *
 * An allowlist rather than a fallthrough: anything not on this list and not a
 * parseable http(s) URL is attacker-authored text, and the correct amount of
 * attacker-authored text in a log line is none.
 */
const BLOCKED_URI_KEYWORDS = new Set([
  'inline',
  'eval',
  'self',
  'wasm-eval',
  'trusted-types-policy',
  'trusted-types-sink',
  'data',
  'blob',
  'filesystem',
]);

/**
 * Keeps the origin and discards the rest.
 *
 * A blocked URI can be a full URL whose path and query belong to the user — a
 * signed Cloud Storage download URL, for instance, is a bearer credential for
 * its TTL (`T-SIGN-09`). Which ORIGIN was blocked is the entire diagnostic
 * value; the rest is somebody's data.
 */
function blockedOrigin(value: unknown): string | undefined {
  const raw = truncate(value);
  if (raw === undefined) {
    return undefined;
  }
  if (BLOCKED_URI_KEYWORDS.has(raw)) {
    return raw;
  }
  try {
    const url = new URL(raw);
    // `new URL('javascript:...')` parses, and its `origin` is the string
    // "null" — the same reduction `documentPath` guards against, caught here
    // by the scheme check rather than by hoping `origin` is meaningful.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The path only, and only from a real page URL.
 *
 * `/auth/email-link?...` carries the sign-in credential in its query, hence
 * the path-only reduction. The scheme check is the less obvious half and was
 * found by this file's own test: `new URL('javascript:alert(1)//')` parses
 * happily and yields a `pathname` of `alert(1)//`, which would have put
 * attacker-authored text straight into a log line. A document URI that is not
 * `http`/`https` did not come from a page this application served, so there is
 * nothing in it worth keeping.
 */
function documentPath(value: unknown): string | undefined {
  const raw = truncate(value);
  if (raw === undefined) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.pathname : undefined;
  } catch {
    return undefined;
  }
}

interface CspReportBody {
  readonly 'violated-directive'?: unknown;
  readonly 'effective-directive'?: unknown;
  readonly 'blocked-uri'?: unknown;
  readonly 'document-uri'?: unknown;
  readonly disposition?: unknown;
}

/** Normalizes both wire shapes into the one `report-uri` uses. */
function extractReports(payload: unknown): CspReportBody[] {
  // `report-to`: a JSON array of { type, body, url, ... }.
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (entry): entry is { type?: unknown; body?: unknown } =>
          typeof entry === 'object' && entry !== null,
      )
      .filter((entry) => entry.type === undefined || entry.type === 'csp-violation')
      .map((entry) => (typeof entry.body === 'object' && entry.body !== null ? entry.body : {}))
      .map((body) => body as CspReportBody);
  }

  // `report-uri`: a single { "csp-report": { ... } }.
  if (typeof payload === 'object' && payload !== null) {
    const wrapped = (payload as { 'csp-report'?: unknown })['csp-report'];
    if (typeof wrapped === 'object' && wrapped !== null) {
      return [wrapped];
    }
  }

  return [];
}

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!ACCEPTED_CONTENT_TYPES.some((accepted) => contentType.includes(accepted))) {
    // 415 rather than 400: a wrong content type here is almost always
    // something other than a browser, and saying so precisely costs nothing.
    return new NextResponse(null, { status: 415 });
  }

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REPORT_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    payload = JSON.parse(text);
  } catch {
    // Malformed input from an unauthenticated caller is not an incident and
    // must not become a log line — that would make the endpoint its own
    // amplifier.
    return new NextResponse(null, { status: 204 });
  }

  for (const report of extractReports(payload)) {
    // One structured line per violation. Deliberately `console.warn`: this
    // application has no logger of its own (the API owns structured logging),
    // and on Cloud Run stdout/stderr IS the log pipeline. `severity` matches
    // the field Cloud Logging promotes automatically.
    console.warn(
      JSON.stringify({
        severity: 'WARNING',
        event: 'csp.violation',
        // Which rule broke.
        violatedDirective:
          truncate(report['violated-directive']) ?? truncate(report['effective-directive']),
        // Which origin it broke on. Origin only — see `blockedOrigin`.
        blockedOrigin: blockedOrigin(report['blocked-uri']),
        // Which page. Path only — see `documentPath`.
        documentPath: documentPath(report['document-uri']),
        // 'report' while the policy is report-only, 'enforce' after the flip.
        // The single most useful field during a rollout: it says whether this
        // violation was observed or actually blocked something.
        disposition: truncate(report.disposition),
      }),
    );
  }

  // 204 unconditionally past this point. A browser does not read the body and
  // does not retry, and a reporting endpoint that returns anything
  // interesting is a reporting endpoint worth probing.
  return new NextResponse(null, { status: 204 });
}
