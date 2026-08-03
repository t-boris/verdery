/**
 * Tests for the derived rollback depth every migration rollback test uses.
 *
 * These read the real migrations directory: the helper's whole purpose is to
 * stay correct as that directory grows, so a fixture would test the wrong
 * thing.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rollbackDepthTo } from './migration-rollback-depth.js';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations', import.meta.url));

const MIGRATION_FILE_NAMES = readdirSync(MIGRATIONS_DIRECTORY)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const slugOf = (fileName: string): string => fileName.replace(/^\d+_/, '').replace(/\.sql$/, '');

describe('rollbackDepthTo', () => {
  it('gives the newest migration a depth of one', () => {
    const newest = MIGRATION_FILE_NAMES.at(-1)!;

    expect(rollbackDepthTo(slugOf(newest))).toBe(1);
  });

  it('gives the oldest migration a depth covering every migration', () => {
    const oldest = MIGRATION_FILE_NAMES[0]!;

    expect(rollbackDepthTo(slugOf(oldest))).toBe(MIGRATION_FILE_NAMES.length);
  });

  it('counts down one step per migration applied after the target', () => {
    // The property the hardcoded numbers used to encode by hand: adjacent
    // migrations differ by exactly one, oldest deepest.
    const depths = MIGRATION_FILE_NAMES.map((name) => rollbackDepthTo(slugOf(name)));

    expect(depths).toEqual(
      MIGRATION_FILE_NAMES.map((_, index) => MIGRATION_FILE_NAMES.length - index),
    );
  });

  it('refuses a slug no migration carries instead of guessing a depth', () => {
    // Rolling back the wrong depth would drop unrelated schema and still pass
    // whatever the test asserted afterwards.
    expect(() => rollbackDepthTo('no-such-migration')).toThrow(/no migration/);
  });
});
