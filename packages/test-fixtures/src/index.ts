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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the fixture root, for runtimes that read the files directly. */
export const fixtureRoot = fileURLToPath(new URL('../fixtures/', import.meta.url));

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
