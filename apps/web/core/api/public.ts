/**
 * Public surface of the API access layer.
 *
 * Features consume gateways and results; they never construct endpoint URLs or
 * transport payloads.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */
export {
  createApiClient,
  APP_CHECK_HEADER_NAME,
  type ApiClient,
  type ApiClientOptions,
  type FetchLike,
} from './client';
export { createBrowserApiClient, resolveApiOrigin } from './config';
export { CORRELATION_ID_HEADER, createCorrelationId } from './correlation';
export { CSRF_HEADER_NAME, csrfHeader } from './csrf';
export { errorMessageKey } from './error-message';
export { createGardenGateway, type GardenGateway } from './garden-gateway';
export { createHealthGateway, type HealthGateway } from './health-gateway';
export { generateIdempotencyKey } from './idempotency-key';
export { createMapGateway, type MapGateway, type MapViewportBounds } from './map-gateway';
export { fromWireCategoryDetails } from './map-wire-types';
export type {
  WireCategoryDetails,
  WireGardenMapDocument,
  WireGardenObject,
  WireGeoreference,
  WireMapCommandResult,
  WireValidationIssue,
} from './map-wire-types';
export { ApiQueryProvider } from './query-provider';
export { createSessionGateway, type SessionGateway } from './session-gateway';
export {
  ApiFailureError,
  ClientErrorCode,
  isFailure,
  type ApiFailure,
  type ApiFailureKind,
  type ApiResult,
  type ApiSuccess,
} from './result';
