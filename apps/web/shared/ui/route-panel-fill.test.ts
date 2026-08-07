/**
 * Guards the one thing about `RoutePanel`'s `fill` variant that nothing else
 * can catch: `fill` is only meaningful on a route whose body has a single
 * panel.
 *
 * WHY THIS EXISTS. `.panelFill` is `flex: 1` with `flex-basis: 0` and
 * `overflow-y: auto` — "take the body's leftover height, scroll inside
 * yourself". Siblings that size to their own content leave no leftover
 * height, so the fill panel resolves to its zero basis and becomes a
 * scrolling sliver instead of the page's main content.
 *
 * That is not hypothetical. The Today route shipped with one fill panel and
 * was correct; two content-sized panels were later added around it, and its
 * recommendations — the entire point of the route — collapsed into a ~40px
 * strip with its own scrollbar. Nothing failed: types were fine, the
 * component tests passed, every request returned 200, and the defect was
 * invisible while the list happened to be empty.
 *
 * WHAT A FAILURE MEANS AND HOW TO FIX IT: the named route grew a second
 * panel. Drop `fill` — the body already scrolls as one column, and panels
 * that size to their content read correctly stacked. Keep `fill` only where
 * the panel really is alone and needs to own the viewport height.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Resolved from the working directory rather than `import.meta.url`: this
// suite runs under jsdom, where `import.meta.url` is not a file URL and
// resolving against it silently yields a path outside the repository.
const APP_DIRECTORY = join(process.cwd(), 'app');

async function pageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return pageFiles(path);
      }
      return entry.name === 'page.tsx' ? [path] : [];
    }),
  );
  return found.flat();
}

describe('RoutePanel fill', () => {
  it('is used only on routes whose body holds a single panel', async () => {
    // A wrong working directory would otherwise scan nothing and pass,
    // which is the one way a guard like this fails silently.
    expect((await stat(APP_DIRECTORY)).isDirectory()).toBe(true);
    const pages = await pageFiles(APP_DIRECTORY);
    expect(pages.length).toBeGreaterThan(0);

    const offenders: string[] = [];

    for (const path of pages) {
      const source = await readFile(path, 'utf8');
      if (!source.includes('<RoutePanel fill')) {
        continue;
      }
      const panelCount = source.match(/<RoutePanel[\s>]/g)?.length ?? 0;
      if (panelCount > 1) {
        offenders.push(`${path.replace(APP_DIRECTORY, 'app')} has ${panelCount} panels`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
