import styles from './snapshot-data-list.module.css';

/**
 * `snapshotData`'s shape (`ClientGardenOverview`/`ClientPublicationItem`/
 * `ClientTimelineEntry`) is `additionalProperties: true` in the contract —
 * an open, publisher-defined bag with no fixed schema this application can
 * design bespoke UI around. Rendering every entry as a plain label/value
 * row is the honest generic treatment: it shows exactly what the publisher
 * attached, without inventing structure the contract does not promise.
 *
 * Shared by the overview, publication items, and timeline entries — the one
 * piece of rendering genuinely identical across all three, unlike their
 * surrounding structure (see `client-timeline.tsx`'s own doc comment for why
 * the surrounding structure is NOT shared).
 */
export function SnapshotDataList({ data }: { readonly data: Readonly<Record<string, unknown>> }) {
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return null;
  }

  return (
    <dl className={styles['list']}>
      {entries.map(([key, value]) => (
        <div key={key} className={styles['row']}>
          <dt className={styles['key']}>{key}</dt>
          <dd className={styles['value']}>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
