/**
 * `ApplicationDependencies` — everything `buildApplication` (`app.ts`) needs,
 * constructed before it is built. Split out of `app.ts` purely to keep that
 * file at or below the repository's 600-line source-file limit, the exact
 * same reason every sibling `compose-*.ts` file already gives for its own
 * split; this is still composition-root code, not a module boundary, and
 * `app.ts` remains the one place every plugin, adapter, and route is
 * assembled.
 *
 * The logger is typed as Fastify's own interface rather than as a pino
 * instance so that request-scoped child loggers stay assignable throughout
 * the pipeline.
 *
 * Source: architecture/backend-modular-monolith.md, section
 * "9. Composition Root".
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  AddressGeocodingAdapter,
  AerialTracingProviderAdapter,
  AiExplanationProviderAdapter,
  PlantConditionAnalysisProviderAdapter,
  PlantSpeciesIdentificationProviderAdapter,
  PlatExtractionProviderAdapter,
} from './modules/integrations/public.js';
import type { MediaStorageGateway } from './modules/media/public.js';
import type { PushMessageSender } from './modules/notifications/public.js';
import type { AppCheckVerifier } from './platform/app-check/app-check-verifier.js';
import type { IdentityProviderAccountGateway } from './platform/authentication/identity-provider-account-gateway.js';
import type { TokenVerifier } from './platform/authentication/token-verifier.js';
import type { ApplicationConfiguration } from './platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

export interface ApplicationDependencies {
  readonly configuration: ApplicationConfiguration;
  readonly logger: FastifyBaseLogger;
  readonly database: DatabaseGateway;
  readonly tokenVerifier: TokenVerifier;
  readonly appCheckVerifier: AppCheckVerifier;
  readonly clock: Clock;
  /**
   * The media module's Cloud Storage port, already constructed — mirrors
   * `tokenVerifier`/`appCheckVerifier`: `main.ts` builds the concrete
   * adapter (`GcsMediaStorageGateway`, wrapping a `@google-cloud/storage`
   * client authenticated through Application Default Credentials) and this
   * file only ever depends on the port interface, so a test can substitute a
   * fake here the same way it substitutes `stubTokenVerifier()`.
   */
  readonly mediaStorageGateway: MediaStorageGateway;
  /**
   * P6-ASYNC-01: verifies the Cloud Tasks OIDC token on the media-processing
   * callback. Same "port arrives already constructed" shape as
   * `mediaStorageGateway`: `main.ts` builds the real `GoogleOidcInvocationVerifier`,
   * tests substitute a fake.
   */
  readonly cloudTasksInvocationVerifier: CloudTasksInvocationVerifier;
  /**
   * P7-AI-01: the Vertex AI explanation adapter, or `null` whenever the
   * `RECOMMENDATION_AI_EXPLANATION_ENABLED` kill-switch is off (every
   * environment today). Same "port arrives already constructed" shape as
   * `mediaStorageGateway`; `null` here means no code path can reach
   * Vertex at all — the strongest form of the rollback guarantee.
   */
  readonly aiExplanationAdapter: AiExplanationProviderAdapter | null;
  /**
   * P12-GEO-01: the address geocoder. Optional and defaulted, unlike every
   * adapter above it — the US Census service needs no key and no
   * configuration, so the real one is always constructible and `null` here
   * means "build it", not "no path can reach it". A test supplies its own so
   * no suite ever reaches the network.
   */
  readonly addressGeocoder?: AddressGeocodingAdapter | null;
  /**
   * ADR-0015: the Vertex AI plant-species-identification adapter, or `null`
   * whenever `PLANT_SPECIES_AI_ENABLED` is off (every environment today,
   * pending the manual spot-check and provider-terms verification ADR-0015
   * names). Same "port arrives already constructed, `null` means no code
   * path can reach Vertex at all" shape as `aiExplanationAdapter`.
   */
  readonly plantSpeciesIdentificationAdapter: PlantSpeciesIdentificationProviderAdapter | null;
  /**
   * ADR-0015: the Vertex AI plant-condition-analysis adapter, or `null`
   * whenever `PLANT_CONDITION_AI_ENABLED` is off (every environment today).
   * Same shape as `plantSpeciesIdentificationAdapter`.
   */
  readonly plantConditionAnalysisAdapter: PlantConditionAnalysisProviderAdapter | null;
  /**
   * ADR-0018: the Vertex AI plat-extraction adapter, or `null` whenever
   * `PLAT_READING_ENABLED` is off. Same shape as the two adapters above;
   * with `null` the reading endpoint refuses honestly rather than
   * pretending to have read anything.
   */
  readonly platExtractionAdapter: PlatExtractionProviderAdapter | null;
  /** Optional for test harnesses; production supplies the aerial tracer. */
  readonly aerialTracingAdapter?: AerialTracingProviderAdapter | null;
  /**
   * P7-NOTIF-02: the FCM boundary — `main.ts` builds the real
   * `FcmPushMessageSender` over the same `firebase-admin` app the token
   * verifier uses; tests substitute a fake. Same "port arrives already
   * constructed" shape as `mediaStorageGateway`.
   */
  readonly pushMessageSender: PushMessageSender;
  /**
   * P8-DELETE-01: the Firebase Authentication boundary account purge uses to
   * delete the identity itself (`deleteUser`). Same "port arrives already
   * constructed" shape as `mediaStorageGateway`: `main.ts` builds the real
   * `FirebaseIdentityProviderAccountGateway` over the same `firebase-admin`
   * app the token verifier uses; tests substitute a fake, so no test can
   * reach a real identity provider.
   */
  readonly identityProviderAccounts: IdentityProviderAccountGateway;
}
