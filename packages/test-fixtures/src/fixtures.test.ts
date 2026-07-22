import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixtureRoot, loadFixture, resolveNumber } from './index.js';

/** Every fixture file in the package, as paths relative to the fixture root. */
function allFixturePaths(directory = ''): string[] {
  const absolute = join(fixtureRoot, directory);

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = directory === '' ? entry.name : `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      return allFixturePaths(relative);
    }

    return entry.name.endsWith('.json') ? [relative] : [];
  });
}

const fixturePaths = allFixturePaths();

describe('fixture package', () => {
  it('contains fixtures', () => {
    expect(fixturePaths.length).toBeGreaterThan(0);
  });

  it.each(fixturePaths)('%s parses and declares a schema version', (path) => {
    const fixture = loadFixture<Record<string, unknown>>(path);

    expect(typeof fixture['schemaVersion']).toBe('number');
    expect(typeof fixture['description']).toBe('string');
    expect(typeof fixture['source']).toBe('string');
  });

  it.each(fixturePaths)('%s names every case', (path) => {
    const fixture = loadFixture<{ cases?: { name?: unknown }[] }>(path);

    for (const testCase of fixture.cases ?? []) {
      expect(typeof testCase.name).toBe('string');
      expect(testCase.name).not.toBe('');
    }
  });

  it.each(fixturePaths)('%s uses unique case names', (path) => {
    const fixture = loadFixture<{ cases?: { name: string }[] }>(path);
    const names = (fixture.cases ?? []).map((testCase) => testCase.name);

    expect(new Set(names).size).toBe(names.length);
  });
});

describe('resolveNumber', () => {
  it('passes finite numbers through', () => {
    expect(resolveNumber(1.5)).toBe(1.5);
    expect(resolveNumber(0)).toBe(0);
  });

  it('resolves the non-finite literals JSON cannot express', () => {
    expect(Number.isNaN(resolveNumber('NaN'))).toBe(true);
    expect(resolveNumber('Infinity')).toBe(Number.POSITIVE_INFINITY);
    expect(resolveNumber('-Infinity')).toBe(Number.NEGATIVE_INFINITY);
  });
});
