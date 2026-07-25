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
export { useMediaAccess } from './queries';
export { useMediaUpload, type UseMediaUploadResult } from './use-media-upload';
