/**
 * Guards the one property `node-pg-migrate` enforces at DEPLOY time and
 * nothing enforced at review time: migration order.
 *
 * WHY THIS EXISTS. Two branches independently picked the same three
 * timestamps, and nothing caught it. The filenames differed, so git merged
 * both sets without a conflict; every migration test applied the whole
 * directory from scratch, which succeeds whatever the numbering is; and the
 * failure only appeared on the deployed database, where the other branch's
 * migrations had already run and mine sorted at or before them.
 * `node-pg-migrate` refused the whole run — "Not run migration X is
 * preceding already run migration Y" — and took the deploy with it.
 *
 * The two checks below are the review-time counterpart. They need no
 * database, so they run in milliseconds on every push, and they fail on the
 * commit that introduces the collision rather than on the deploy that
 * discovers it.
 *
 * WHAT A FAILURE MEANS AND HOW TO FIX IT: pick a timestamp strictly greater
 * than every migration already on the branch you are merging into, and
 * rename. That is only safe while the migration has not been applied
 * anywhere — which, for a migration that has never deployed, it has not.
 */

import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const FILENAME = /^(\d{13})_[a-z0-9-]+\.sql$/;

async function migrationFilenames(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIRECTORY);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

describe('migration ordering', () => {
  it('names every migration <13-digit timestamp>_<kebab-case>.sql', async () => {
    for (const name of await migrationFilenames()) {
      expect(name, `${name} does not match the required migration filename shape`).toMatch(
        FILENAME,
      );
    }
  });

  it('gives every migration a UNIQUE timestamp', async () => {
    const byTimestamp = new Map<string, string[]>();
    for (const name of await migrationFilenames()) {
      const timestamp = FILENAME.exec(name)?.[1] ?? name;
      byTimestamp.set(timestamp, [...(byTimestamp.get(timestamp) ?? []), name]);
    }

    const collisions = [...byTimestamp.values()].filter((names) => names.length > 1);

    // A shared timestamp is not a cosmetic problem. Two migrations at the
    // same number have no defined order relative to each other, so which
    // one a database considers "already run" depends on which branch
    // deployed first — and the loser is then permanently un-appliable
    // without renaming. Merging both sets produces no git conflict, so this
    // assertion is the only thing standing between the collision and a
    // failed deploy.
    expect(collisions).toEqual([]);
  });
});
