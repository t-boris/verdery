import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { englishMessages } from './messages/en';
import { russianMessages } from './messages/ru';

/**
 * Every user-visible string is a catalogue key, in every component.
 *
 * The type system already guarantees that Russian cannot *omit* a key
 * (`ru.ts` is typed as `MessageCatalogue`, derived from `en.ts`). What it
 * cannot see is a string that never became a key at all — an English sentence
 * written straight into JSX ships an untranslatable interface with no
 * compile error and no failing test. This suite is the check for that: it
 * reads every component in the application and fails on prose that is not
 * routed through `t(...)`.
 *
 * Two shapes are checked, because both reach a reader:
 *
 * - JSX text children (`<p>Something</p>`).
 * - Naming attributes (`aria-label`, `placeholder`, `title`, `alt`, `label`),
 *   which a screen reader speaks even though nothing renders them as text.
 *
 * Source: architecture/web-application-design.md, section "15. Localization"
 * ("The client owns interface strings"); technical-specification.md, section
 * 12.5 ("Product text must support Russian and English").
 */

const COMPONENT_ROOTS = ['app', 'core', 'features', 'shared'] as const;

/**
 * Keys whose value is deliberately the empty string.
 *
 * `media.phase.idle` is the "nothing is happening" phase of the upload
 * controller: its cell in the phase table exists so the mapping stays
 * exhaustive, and rendering nothing is the intended outcome.
 */
const DELIBERATELY_EMPTY = new Set(['media.phase.idle']);

/**
 * Strings that are deliberately not translated.
 *
 * Each entry is punctuation with no linguistic content. The list is short by
 * design — an addition to it is a decision to ship an untranslated string.
 */
const NOT_PROSE = new Set([
  // Typographic separators and glyphs carrying no words.
  '·',
  '—',
  '–',
  '-',
  '/',
  ':',
  ',',
  '.',
  '%',
  '×',
  '▸',
  '✓',
  '✗',
  '&nbsp;',
]);

function componentFiles(): readonly string[] {
  const found: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (path.endsWith('.tsx') && !path.includes('.test.')) {
        found.push(path);
      }
    }
  };

  for (const root of COMPONENT_ROOTS) {
    walk(join(process.cwd(), root));
  }

  return found;
}

/**
 * Blanks every comment out of a source file while preserving its line
 * structure, so a line number still points at the right line.
 *
 * Comments matter here because they routinely quote markup — this very
 * suite's own doc comment does — and a quoted example is not shipped copy.
 */
function withoutComments(source: string): string {
  const blankOut = (text: string) => text.replace(/[^\n]/gu, ' ');
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/gu, blankOut)
    .replace(/\/\*[\s\S]*?\*\//gu, blankOut)
    .replace(/^\s*\/\/.*$/gmu, blankOut);
}

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** A JSX text child on a single line: `>text<`, with no braces inside. */
const JSX_TEXT = /(?<![=/])>([^<>{}\n]*[A-Za-zА-Яа-яЁё][^<>{}\n]*)</gu;

/** A naming attribute given a literal rather than an expression. */
const NAMING_ATTRIBUTE =
  /\s(aria-label|aria-description|aria-placeholder|alt|label|placeholder|title)=["']([^"'\n]*[A-Za-zА-Яа-яЁё][^"'\n]*)["']/gu;

function findOffences(): readonly Offence[] {
  const offences: Offence[] = [];

  for (const file of componentFiles()) {
    const relativePath = relative(process.cwd(), file);
    const lines = withoutComments(readFileSync(file, 'utf8')).split('\n');

    lines.forEach((line, index) => {
      for (const match of line.matchAll(JSX_TEXT)) {
        const text = (match[1] ?? '').trim();
        if (text !== '' && !NOT_PROSE.has(text)) {
          offences.push({ file: relativePath, line: index + 1, text });
        }
      }

      for (const match of line.matchAll(NAMING_ATTRIBUTE)) {
        const text = (match[2] ?? '').trim();
        if (text !== '' && !NOT_PROSE.has(text)) {
          offences.push({
            file: relativePath,
            line: index + 1,
            text: `${match[1] ?? ''}="${text}"`,
          });
        }
      }
    });
  }

  return offences;
}

describe('user-visible copy', () => {
  it('reads every component in the application', () => {
    const files = componentFiles();

    // A path change that quietly stopped this suite from seeing any component
    // would otherwise make it pass vacuously forever.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.endsWith('today-card.tsx'))).toBe(true);
    expect(files.some((file) => file.endsWith('map-toolbar.tsx'))).toBe(true);
  });

  it('is never a literal in JSX or in a naming attribute', () => {
    const offences = findOffences();

    expect(
      offences.map((offence) => `${offence.file}:${String(offence.line)} ${offence.text}`),
    ).toEqual([]);
  });
});

describe('message catalogues', () => {
  it('define the same keys in English and Russian, including the Today modules', () => {
    const english = Object.keys(englishMessages).sort();
    const russian = Object.keys(russianMessages).sort();

    expect(russian).toEqual(english);

    // `en-today.ts` / `ru-today.ts` are spread into the two catalogues above,
    // so their keys must be inside the set just compared. Asserting a sample
    // of them explicitly is what keeps a future split module from silently
    // dropping out of the comparison.
    for (const key of ['today.pageTitle', 'today.windowRange', 'tasks.fromRecommendation']) {
      expect(english, `${key} is missing from the English catalogue`).toContain(key);
      expect(russian, `${key} is missing from the Russian catalogue`).toContain(key);
    }
  });

  it('gives every key a non-empty translation in both languages', () => {
    const empty = (catalogue: Readonly<Record<string, string>>) =>
      Object.entries(catalogue)
        .filter(([key, value]) => value.trim() === '' && !DELIBERATELY_EMPTY.has(key))
        .map(([key]) => key);

    const emptyEnglish = empty(englishMessages);
    const emptyRussian = empty(russianMessages);

    expect(emptyEnglish).toEqual([]);
    expect(emptyRussian).toEqual([]);
  });

  it('leaves no Russian entry still holding the English text', () => {
    // A message that is nothing but placeholders and punctuation
    // (`'{key}: {value}'`) is legitimately identical in both languages, so
    // the placeholders are removed before asking whether any prose remains.
    const prose = (template: string) => template.replace(/\{\w+\}/gu, '');

    const identical = Object.keys(englishMessages).filter((key) => {
      const typed = key as keyof typeof englishMessages;
      const english = englishMessages[typed];
      return english === russianMessages[typed] && /[A-Za-z]{4}/u.test(prose(english));
    });

    expect(identical).toEqual(['app.name']);
  });

  it('declares the same interpolation placeholders in both languages', () => {
    const placeholders = (template: string) =>
      [...template.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]).sort();

    const mismatched = Object.keys(englishMessages).filter((key) => {
      const typed = key as keyof typeof englishMessages;
      return (
        JSON.stringify(placeholders(englishMessages[typed])) !==
        JSON.stringify(placeholders(russianMessages[typed]))
      );
    });

    expect(mismatched).toEqual([]);
  });
});
