/**
 * Opaque client-invitation tokens — a deliberate MIRROR of
 * `gardens-mapping/application/invitation-token.ts`, not a cross-module
 * import: that file is an application-layer internal of a DIFFERENT module
 * and is not re-exported through `gardens-mapping/public.ts`, so this module
 * owns an identical implementation of its own rather than reaching across a
 * module boundary for two small crypto calls.
 *
 * Same `crypto.randomBytes`, base64url encoding, and SHA-256 hash, for the
 * identical reasoning that file's own header gives: the raw token crosses
 * the process boundary exactly once — here, never returned in
 * `CreateClientInvitation`'s own HTTP response (unlike the operational
 * invitation, which has no delivery mechanism yet and so must hand the raw
 * token back to its caller), used only to build the accept link the
 * transactional email carries, then discarded. Only
 * `hashClientInvitationToken`'s output ever reaches
 * `collaboration.client_access_grant.token_hash`. A SHA-256 digest, not
 * bcrypt/argon2, for the same reason: the input is already 256 bits of
 * cryptographic randomness, not a low-entropy secret an attacker could
 * offline-brute-force from the hash.
 */

import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTE_LENGTH = 32;

export function generateClientInvitationToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
}

export function hashClientInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
