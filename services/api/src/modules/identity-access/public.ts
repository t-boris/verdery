/**
 * Public interface of the identity-access module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type { AccountState } from './domain/account-state.js';
export { isAccountUsable } from './domain/account-state.js';
export type { Profile } from './domain/profile.js';
export type { IdentityProviderLinkRepository } from './application/identity-provider-link-repository.js';
export type { ProfileRepository } from './application/profile-repository.js';
export { ProvisionProfile } from './application/provision-profile.js';
export { KyselyIdentityProviderLinkRepository } from './persistence/kysely-identity-provider-link-repository.js';
export { KyselyProfileRepository } from './persistence/kysely-profile-repository.js';
export type { IdentityAccessDatabaseSchema } from './persistence/schema.js';
