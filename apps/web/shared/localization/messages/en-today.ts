/**
 * English messages for the Today view and recommendations (P7-WEB-01).
 *
 * A separate module spread into `en.ts` rather than more lines in it: the
 * main catalogue sits at the repository's 600-line source-file limit, so new
 * message domains now arrive as their own modules — the same split-by-size
 * judgment `api-contracts/src/media-processing.ts` documents. Key identity
 * and typing discipline are unchanged: these keys join `englishMessages`,
 * and `ru-today.ts` is typed against this module so it cannot omit or
 * invent one.
 *
 * `tasks.fromRecommendation` lives here despite its `tasks.` prefix — it is
 * this work package's outcome-history linkage rendered on a task row, and
 * message keys are one flat namespace regardless of which module file
 * declares them.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const englishTodayMessages = {
  'today.pageTitle': 'Today',
  'today.pageDescription':
    'Prioritized care recommendations for this garden — each with its reason, evidence, and controls.',
  'today.loading': 'Loading recommendations.',
  'today.retry': 'Try again',
  'today.empty': 'Nothing needs attention right now.',

  'today.priorityDisplay': 'Priority {score} / 100',
  'today.windowRange': 'Relevant {start} – {end}',
  'today.windowUntil': 'Act before {end}',
  'today.windowFrom': 'Relevant from {start}',
  'today.reasonLabel': 'Reason',
  'today.safetyElevatedRisk': 'Elevated risk',
  'today.safetyElevatedRiskNote':
    'This suggestion carries elevated risk. Review it carefully before acting.',
  'today.uncertaintyContribution': 'Confidence: {contribution} points',
  'today.uncertaintyMissing': 'No confidence signal was recorded for this recommendation.',

  'today.basis.sourceOwnRecords': "based on this garden's own records",
  'today.basis.sourceUserDeclaredLifecycleStage': 'based on the lifecycle stage you set',
  'today.basis.sourceForecast': 'based on a weather forecast',
  'today.basis.weatherFresh': 'using recent weather data',
  'today.basis.weatherStale': 'using cached weather data that may be out of date',
  'today.basis.daysSince': 'measured over {days} days',
  'today.detailEntry': '{key}: {value}',
  'today.detailValue': 'Value: {value}',

  'today.detailsShow': 'Show evidence and factors',
  'today.detailsHide': 'Hide evidence and factors',
  'today.factorsTitle': 'Priority factors',
  'today.factorContribution': '{contribution} points',
  'today.evidenceTitle': 'Evidence',
  'today.evidencePlantNamed': 'Plant: {name}',
  'today.evidenceRecordReference': 'Record {id}',
  'today.ruleIdentity': 'Rule {key} v{version}',

  'today.enum.evidence.plantIdentity': 'Plant identity',
  'today.enum.evidence.gardenContext': 'Garden context',
  'today.enum.evidence.weather': 'Weather',
  'today.enum.evidence.soilMoisture': 'Soil moisture',
  'today.enum.evidence.observation': 'Observation',
  'today.enum.evidence.task': 'Task',
  'today.enum.evidence.lifecycleStage': 'Lifecycle stage',
  'today.enum.evidence.geometryExposure': 'Geometry and exposure',
  'today.enum.evidence.userPreference': 'Preferences',

  'today.enum.factor.urgencyWindow': 'Urgency window',
  'today.enum.factor.plantImpact': 'Plant impact',
  'today.enum.factor.confidence': 'Confidence',
  'today.enum.factor.weatherOpportunityOrRisk': 'Weather opportunity or risk',
  'today.enum.factor.userEffortAndAvailability': 'Effort and availability',
  'today.enum.factor.taskOverlap': 'Task overlap',
  'today.enum.factor.safetyConstraint': 'Safety constraints',
  'today.enum.factor.seasonalConstraint': 'Seasonal constraints',

  'today.complete': 'Complete',
  'today.dismiss': 'Dismiss',
  'today.markIrrelevant': 'Not relevant',
  'today.markIrrelevantRecorded': 'Thanks — this feedback was recorded.',
  'today.postpone': 'Postpone',
  'today.postponeUntilLabel': 'Show again after (optional)',
  'today.postponeSubmit': 'Postpone',
  'today.postponeCancel': 'Cancel',
  'today.convertToTask': 'Add to tasks',

  'tasks.fromRecommendation': 'Created from a recommendation',
} as const;
