/**
 * Shared helpers for the snapshot readers (P8-EXPORT-01) — split from
 * `kysely-garden-content-reader.ts` for the 600-line file rule, alongside
 * the recommendations reader that shares them.
 */

export const PAGE_SIZE = 1000;

/** The two user-uploaded original classes an export is entitled to — see `kysely-garden-content-reader.ts`'s header for the exclusion reasoning. */
export const EXPORTABLE_MEDIA_CLASSES: readonly string[] = ['garden_photo', 'imported_plan'];

export type Row = Record<string, unknown>;

/** Drains a keyset-paged query: `fetchPage(afterId)` must return rows ordered by `id` ascending. */
export async function readAllPages<T extends { readonly id: string }>(
  fetchPage: (afterId: string | null) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page = await fetchPage(afterId);
    all.push(...page);
    if (page.length < PAGE_SIZE) {
      return all;
    }
    afterId = page[page.length - 1]?.id ?? null;
  }
}

const CAMEL_CACHE = new Map<string, string>();

function toCamel(key: string): string {
  const cached = CAMEL_CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const converted = key.replaceAll(/_([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());
  CAMEL_CACHE.set(key, converted);
  return converted;
}

/** snake_case row -> camelCase JSON object with ISO instants — the package's one value vocabulary. */
export function toJsonRecord(row: Row): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    record[toCamel(key)] = value instanceof Date ? value.toISOString() : value;
  }
  return record;
}
