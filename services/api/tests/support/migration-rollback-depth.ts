/**
 * How many steps `node-pg-migrate` must roll back to undo one named migration.
 *
 * A rollback test wants to undo the single migration it covers, but `down`
 * takes a step count measured from the newest applied migration, not a target.
 * That count is the migration's distance from the end of the directory, so
 * every migration added on top silently invalidates every count below it.
 * Hardcoding them made adding one migration a thirty-file edit, and missing
 * even one turned into seventeen red suites in CI.
 *
 * Deriving the count from the directory removes the maintenance: a new
 * migration changes the answer for every existing test without touching a
 * single test file.
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Migration filenames in application order: `<timestamp>_<slug>.sql`, sorted by name. */
function migrationFileNames(): string[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * The `count` that rolls back `slug` and everything applied after it.
 *
 * `slug` is a migration's name without its timestamp prefix or `.sql` suffix —
 * `'observation-symptoms'` for `1788400000000_observation-symptoms.sql`. It is
 * matched exactly; an unknown or ambiguous slug throws rather than returning a
 * count that would quietly roll back the wrong depth.
 */
export function rollbackDepthTo(slug: string): number {
  const names = migrationFileNames();
  const matches = names.filter((name) => name.replace(/^\d+_/, '').replace(/\.sql$/, '') === slug);

  if (matches.length !== 1) {
    const detail = matches.length === 0 ? 'no migration' : `${matches.length} migrations`;
    throw new Error(
      `rollbackDepthTo('${slug}'): ${detail} in ${MIGRATIONS_DIRECTORY} matches that slug.`,
    );
  }

  return names.length - names.indexOf(matches[0]!);
}
