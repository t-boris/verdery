/**
 * Public surface of the candidates feature.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export { AddCandidateForm } from './add-candidate-form';
export { CandidateDetail } from './candidate-detail';
export { CandidateList } from './candidate-list';
export {
  useAddCandidate,
  useAddCandidateFromPhoto,
  useIdentifyCandidateFromPhoto,
  useCandidate,
  useCandidatePhotos,
  useCandidateSuitability,
  useConvertCandidate,
  useListCandidates,
  useRecalculateCandidateSuitability,
  useSetCandidateStatus,
  useUpdateCandidateDetails,
} from './queries';
