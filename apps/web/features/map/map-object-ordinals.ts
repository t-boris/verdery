import type { MapObjectRecord } from './types';

/**
 * The stable per-object ordinal Kern prints in both the object index and on
 * the canvas.
 *
 * WHY IT IS DERIVED FROM THE FULL RECORD SET, not from whatever is on screen.
 * The object index hides objects whose layer is hidden; the canvas hides those
 * AND everything outside the viewport (`isRecordInViewport`). Numbering either
 * filtered set would give the same object two different numbers depending on
 * where you looked at it, and would renumber every object whenever a layer was
 * toggled or the map was panned. Numbering the full set instead means the
 * index can legitimately read 1, 3, 7 with a layer hidden — which is the point:
 * the ordinal identifies an OBJECT, it is not a row counter.
 *
 * This is what lets a keyboard user and a pointer user name objects
 * identically ("number 4") without either of them relying on colour, which no
 * category vocabulary can carry accessibly on its own.
 *
 * Source: templates/kern-grid/IMPLEMENTATION.md, section 3 ("Object index").
 */
export function mapObjectOrdinals(
  records: readonly MapObjectRecord[],
): ReadonlyMap<string, number> {
  return new Map(records.map((record, index) => [record.id, index + 1]));
}

/** Fixed-width so a column of ordinals aligns without depending on the font's own tabular figures. */
export function formatOrdinal(ordinal: number | undefined): string {
  return ordinal === undefined ? '--' : String(ordinal).padStart(2, '0');
}
