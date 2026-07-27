/**
 * English messages for the Context quality section (P9D-UX-01): one row per
 * `GardenContextKind`, its declared value, its source, and — for a
 * horticulturally reviewed default — who reviewed it and when.
 *
 * A separate module spread into `en.ts`, the same split-by-domain judgment
 * `en-today.ts`'s own header documents.
 *
 * Source: architecture/web-application-design.md, section "15. Localization";
 * packages/api-contracts/src/garden-context.ts.
 */
export const englishGardenContextMessages = {
  'contextQuality.title': 'Context quality',
  'contextQuality.description':
    'The declared facts about this garden’s growing environment, and how reliable each one is.',
  'contextQuality.loading': 'Loading garden context.',
  'contextQuality.retry': 'Try again',

  'contextQuality.notDeclared': 'Not yet declared',
  'contextQuality.recordedByDisplay': 'Declared by {profileId}',
  'contextQuality.reviewedByDisplay': 'Reviewed by {reviewedBy} on {reviewedOn}',

  'contextQuality.edit': 'Edit',
  'contextQuality.declare': 'Declare',
  'contextQuality.cancelEdit': 'Cancel',
  'contextQuality.save': 'Save',
  'contextQuality.valueLabel': 'Value',
  'contextQuality.valueRequired': 'Enter a value.',

  'contextQuality.kind.sunExposure': 'Sun exposure',
  'contextQuality.kind.soilType': 'Soil type',
  'contextQuality.kind.drainage': 'Drainage',
  'contextQuality.kind.irrigationMethod': 'Irrigation method',
  'contextQuality.kind.growingContext': 'Growing context',
  'contextQuality.kind.microclimate': 'Microclimate',

  'contextQuality.source.userDeclared': 'Declared by a member',
  'contextQuality.source.horticulturallyReviewedDefault': 'Horticulturally reviewed default',
  'contextQuality.source.imported': 'Imported',

  'contextQuality.enum.sunExposure.fullSun': 'Full sun',
  'contextQuality.enum.sunExposure.partialSun': 'Partial sun',
  'contextQuality.enum.sunExposure.partialShade': 'Partial shade',
  'contextQuality.enum.sunExposure.fullShade': 'Full shade',

  'contextQuality.enum.drainage.wellDrained': 'Well drained',
  'contextQuality.enum.drainage.poorDrainage': 'Poor drainage',
  'contextQuality.enum.drainage.waterlogged': 'Waterlogged',

  'contextQuality.enum.irrigationMethod.manual': 'Manual',
  'contextQuality.enum.irrigationMethod.drip': 'Drip',
  'contextQuality.enum.irrigationMethod.sprinkler': 'Sprinkler',
  'contextQuality.enum.irrigationMethod.none': 'None',

  'contextQuality.enum.growingContext.openGround': 'Open ground',
  'contextQuality.enum.growingContext.container': 'Container',
  'contextQuality.enum.growingContext.greenhouse': 'Greenhouse',
} as const;
