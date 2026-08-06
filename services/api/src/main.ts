/**
 * Process entry point.
 *
 * Configuration is validated, telemetry starts, clients are created, the
 * application is composed, and only then does the process accept traffic.
 *
 * Source: architecture/backend-modular-monolith.md, section "9. Composition Root".
 */

import { Storage } from '@google-cloud/storage';
import { GoogleGenAI } from '@google/genai';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { buildApplication } from './app.js';
import { registerGracefulShutdown } from './bootstrap/graceful-shutdown.js';
import {
  VertexAiExplanationAdapter,
  VertexAiPlantConditionAnalysisAdapter,
  VertexAiPlantSpeciesIdentificationAdapter,
  VertexAiPlatExtractionAdapter,
} from './modules/integrations/public.js';
import type {
  AiExplanationProviderAdapter,
  PlantConditionAnalysisProviderAdapter,
  PlantSpeciesIdentificationProviderAdapter,
  PlatExtractionProviderAdapter,
} from './modules/integrations/public.js';
import { GcsMediaStorageGateway } from './modules/media/public.js';
import { FcmPushMessageSender } from './modules/notifications/public.js';
import { FirebaseAppCheckVerifier } from './platform/app-check/firebase-app-check-verifier.js';
import { FirebaseIdentityProviderAccountGateway } from './platform/authentication/firebase-identity-provider-account-gateway.js';
import { FirebaseTokenVerifier } from './platform/authentication/firebase-token-verifier.js';
import { GoogleOidcInvocationVerifier } from './platform/tasks/google-oidc-invocation-verifier.js';
import {
  ConfigurationError,
  loadConfiguration,
} from './platform/configuration/load-configuration.js';
import { PostgresDatabaseGateway } from './platform/database/postgres-database-gateway.js';
import { createLogger } from './platform/telemetry/logger.js';
import { SystemClock } from './shared/time/clock.js';

export const SERVICE_NAME = 'verdery-api';

async function main(): Promise<void> {
  // Configuration failures happen before a logger exists, so they are written
  // to stderr directly. The message names the variables, never their values.
  const configuration = (() => {
    try {
      return loadConfiguration();
    } catch (error) {
      const message = error instanceof ConfigurationError ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
  })();

  const logger = createLogger(configuration, SERVICE_NAME);

  let database: PostgresDatabaseGateway;
  try {
    database = await PostgresDatabaseGateway.create(
      configuration.database,
      SERVICE_NAME,
      (error) => {
        logger.error(
          { err: error, event: 'database.idle_connection_failed' },
          'An idle database connection failed; the pool will reconnect on demand',
        );
      },
    );
    await database.ping();
  } catch (error) {
    logger.error(
      { err: error, event: 'startup.database_unavailable' },
      'The database is unavailable; refusing to start',
    );
    process.exit(1);
  }

  // Application Default Credentials: the runtime service account's own
  // identity in Cloud Run, or a developer's `gcloud auth application-default
  // login` locally — no downloaded service account key, matching every other
  // Google Cloud client this service constructs.
  const firebaseApp = initializeApp({
    credential: applicationDefault(),
    projectId: configuration.firebaseProjectId,
  });
  const tokenVerifier = new FirebaseTokenVerifier(firebaseApp);
  const appCheckVerifier = new FirebaseAppCheckVerifier(firebaseApp);
  // P7-NOTIF-02: FCM messaging rides the SAME Admin SDK app as the token
  // and App Check verifiers (ADR-0002) — no new dependency class, no new
  // credential.
  const pushMessageSender = new FcmPushMessageSender(getMessaging(firebaseApp));
  // P8-DELETE-01: account purge's identity half — the same Admin SDK app
  // again, so deleting a Firebase user needs no new credential either.
  const identityProviderAccounts = new FirebaseIdentityProviderAccountGateway(firebaseApp);
  const clock = new SystemClock();
  // Application Default Credentials again — no downloaded service account
  // key, the same posture every other Google Cloud client here takes.
  const mediaStorageGateway = new GcsMediaStorageGateway(
    new Storage(),
    configuration.media.uploadSessionTtlMs,
    configuration.media.signedDownloadTtlMs,
    // The same allowlist the HTTP layer uses: a resumable session may only be
    // bound to an origin this service already trusts.
    configuration.http.allowedOrigins,
  );
  const cloudTasksInvocationVerifier = new GoogleOidcInvocationVerifier(
    configuration.media.processingCallback.audience,
    configuration.media.processingCallback.invokerServiceAccountEmail,
  );

  // P7-AI-01: the Vertex AI explanation adapter exists ONLY when the
  // kill-switch is on — off (every environment today), no GenAI client is
  // constructed and no code path can reach Vertex. When on, the
  // configuration loader has already required the project id and model,
  // and the client authenticates through Application Default Credentials
  // like every other Google Cloud client here.
  // The loader's cross-field check guarantees project id and model
  // whenever the switch is on; the narrowing here is what lets the types
  // say so.
  const aiConfiguration = configuration.aiExplanation;
  const aiExplanationAdapter: AiExplanationProviderAdapter | null =
    aiConfiguration.enabled &&
    aiConfiguration.vertexProjectId !== null &&
    aiConfiguration.model !== null
      ? new VertexAiExplanationAdapter(
          new GoogleGenAI({
            vertexai: true,
            project: aiConfiguration.vertexProjectId,
            location: aiConfiguration.vertexLocation,
          }),
          {
            model: aiConfiguration.model,
            maxOutputTokens: aiConfiguration.maxOutputTokens,
          },
        )
      : null;

  // ADR-0015: same construction shape as `aiExplanationAdapter` above, one
  // adapter per capability's own kill-switch. Both reuse the recommendation
  // capability's Vertex project/location (`aiConfiguration.vertexProjectId`/
  // `vertexLocation`) — one GCP project across all three AI capabilities —
  // which `findPlantSpeciesAiIssues`/`findPlantConditionAiIssues` guarantee
  // is present whenever either plant switch is on, independent of whether
  // the recommendation-explanation switch itself is also on.
  const plantSpeciesAiConfiguration = configuration.plantSpeciesAi;
  const plantSpeciesIdentificationAdapter: PlantSpeciesIdentificationProviderAdapter | null =
    plantSpeciesAiConfiguration.enabled &&
    aiConfiguration.vertexProjectId !== null &&
    plantSpeciesAiConfiguration.model !== null
      ? new VertexAiPlantSpeciesIdentificationAdapter(
          new GoogleGenAI({
            vertexai: true,
            project: aiConfiguration.vertexProjectId,
            location: aiConfiguration.vertexLocation,
          }),
          {
            model: plantSpeciesAiConfiguration.model,
            maxOutputTokens: plantSpeciesAiConfiguration.maxOutputTokens,
          },
        )
      : null;

  const plantConditionAiConfiguration = configuration.plantConditionAi;
  const plantConditionAnalysisAdapter: PlantConditionAnalysisProviderAdapter | null =
    plantConditionAiConfiguration.enabled &&
    aiConfiguration.vertexProjectId !== null &&
    plantConditionAiConfiguration.model !== null
      ? new VertexAiPlantConditionAnalysisAdapter(
          new GoogleGenAI({
            vertexai: true,
            project: aiConfiguration.vertexProjectId,
            location: aiConfiguration.vertexLocation,
          }),
          {
            model: plantConditionAiConfiguration.model,
            maxOutputTokens: plantConditionAiConfiguration.maxOutputTokens,
          },
        )
      : null;

  // ADR-0018: the plat reader. Same construction shape as the two plant
  // adapters above — its own kill-switch, its own explicitly chosen model,
  // and the same Vertex project every AI capability shares. Off means no
  // client is constructed and the reading endpoint refuses honestly.
  const platReadingConfiguration = configuration.platReading;
  const platExtractionAdapter: PlatExtractionProviderAdapter | null =
    platReadingConfiguration.enabled &&
    aiConfiguration.vertexProjectId !== null &&
    platReadingConfiguration.model !== null
      ? new VertexAiPlatExtractionAdapter(
          new GoogleGenAI({
            vertexai: true,
            project: aiConfiguration.vertexProjectId,
            location: aiConfiguration.vertexLocation,
          }),
          {
            model: platReadingConfiguration.model,
            maxOutputTokens: platReadingConfiguration.maxOutputTokens,
          },
        )
      : null;

  const app = await buildApplication({
    configuration,
    logger,
    database,
    tokenVerifier,
    appCheckVerifier,
    clock,
    mediaStorageGateway,
    cloudTasksInvocationVerifier,
    aiExplanationAdapter,
    plantSpeciesIdentificationAdapter,
    plantConditionAnalysisAdapter,
    platExtractionAdapter,
    pushMessageSender,
    identityProviderAccounts,
  });

  registerGracefulShutdown({
    drain: async () => {
      // Fastify stops accepting connections and waits for in-flight requests
      // before the pool is closed, so no owned transaction is abandoned.
      await app.close();
      await database.close();
    },
    gracePeriodMs: configuration.shutdownGracePeriodMs,
    logger,
    exit: (code) => process.exit(code),
  });

  await app.listen({ host: configuration.http.host, port: configuration.http.port });
}

await main();
