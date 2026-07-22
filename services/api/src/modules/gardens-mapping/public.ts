/**
 * Public interface of the gardens-mapping module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type { Garden, GardenLifecycleState } from './domain/garden.js';
export type { GardenCapability, GardenRole } from './domain/garden-role.js';
export { GardenAuthorization } from './application/garden-authorization.js';
export { ArchiveGarden } from './application/archive-garden.js';
export { CreateGarden } from './application/create-garden.js';
export type { GardenRepository } from './application/garden-repository.js';
export { GetGarden } from './application/get-garden.js';
export type { GardensMappingUnitOfWork } from './application/gardens-mapping-unit-of-work.js';
export { ListGardens } from './application/list-gardens.js';
export type { MembershipRepository } from './application/membership-repository.js';
export { RenameGarden } from './application/rename-garden.js';
export { RequestGardenDeletion } from './application/request-garden-deletion.js';
export { KyselyGardenRepository } from './persistence/kysely-garden-repository.js';
export { KyselyGardensMappingUnitOfWork } from './persistence/kysely-gardens-mapping-unit-of-work.js';
export { KyselyMembershipRepository } from './persistence/kysely-membership-repository.js';
export type { GardensMappingDatabaseSchema } from './persistence/schema.js';
export { registerGardenRoutes } from './transport/garden-routes.js';
