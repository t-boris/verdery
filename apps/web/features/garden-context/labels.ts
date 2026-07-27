import type { GardenContextKind, GardenContextSource, GardenRole } from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';

/**
 * Every `GardenContextKind` this UI renders a row for, in a stable display
 * order. Duplicated client-side rather than imported — `GARDEN_CONTEXT_KINDS`
 * lives in `services/api`'s own domain layer, not in `@verdery/api-contracts`,
 * the same "the web client keeps its own copy of a server enum's value set"
 * precedent `features/tasks/labels.ts`'s `TASK_STATUSES` and
 * `features/plants/labels.ts`'s `PLANT_GROUPING_KINDS` already establish.
 * Keep this in sync with `services/api/src/modules/gardens-mapping/domain/
 * garden-context-fact.ts`'s own `GARDEN_CONTEXT_KINDS`.
 */
export const GARDEN_CONTEXT_KINDS: readonly GardenContextKind[] = [
  'sun_exposure',
  'soil_type',
  'drainage',
  'irrigation_method',
  'growing_context',
  'microclimate',
];

export function contextKindLabel(kind: GardenContextKind): MessageKey {
  switch (kind) {
    case 'sun_exposure':
      return 'contextQuality.kind.sunExposure';
    case 'soil_type':
      return 'contextQuality.kind.soilType';
    case 'drainage':
      return 'contextQuality.kind.drainage';
    case 'irrigation_method':
      return 'contextQuality.kind.irrigationMethod';
    case 'growing_context':
      return 'contextQuality.kind.growingContext';
    case 'microclimate':
      return 'contextQuality.kind.microclimate';
  }
}

export function contextSourceLabel(source: GardenContextSource): MessageKey {
  switch (source) {
    case 'user_declared':
      return 'contextQuality.source.userDeclared';
    case 'horticulturally_reviewed_default':
      return 'contextQuality.source.horticulturallyReviewedDefault';
    case 'imported':
      return 'contextQuality.source.imported';
  }
}

/**
 * The fixed vocabulary for the four enumerated `contextKind`s, each paired
 * with the catalogue key naming it — a `<select>` rather than free text, so
 * an invalid enum value cannot be typed in the first place, the same
 * reasoning `shared/ui/select.tsx`'s own doc comment gives for
 * `features/map`'s category-detail forms. `soil_type`/`microclimate` return
 * `null`: they are free text, the same latitude `bed_details.soil_notes`
 * already takes (`garden-context-fact.ts`'s own domain header).
 *
 * Values and their labels match `services/api/.../domain/garden-context-fact.ts`'s
 * `SUN_EXPOSURE_VALUES`/`DRAINAGE_VALUES`/`IRRIGATION_METHOD_VALUES`/
 * `GROWING_CONTEXT_VALUES` exactly — this is the one place the web client
 * needs to agree with that server-side vocabulary.
 */
export function contextValueOptions(
  kind: GardenContextKind,
): readonly { readonly value: string; readonly labelKey: MessageKey }[] | null {
  switch (kind) {
    case 'sun_exposure':
      return [
        { value: 'full_sun', labelKey: 'contextQuality.enum.sunExposure.fullSun' },
        { value: 'partial_sun', labelKey: 'contextQuality.enum.sunExposure.partialSun' },
        { value: 'partial_shade', labelKey: 'contextQuality.enum.sunExposure.partialShade' },
        { value: 'full_shade', labelKey: 'contextQuality.enum.sunExposure.fullShade' },
      ];
    case 'drainage':
      return [
        { value: 'well_drained', labelKey: 'contextQuality.enum.drainage.wellDrained' },
        { value: 'poor_drainage', labelKey: 'contextQuality.enum.drainage.poorDrainage' },
        { value: 'waterlogged', labelKey: 'contextQuality.enum.drainage.waterlogged' },
      ];
    case 'irrigation_method':
      return [
        { value: 'manual', labelKey: 'contextQuality.enum.irrigationMethod.manual' },
        { value: 'drip', labelKey: 'contextQuality.enum.irrigationMethod.drip' },
        { value: 'sprinkler', labelKey: 'contextQuality.enum.irrigationMethod.sprinkler' },
        { value: 'none', labelKey: 'contextQuality.enum.irrigationMethod.none' },
      ];
    case 'growing_context':
      return [
        { value: 'open_ground', labelKey: 'contextQuality.enum.growingContext.openGround' },
        { value: 'container', labelKey: 'contextQuality.enum.growingContext.container' },
        { value: 'greenhouse', labelKey: 'contextQuality.enum.growingContext.greenhouse' },
      ];
    case 'soil_type':
    case 'microclimate':
      return null;
  }
}

/** The label for one declared value, when `contextKind` has a fixed vocabulary and the value is a recognized member of it — `null` for free text or an unrecognized value, so the caller falls back to the raw string rather than a missing translation. */
export function contextValueLabel(kind: GardenContextKind, value: string): MessageKey | null {
  const options = contextValueOptions(kind);
  return options?.find((option) => option.value === value)?.labelKey ?? null;
}

/**
 * Whether the signed-in caller may edit garden context facts —
 * `editGardenContent`, held by an active `owner` or `editor`
 * (`record-garden-context-fact.ts`'s own header: "Same capability as
 * editing garden map content"). Mirrors
 * `features/tasks/assignable-members.ts`'s `selectAssignableMembers`,
 * which encodes the identical role pair for the identical capability.
 */
export function canEditGardenContent(role: GardenRole): boolean {
  return role === 'owner' || role === 'editor';
}
