import type { WireValidationSeverity } from '@/core/api/public';
import type { MessageArguments, MessageKey } from '@/shared/localization/public';

/**
 * Maps a `WireValidationIssue.code` onto a localized message for
 * `map-warnings-panel.tsx`.
 *
 * The backend's cross-object validation is not implemented yet —
 * `services/api/src/modules/gardens-mapping/application/get-garden-map.ts`
 * always returns `validationSummary: []` today, with its own doc comment
 * explaining why (cross-object geometry/topology queries this work package
 * does not implement). This mapping therefore cannot be exhaustive against a
 * closed set of known codes the way `labels.ts`'s `categoryLabelKey` is
 * against `GardenObjectCategory`: new codes will arrive as that backend
 * validation logic grows, and an unrecognized one must render a readable
 * fallback, never fail or hard-crash the panel.
 *
 * `geometry.polygon.below_minimum_area` is the one concrete example already
 * cross-referenced elsewhere in this codebase —
 * `apps/ios/Tests/CoreNetworkingTests/MapGatewayTests.swift`'s fixture
 * constructs a `validationSummary` entry with exactly this code, for the
 * same shape this module works with.
 */
const KNOWN_CODE_KEYS: Readonly<Record<string, MessageKey>> = {
  'geometry.polygon.below_minimum_area': 'map.warnings.code.belowMinimumArea',
};

export interface WarningMessage {
  readonly key: MessageKey;
  readonly args?: MessageArguments;
}

/** Never throws for an unrecognized code — falls back to a generic message that still shows the raw code. */
export function warningMessageFor(code: string): WarningMessage {
  const known = KNOWN_CODE_KEYS[code];
  if (known !== undefined) {
    return { key: known };
  }
  return { key: 'map.warnings.code.fallback', args: { code } };
}

/**
 * Message key for a severity's visible label. Always paired with a distinct
 * `StatusPill` tone (`map-warnings-panel.tsx`) so severity is never carried
 * by color alone — architecture doc section "19. Accessibility", "Non-color
 * confidence and state indicators".
 */
export function severityLabelKey(severity: WireValidationSeverity): MessageKey {
  return severity === 'error' ? 'map.warnings.severityError' : 'map.warnings.severityWarning';
}
