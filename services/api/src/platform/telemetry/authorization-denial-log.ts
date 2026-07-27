/**
 * The one shared structured-log shape every client-facing authorization
 * gate this codebase's collaboration/media/client-portal surfaces logs a
 * denial through (P9C-OBS-01) — architecture/collaboration-and-client-
 * sharing.md section "19. Audit and Observability": "Authorization denial
 * counts by safe reason category" is named as a METRIC, not an audit
 * category, and this is deliberately a Cloud-Logging structured LOG line,
 * not a `platform.audit_event` row — the identical "log for a metric, audit
 * row for a durable security/compliance record" split this codebase already
 * draws elsewhere (`sync.pull.rejected` is a log line; `client_update
 * .published` is an audit row). A denial is orders of magnitude higher
 * volume than a genuine grant (any expired session, revoked link, or
 * probing request produces one), so a durable audit row per denial would
 * bloat `platform.audit_event` with routine noise; a log line is the
 * correctly-weighted signal, exactly like every other high-frequency
 * outcome counter in this codebase (`sync.push.completed`,
 * `media.processing.result_recorded`).
 *
 * DELIBERATELY CARRIES NO RESOURCE IDENTIFIER. Every OTHER structured event
 * in this codebase includes an opaque id (mediaId, jobId, engagementId, and
 * so on) because those events describe a SUCCESSFUL, attributable action.
 * This one describes a DENIAL, and section 19's own words are explicit:
 * telemetry "never [reveals] anything that could reveal WHOSE data was
 * denied to an outside observer of the aggregate metric." `surface` and
 * `reasonCategory` are both small, fixed, non-identifying vocabularies —
 * never an engagement id, a client garden id, a media id, or a route
 * parameter value — so the resulting Cloud Monitoring metric answers "how
 * many denials, of which kind, on which surface" without ever answering
 * "whose."
 *
 * `reasonCategory` IS INTENTIONALLY AS COARSE AS EACH SURFACE'S OWN
 * CONCEALMENT DESIGN ALREADY IS. `ClientPortalAuthorization`'s own header
 * argues at length that collapsing every distinct failure mode into ONE
 * concealed outcome is deliberate, not a gap ("a second, more specific code
 * would be a concealment bug, not an improvement" —
 * `client-portal-errors.ts`). This helper does not invent a finer-grained
 * internal distinction that design deliberately erased; it reuses whatever
 * distinction the surface's OWN error codes already make publicly (see each
 * call site's own reason-category mapping).
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "19. Audit and Observability"; implementation-plan.md work package
 * P9C-OBS-01.
 */

const EVENT_TYPE = 'authorization.denied';

/**
 * The one method this helper needs, structurally — deliberately NOT this
 * file's own re-exported pino `Logger` type: `request.log` is Fastify's own
 * `FastifyBaseLogger`, which is a real pino instance at runtime but does
 * not structurally satisfy pino's OWN `Logger` interface (it is missing
 * `msgPrefix`, among other pino-internal members Fastify's own type does
 * not declare). Every call site here passes `request.log` — a minimal
 * structural type is the correct fit, not a cast.
 */
export interface StructuredLogger {
  info(fields: Record<string, unknown>, message: string): void;
}

/**
 * Which authorization gate raised the denial — a fixed, small vocabulary,
 * one entry per instrumented surface, never a route parameter value.
 */
export type AuthorizationDenialSurface =
  'client_portal' | 'client_media' | 'client_invitation_accept' | 'publisher_grant';

export interface AuthorizationDenialLogFields {
  readonly surface: AuthorizationDenialSurface;
  readonly reasonCategory: string;
  /** Route TEMPLATE (`request.routeOptions.url`), never a resolved path with real ids in it. */
  readonly route: string;
}

/** Logs one authorization denial. See this file's own header for why this is a log line, not an audit row, and why it carries no resource identifier. */
export function logAuthorizationDenial(
  logger: StructuredLogger,
  fields: AuthorizationDenialLogFields,
): void {
  logger.info({ event: EVENT_TYPE, ...fields }, 'Authorization denied');
}
