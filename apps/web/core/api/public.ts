/**
 * Public surface of the API access layer.
 *
 * Features consume gateways and results; they never construct endpoint URLs or
 * transport payloads.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */
export { createApiClient, type ApiClient, type ApiClientOptions, type FetchLike } from './client';
export { createBrowserApiClient, resolveApiOrigin } from './config';
export { CORRELATION_ID_HEADER, createCorrelationId } from './correlation';
export { errorMessageKey } from './error-message';
export { createHealthGateway, type HealthGateway } from './health-gateway';
export {
  ClientErrorCode,
  isFailure,
  type ApiFailure,
  type ApiFailureKind,
  type ApiResult,
  type ApiSuccess,
} from './result';
