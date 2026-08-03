/**
 * Public surface of the observations feature.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
/** Exposed for this route layer's own `observation-photos-panel.tsx`, which composes the media feature's upload machinery with this feature's purpose vocabulary. */
export { OBSERVATION_PHOTO_PURPOSES, photoPurposeLabel } from './labels';
export { ObservationTimeline } from './observation-timeline';
export { PlantJournalStrip } from './plant-journal-strip';
export { RecordObservationForm } from './record-observation-form';
export {
  useCorrectObservation,
  useObservationsForGarden,
  useObservationsForPlant,
  useRecordObservation,
  useSetHealthSuggestionDisposition,
} from './queries';
