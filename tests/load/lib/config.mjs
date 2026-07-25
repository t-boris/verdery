/* global __ENV */
/**
 * Shared configuration for every k6 load scenario.
 *
 * Nothing here is scenario-specific: a scenario decides its own shape (stages,
 * batch sizes, think time), and reads the target, the load profile, and the
 * common request headers from this module.
 *
 * Environment variables, all read once in k6's init context:
 *
 *   VERDERY_BASE_URL      Service root WITHOUT the /v1 prefix.
 *                         Default: http://localhost:8080
 *   VERDERY_LOAD_PROFILE  'smoke' (default) | 'soak' | 'full'
 *   VERDERY_ID_TOKENS     Comma-separated Firebase ID tokens (see auth.mjs)
 *   VERDERY_ID_TOKEN_FILE Path to a JSON array of tokens (see auth.mjs)
 *   VERDERY_GARDEN_IDS    Comma-separated garden UUIDs the tokens can access
 *
 * Source: docs/development/load-testing.md.
 */

/** Service root, trailing slashes removed so path joining is unambiguous. */
export const BASE_URL = (__ENV.VERDERY_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/u, '');

/** Every product route lives under `/v1` — `/health/ready` at the root is a 404. */
export const API = `${BASE_URL}/v1`;

/**
 * Load profile.
 *
 * - `smoke` is the ONLY profile safe to point at `verdery-dev`: single-digit
 *   virtual users, seconds of duration, enough to prove the script works.
 * - `soak` and `full` are for a production-like staging environment that does
 *   not exist yet (deferred-capabilities.md, "Staging and production").
 */
export const PROFILE = __ENV.VERDERY_LOAD_PROFILE ?? 'smoke';

/** True when the run is deliberately trivial in volume. */
export const IS_SMOKE = PROFILE === 'smoke';

/**
 * Picks one of the three shapes a scenario declares.
 *
 * Scenarios call this at module scope, because k6 requires `options` to be a
 * statically exported object.
 */
export function byProfile(shapes) {
  const chosen = shapes[PROFILE];
  if (chosen === undefined) {
    throw new Error(
      `Unknown VERDERY_LOAD_PROFILE "${PROFILE}". Expected one of: ${Object.keys(shapes).join(', ')}.`,
    );
  }
  return chosen;
}

/** Comma-separated environment list, empty entries dropped. */
export function envList(name) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Garden ids the supplied tokens are authorized for. */
export const GARDEN_IDS = envList('VERDERY_GARDEN_IDS');

/**
 * A UUID good enough for an idempotency key or a client-generated operation id.
 *
 * Deliberately not cryptographically random: k6's `crypto` module is not
 * available in every build, and a load generator needs uniqueness, not
 * unpredictability. Uniqueness across VUs is what matters, and `Math.random`
 * in k6 is seeded per VU.
 */
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Uniform integer in `[minimum, maximum]`. */
export function between(minimum, maximum) {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

/** Picks one element, or `null` for an empty list. */
export function pick(items) {
  if (items.length === 0) {
    return null;
  }
  return items[between(0, items.length - 1)];
}
