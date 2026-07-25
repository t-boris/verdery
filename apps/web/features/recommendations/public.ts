/**
 * Public surface of the recommendations feature.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export { TodayList } from './today-list';
export {
  useCompleteRecommendation,
  useConvertRecommendationToTask,
  useDismissRecommendation,
  useMarkRecommendationIrrelevant,
  usePostponeRecommendation,
  useTodayRecommendations,
} from './queries';
