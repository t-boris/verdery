/**
 * Public interface of the media module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Two different audiences use this file:
 *
 * - `plants-inventory`, `observations-history`, and `tasks-recommendations`
 *   (built separately, immediately after this module) need only `MediaRecord`
 *   and `MediaRepository`: the type and the port interface they foreign-key
 *   their own photo/attachment tables against. Nothing else here is any of
 *   their concern.
 * - The composition root (`app.ts`) additionally needs the concrete classes
 *   below — `KyselyMediaRepository`, `KyselyMediaUnitOfWork`, and
 *   `RegisterMediaRecord` — to construct this module's dependency graph, the
 *   same way it already does for gardens-mapping and identity-access.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type { MediaRecord } from './domain/media-record.js';
export type { MediaRepository } from './application/media-repository.js';
export type { MediaRecordResource } from './application/media-record-view.js';
export type { MediaUnitOfWork } from './application/media-unit-of-work.js';
export { RegisterMediaRecord } from './application/register-media-record.js';
export { KyselyMediaRepository } from './persistence/kysely-media-repository.js';
export { KyselyMediaUnitOfWork } from './persistence/kysely-media-unit-of-work.js';
export type { MediaDatabaseSchema } from './persistence/schema.js';
