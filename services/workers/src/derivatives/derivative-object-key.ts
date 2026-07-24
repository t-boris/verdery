/**
 * Opaque `<shard>/<sourceMediaId>/<objectUuid>` object key for a produced
 * derivative — narrowly mirrors `services/api`'s own
 * `application/media-storage-target.ts`'s `generateObjectKey` (architecture/
 * media-storage-and-processing.md section 4) without importing its `src/`
 * (architecture/backend-modular-monolith.md section "19. Worker Boundary").
 *
 * Uses `crypto.randomUUID()` (UUIDv4), not the API's own `uuid` package's
 * `v7()`: this suffix is an opaque storage path segment, never a database
 * row id needing UUIDv7's index-locality property (`shared/identifiers/
 * uuid.ts`'s own reason for choosing v7 there), so pulling `uuid` into this
 * package as a new dependency just for this one call is not worth it —
 * Node's own built-in `crypto.randomUUID()` is sufficient and dependency-
 * free.
 *
 * `sourceMediaId` (not a freshly-minted derivative id, which does not exist
 * yet at write time — `services/api` mints it when it registers the
 * `media_record` row this object key is later attached to) fills the
 * shard-and-path-segment role `generateObjectKey`'s own `mediaId` parameter
 * plays: it is not itself sensitive (an opaque UUID, section 4: "Object
 * keys are opaque and contain no email, garden name, address, or user-
 * entered filename"), and using it keeps every derivative of the same
 * source physically colocated by shard, the same locality
 * `generateObjectKey`'s own doc comment reasons about for its own case.
 */

import { createHash, randomUUID } from 'node:crypto';

export function generateDerivativeObjectKey(sourceMediaId: string): string {
  const shard = createHash('sha256').update(sourceMediaId).digest('hex').slice(0, 2);
  return `${shard}/${sourceMediaId}/${randomUUID()}`;
}
