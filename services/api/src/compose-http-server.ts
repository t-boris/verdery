/**
 * Builds the Fastify instance and its transport-level plugin stack: security
 * headers, CORS, overload shedding, and cookie parsing.
 *
 * Split out of `app.ts` for the same 600-line reason as every `compose-*.ts`
 * beside it. The seam is a real one rather than an arbitrary cut: everything
 * here is HTTP plumbing configured purely from `configuration.http`, with no
 * knowledge of a single domain module, so `app.ts` is left holding only the
 * composition of modules it exists to compose.
 *
 * Source: architecture/api-design.md; architecture/networking.md;
 * architecture/cost-and-scaling.md, section 6.
 */

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { registerErrorHandling } from './platform/errors/error-handler.js';
import { generateRequestId, registerCorrelation } from './platform/telemetry/correlation.js';
import type { ApplicationConfiguration } from './platform/configuration/configuration-schema.js';

/**
 * Event-loop delay above which the instance rejects new work.
 *
 * Shedding load early keeps latency bounded for requests already in flight
 * instead of degrading every request equally.
 *
 * THREE SECONDS, NOT ONE. At one second this fired on ordinary traffic: the
 * concurrent reads of a single page load, each verifying a Firebase session
 * cookie (an RSA check), exceed it on one vCPU. Shedding must trip on
 * overload, not on a busy instance — the rejection reaches users as a network
 * failure, so a guard set too tight misdirects every investigation it causes.
 *
 * This guard is also why `deploy-api.sh` keeps `--min-instances=0`: a warm
 * Cloud Run instance has its CPU throttled between requests, which stops the
 * sampler below and makes the delay it reads on the next request the whole
 * idle period. See that script's own note before raising either.
 *
 * Source: architecture/cost-and-scaling.md, section 6.
 */
const MAX_EVENT_LOOP_DELAY_MS = 3_000;

/**
 * Creates the server and registers every transport-level plugin, in order.
 *
 * The return type is inferred rather than declared as `FastifyInstance`:
 * Fastify's instance type carries the type parameters its `register` callbacks
 * are inferred from, and widening it here would make every encapsulated plugin
 * in `app.ts` fall back to implicit `any` parameters.
 */
export async function composeHttpServer(
  configuration: ApplicationConfiguration,
  logger: FastifyBaseLogger,
) {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: generateRequestId,
    bodyLimit: configuration.http.bodyLimitBytes,
    // The load balancer terminates TLS and sets the forwarding headers; without
    // this the service logs and rate-limits against the proxy address.
    trustProxy: true,
  });

  registerCorrelation(app);
  registerErrorHandling(app);

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin:
      configuration.http.allowedOrigins.length === 0
        ? false
        : [...configuration.http.allowedOrigins],
    credentials: true,
    // @fastify/cors defaults to 'GET,HEAD,POST', silently blocking PATCH
    // (rename garden) and DELETE (end session): the preflight succeeds but a
    // real browser then refuses the actual request. `app.inject()`-based
    // tests never exercise a CORS preflight, so this went unnoticed until a
    // real browser E2E (apps/web/e2e/sign-out.spec.ts) hit it. PUT joined
    // later for P7-NOTIF-01's whole-document `PUT /notification-preferences`.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await app.register(underPressure, {
    maxEventLoopDelay: MAX_EVENT_LOOP_DELAY_MS,
    // Health endpoints are owned by the service-health module so that they match
    // the contract document exactly.
    exposeStatusRoute: false,
  });

  // Parses `request.cookies`, used by both the Firebase session cookie
  // (`__session`) and the CSRF double-submit cookie. No `secret` option: the
  // service never signs cookies, only reads the opaque Firebase-issued value
  // and compares the CSRF cookie against a header, so there is nothing here
  // for a signature to protect.
  await app.register(cookie);

  return app;
}
