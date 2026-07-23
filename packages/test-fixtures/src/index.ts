/**
 * Loader for the language-neutral fixtures in this package.
 *
 * The fixtures themselves are plain JSON so that Swift, TypeScript, and any
 * future runtime read the same bytes. This module only resolves paths and
 * parses them for TypeScript consumers; it never transforms the data.
 *
 * Source: architecture/testing-strategy.md, section "4. Shared Test Assets".
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the fixture root, for runtimes that read the files
 * directly.
 *
 * Resolved via `dirname(fileURLToPath(import.meta.url))` rather than the
 * more common `fileURLToPath(new URL('../fixtures/', import.meta.url))`:
 * under a jsdom-environment Vitest project (e.g. `apps/web`), Vite's SSR
 * module runner resolves a `new URL(relative, import.meta.url)` construction
 * through its own dev-server virtual filesystem — the result comes back as
 * `http://localhost:.../@fs/...` instead of a `file:` URL, which
 * `fileURLToPath` then rejects. Reading `import.meta.url` directly, with no
 * relative-URL construction against it, is unaffected and resolves to the
 * real on-disk path in every environment this package is loaded from
 * (Node-environment Vitest projects and this jsdom one alike).
 */
export const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/');

/** Reads and parses a fixture by its path relative to the fixture root. */
export function loadFixture<T>(relativePath: string): T {
  const absolutePath = join(fixtureRoot, relativePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
}

/** A numeric value that JSON cannot express directly. */
export type NonFiniteLiteral = 'NaN' | 'Infinity' | '-Infinity';

/** Resolves a fixture number that may be encoded as a non-finite literal. */
export function resolveNumber(value: number | NonFiniteLiteral): number {
  if (typeof value === 'number') {
    return value;
  }

  switch (value) {
    case 'NaN':
      return Number.NaN;
    case 'Infinity':
      return Number.POSITIVE_INFINITY;
    case '-Infinity':
      return Number.NEGATIVE_INFINITY;
  }
}

export interface RoundingCase {
  readonly name: string;
  readonly input: number;
  readonly expected: number;
}

export interface RejectedRoundingCase {
  readonly name: string;
  readonly input: number | NonFiniteLiteral;
  readonly reason: 'outOfRange' | 'notFinite';
}

export interface RoundingFixture {
  readonly schemaVersion: number;
  readonly description: string;
  readonly source: string;
  readonly comparison: 'exact';
  readonly cases: readonly RoundingCase[];
  readonly rejectedCases: readonly RejectedRoundingCase[];
}

export interface ValidationCase {
  readonly name: string;
  readonly geometry: unknown;
  readonly expectedCodes: readonly string[];
}

export interface ValidationFixture {
  readonly schemaVersion: number;
  readonly description: string;
  readonly source: string;
  readonly cases: readonly ValidationCase[];
}

export interface CurveCase {
  readonly name: string;
  readonly controlPoints: readonly (readonly [number, number])[];
  readonly toleranceMetres: number;
  readonly expectedPolyline: readonly (readonly [number, number])[];
}

export interface CurveFixture {
  readonly schemaVersion: number;
  readonly description: string;
  readonly source: string;
  readonly comparison: 'exact';
  readonly cases: readonly CurveCase[];
}

export interface CommandInverseCase {
  readonly name: string;
  readonly command: unknown;
  readonly priorSnapshot: unknown;
  readonly revisionAfterCommand: number;
  readonly expectedInverse: unknown;
}

export interface CommandInverseFixture {
  readonly schemaVersion: number;
  readonly description: string;
  readonly source: string;
  readonly comparison: 'exact';
  readonly cases: readonly CommandInverseCase[];
}

/** The projection both clients derive from a wire `GardenObject` and compare against `expected`. */
export interface MapDocumentObjectProjection {
  readonly id: string;
  readonly category: string;
  readonly geometryType: string;
  readonly coordinateCount: number;
  readonly label: string | null;
  readonly lifecycleState: string;
  readonly detailsCategory: string | null;
  readonly detailsFields: Record<string, unknown> | null;
}

export interface MapDocumentCase {
  readonly name: string;
  readonly description: string;
  /** Wire-shaped `GardenObject` entries — see `apps/web/core/api/map-wire-types.ts`'s `WireGardenObject`. */
  readonly objects: readonly unknown[];
  readonly expected: readonly MapDocumentObjectProjection[];
}

export interface MapDocumentFixture {
  readonly schemaVersion: number;
  readonly description: string;
  readonly source: string;
  readonly comparison: 'exact';
  readonly cases: readonly MapDocumentCase[];
}
