import { v7 } from 'uuid';

/**
 * `crypto.randomUUID()` produces UUIDv4, which the contract's `Uuid` schema
 * — and the backend's own transport validation — reject for this header.
 *
 * Source: packages/api-contracts/openapi.yaml, `components.schemas.Uuid`.
 */
export function generateIdempotencyKey(): string {
  return v7();
}
