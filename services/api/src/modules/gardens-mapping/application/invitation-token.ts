/**
 * Opaque invitation tokens, generated and hashed the same way
 * `platform/authentication/csrf.ts` generates its double-submit token:
 * `crypto.randomBytes`, base64url-encoded, no external dependency.
 *
 * The raw token crosses the process boundary exactly once, in
 * `CreateInvitation`'s own response — never logged (`token` is in
 * `platform/telemetry/logger.ts`'s `REDACTED_PATHS`), never stored: only
 * `hashInvitationToken`'s output reaches `collaboration.invitation
 * .token_hash`, matching "opaque, single-purpose, expiring tokens stored
 * only as hashes" (identity-and-authorization.md, section
 * "10. Invitations"). A SHA-256 digest, not bcrypt/argon2: the input is
 * already 256 bits of cryptographic randomness, not a low-entropy secret an
 * attacker could offline-brute-force from the hash — a fast hash is exactly
 * what makes `findByTokenHash`'s lookup a plain indexed equality match
 * rather than a per-attempt KDF, without weakening the token itself.
 */

import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTE_LENGTH = 32;

export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
