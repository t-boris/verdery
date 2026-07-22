/**
 * OpenTelemetry bootstrap.
 *
 * Loaded via `node --import ./dist/telemetry-bootstrap.js dist/main.js`
 * rather than imported normally, because HTTP, Fastify, and pg
 * instrumentation patch those modules at load time: they must run before
 * `main.js` imports Fastify or pg, which a plain top-of-file import inside
 * `main.ts` cannot guarantee under ESM. `--import` is Node's supported hook
 * for exactly this ordering requirement.
 *
 * Disabled by default. Local development and the Testcontainers suite never
 * invoke this file — they run `main.js` and the test runner directly — so the
 * enable check here exists for the one remaining case: a Cloud Run revision
 * temporarily misconfigured with tracing on but no working credentials should
 * degrade to running without traces, not fail to start entirely.
 *
 * Source: implementation-plan.md work package P1-OBS-01
 * ("One request trace crosses ingress and database" completion evidence);
 * architecture/observability-and-analytics.md.
 */

import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const TRACING_ENABLED = process.env['TRACING_ENABLED'] === 'true';

if (TRACING_ENABLED) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'verdery-api',
      [ATTR_SERVICE_VERSION]: process.env['SERVICE_VERSION'] ?? '0.0.0-development',
    }),
    // Cloud Run allocates CPU only while handling a request by default, then
    // freezes the instance's event loop until the next one arrives. The
    // default BatchSpanProcessor relies on a background timer to flush
    // periodically, which never fires between requests on a frozen instance —
    // confirmed directly: spans were created and logged (traceId present in
    // request logs) but never reached Cloud Trace. SimpleSpanProcessor
    // exports each span synchronously as it ends, inside the request that is
    // still keeping the instance thawed, at the cost of one export call's
    // latency per request rather than a periodic batch.
    spanProcessors: [new SimpleSpanProcessor(new TraceExporter())],
    instrumentations: [
      new HttpInstrumentation(),
      new FastifyInstrumentation(),
      new PgInstrumentation(),
    ],
  });

  sdk.start();

  // Cloud Run sends SIGTERM before freezing the instance; flushing here is the
  // only chance a trace for the request being handled at that moment has to
  // actually reach Cloud Trace.
  process.on('SIGTERM', () => {
    sdk.shutdown().catch(() => {
      // Losing the final in-flight trace on a slow shutdown is preferable to
      // this handler itself throwing during process termination.
    });
  });
}
