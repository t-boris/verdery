/**
 * Public surface of the media feature.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export { GardenPhotoUpload, type GardenPhotoUploadProps } from './garden-photo-upload';
export { GardenPlanUpload, type GardenPlanUploadProps } from './garden-plan-upload';
export { MediaPreview, type MediaPreviewProps } from './media-preview';
export {
  type MediaUploadFailureReason,
  type MediaUploadPhase,
  type MediaUploadState,
} from './media-upload-controller';
export { useExactDuplicateMedia, useMediaAccess, useSimilarMedia } from './queries';
export { useMediaUpload, type UseMediaUploadResult } from './use-media-upload';
/**
 * Exposed for `app/application/gardens/[gardenId]/plants/add-plant-from-photo-panel.tsx`
 * (ADR-0015), which reuses this exact upload-phase display vocabulary rather
 * than a second copy — the same page-composes-features reasoning that file's
 * own doc comment gives for importing this feature directly.
 */
export { formatBytes, uploadFailureReasonLabel, uploadPhaseLabel } from './labels';
