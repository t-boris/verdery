'use client';

import type { ObservationPhotoAttachmentRequest } from '@verdery/api-contracts';
import { useState } from 'react';

import { RecordObservationForm } from '@/features/observations/public';

import { ObservationPhotosPanel } from './observation-photos-panel';

export interface RecordJournalEntryPanelProps {
  readonly gardenId: string;
  readonly plantId: string;
}

/**
 * Recording one journal entry: the photographs and the form that submits them
 * together.
 *
 * This is the composition seam. `ObservationPhotosPanel` needs
 * `features/media`, `RecordObservationForm` is `features/observations`, and
 * features never import each other — so the attachment list lives here, in the
 * route layer that owns both, and is handed to the form as a prop. Same shape
 * as `../add-plant-from-photo-panel.tsx`.
 *
 * The list is cleared when the form reports a successful record, so the next
 * entry does not silently re-attach the previous entry's photographs.
 *
 * Source: architecture/web-application-design.md, section "20. Dependency
 * Rules"; implementation-plan.md work package P11-MEDIA-01.
 */
export function RecordJournalEntryPanel({ gardenId, plantId }: RecordJournalEntryPanelProps) {
  const [photos, setPhotos] = useState<readonly ObservationPhotoAttachmentRequest[]>([]);

  return (
    <>
      <ObservationPhotosPanel gardenId={gardenId} value={photos} onChange={setPhotos} />
      <RecordObservationForm
        gardenId={gardenId}
        fixedPlantId={plantId}
        photos={photos}
        onRecorded={() => setPhotos([])}
      />
    </>
  );
}
