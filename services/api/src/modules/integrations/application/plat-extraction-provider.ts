/**
 * Reading a surveyor's plat: the port, and nothing about who reads it.
 *
 * A plat of survey states in print what a person otherwise retypes — the
 * street address, the bearings and distances of every lot line, and which way
 * north is. This port asks a vision provider for exactly those, AS TEXT, and
 * refuses to ask it for anything else:
 *
 * - **No geometry.** The polygon is computed from the calls by
 *   `gardens-mapping/domain/survey-traverse.ts`, because a traverse that does
 *   not close is a reading with an error in it, and asking a model for the
 *   finished shape throws that check away.
 * - **No coordinates.** A plat carries no latitude or longitude — it is a
 *   relative survey. The address it prints goes through the geocoder this
 *   product already has.
 * - **No conclusions.** Everything here is a candidate a person reviews
 *   (ADR-0018); nothing this returns is garden geometry until accepted.
 *
 * The shape is the codebase's usual one for an external capability: a port
 * here, one adapter beside it, one registration. The Vertex adapter is
 * `../persistence/vertex-ai-plat-extraction-adapter.ts`.
 *
 * Source: docs/architecture/decisions/ADR-0018-plat-extraction-as-reviewable-proposals.md;
 * architecture/external-integrations.md, section "3. Adapter Contract".
 */

import type { PlantPhotoReference } from './plant-species-identification-provider.js';

/** A quadrant bearing exactly as printed: `S 44°55'39" E`. */
export interface ExtractedBearing {
  readonly reference: 'north' | 'south';
  readonly degrees: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly turn: 'east' | 'west';
}

/** One boundary line, as the drawing calls it. */
export interface ExtractedBoundaryCall {
  /**
   * `null` when the line's direction was not legible — a curved frontage
   * printed among radius and arc figures is where this happens.
   *
   * The line is still returned, and that is the point: a closed figure
   * recovers a missing direction from the other sides, but nothing recovers
   * a side that was never mentioned. See `survey-traverse.ts`.
   */
  readonly bearing: ExtractedBearing | null;
  /** Along the line, in feet, as printed. */
  readonly distanceFeet: number;
  /**
   * The label the distance was read from — `MEASURED = 135.06`, `CHORD =
   * 78.66`. Kept verbatim so a reviewer can find it on the page instead of
   * taking the number on trust.
   */
  readonly sourceLabel: string;
}

/**
 * Categories a plat actually draws, mapped onto this product's own object
 * vocabulary. Deliberately short: a plat labels what it labels, and offering
 * the model a category it cannot see invites it to invent one.
 */
export type ExtractedObjectCategory =
  'structure' | 'path' | 'fence' | 'zone' | 'waterFeature' | 'utilityExclusion' | 'tree';

/**
 * One thing drawn on the sheet, in PAGE coordinates.
 *
 * Page coordinates, not metres, and that is the whole trick: the model is
 * good at saying where something sits on an image and bad at arithmetic. The
 * lot's outline is read the same way, and because the lot's TRUE shape is
 * known from the boundary calls, one similarity fit carries every other
 * shape into real metres at the survey's own scale
 * (`gardens-mapping/domain/page-to-ground.ts`).
 *
 * WHAT THE POINTS MEAN depends on the category, because the map's own
 * categories differ in kind: a structure is an area, a path and a fence are
 * lines, a tree is a position (`geometry-contracts/object-category.ts`). The
 * reader is asked for the right one per category rather than for an outline
 * every time, so an accepted proposal is a shape the map can actually hold
 * instead of one that has to be converted after the fact.
 */
export interface ExtractedPageObject {
  readonly category: ExtractedObjectCategory;
  /** What the drawing calls it, verbatim, or an empty string for clear unlabelled linework. */
  readonly label: string;
  /**
   * Each point in `[0, 1]` of the page's width and height, origin top-left:
   * an area's corners, a line's course, or a tree's trunk. How many are
   * required is checked where the category's meaning is known, not here.
   */
  readonly pagePoints: readonly (readonly [number, number])[];
  /** The model's own confidence, `0..1`. Carried to review, never used to decide anything on its own. */
  readonly confidence: number;
}

export interface ExtractedPlat {
  /**
   * The property address as printed, or `null` when the sheet does not carry
   * one. Never inferred from the subdivision name or the surveyor's own
   * address — those are on the page too, and guessing between them is how a
   * garden ends up in the wrong town.
   */
  readonly address: string | null;
  /**
   * Degrees the drawing's north arrow points clockwise from the page's up
   * direction, or `null` when no arrow was found. A plan rendered from this
   * is rotated by it so the map's north and the drawing's agree.
   */
  readonly northRotationDegrees: number | null;
  /** The boundary calls, in the order they are described. Empty when none were legible. */
  readonly boundaryCalls: readonly ExtractedBoundaryCall[];
  /** The surveyed area as printed, in square feet — a reviewer's independent check on the walk. */
  readonly statedAreaSquareFeet: number | null;
  /**
   * The lot's own outline in page coordinates. The bridge between what the
   * model can see and what the survey knows: fitting this onto the polygon
   * the boundary calls describe gives the page-to-ground transform every
   * other outline is carried by.
   */
  readonly lotPageOutline: readonly (readonly [number, number])[];
  /** Everything else the sheet draws — the house, the deck, the drive, the easements. */
  readonly pageObjects: readonly ExtractedPageObject[];
}

export type PlatExtractionAdapterOutcome =
  | { readonly kind: 'extracted'; readonly plat: ExtractedPlat }
  /** The page is not a plat of survey — a landscape sketch, a photograph, a deed. */
  | { readonly kind: 'notAPlat' }
  | { readonly kind: 'schemaInvalid'; readonly rawText: string | null }
  | { readonly kind: 'safetyBlocked' };

export interface PlatExtractionModelIdentity {
  readonly model: string;
  readonly promptTemplateVersion: number;
}

export interface PlatExtractionRequest {
  /** The rendered page, as a stored object the provider reads directly. */
  readonly page: PlantPhotoReference;
}

export interface PlatExtractionProviderAdapter {
  readonly identity: PlatExtractionModelIdentity;
  extractPlat(
    request: PlatExtractionRequest,
    signal: AbortSignal,
  ): Promise<PlatExtractionAdapterOutcome>;
}
