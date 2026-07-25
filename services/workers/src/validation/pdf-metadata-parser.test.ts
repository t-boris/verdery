/**
 * Direct unit coverage of the non-executing PDF preflight's own named
 * ceilings and envelope checks (architecture/media-storage-and-processing.md
 * section 8.1: "requires a valid envelope and cross-reference
 * representation, limits documents to 100 pages and 200 objects per page,
 * and rejects encryption, ...") — P6-QA-01's parser-limit audit found the
 * page-count ceiling, the object-cardinality ceiling, the `/Encrypt`
 * branch, and the envelope rejections had no test anywhere: the
 * `MediaValidator` fixture suite exercises this parser only through one
 * valid PDF and one `/OpenAction` marker. Every fixture below is synthetic,
 * hand-constructed bytes — the same no-real-samples posture
 * `media-validator.test.ts` documents.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ActivePdfContentError, parsePdfMetadata } from './pdf-metadata-parser.js';

const directories: string[] = [];

async function writeFixture(text: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'verdery-pdf-parser-test-'));
  directories.push(directory);
  const path = join(directory, randomUUID());
  await writeFile(path, Buffer.from(text, 'latin1'), { mode: 0o600 });
  return path;
}

afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function pageObject(objectNumber: number): string {
  return `${String(objectNumber)} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`;
}

/** A structurally complete single-page PDF, the same envelope shape `media-validator.test.ts`'s own VALID_PDF uses. */
function validPdf(pageCount = 1, extraBodyObjects = ''): string {
  let pages = '';
  for (let index = 0; index < pageCount; index += 1) {
    pages += pageObject(3 + index);
  }
  return (
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    `2 0 obj\n<< /Type /Pages /Count ${String(pageCount)} >>\nendobj\n` +
    pages +
    extraBodyObjects +
    'xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n0\n%%EOF\n'
  );
}

describe('parsePdfMetadata parser-bomb ceilings and envelope checks', () => {
  it('accepts a structurally complete PDF within every ceiling, reporting its page count', async () => {
    const path = await writeFixture(validPdf(2));

    await expect(parsePdfMetadata(path, 100)).resolves.toEqual({ kind: 'pdf', pageCount: 2 });
  });

  it('rejects a page count above the ceiling — the 100-page parser-bomb limit, exercised through the parameter', async () => {
    // The ceiling is a parameter (the policy passes 100); proving the
    // comparison with maxPages=2 and a 3-page document is the identical
    // code path without a 101-page fixture.
    const path = await writeFixture(validPdf(3));

    await expect(parsePdfMetadata(path, 2)).rejects.toThrow(/page count/u);
  });

  it('rejects object cardinality above maxPages * 200 — the objects-per-page parser-bomb limit', async () => {
    // One page (passes the page ceiling at maxPages=1), then filler objects
    // pushing the total `N 0 obj` count past 1 * 200.
    let filler = '';
    for (let objectNumber = 10; objectNumber < 210; objectNumber += 1) {
      filler += `${String(objectNumber)} 0 obj\n<< /Length 0 >>\nendobj\n`;
    }
    const path = await writeFixture(validPdf(1, filler));

    await expect(parsePdfMetadata(path, 1)).rejects.toThrow(/object cardinality/u);
  });

  it('rejects a missing %%EOF trailer — an invalid envelope', async () => {
    const path = await writeFixture(validPdf(1).replace('%%EOF\n', ''));

    await expect(parsePdfMetadata(path, 100)).rejects.toThrow(/header or end-of-file/u);
  });

  it('rejects a document with no cross-reference table or stream', async () => {
    // Strip every `xref` occurrence (including `startxref`, whose substring
    // would otherwise satisfy the check) and any /Type /XRef stream marker.
    const noXref = validPdf(1)
      .replace('xref\n0 4\n0000000000 65535 f \n', '')
      .replace('startxref\n0\n', '');
    const path = await writeFixture(noXref);

    await expect(parsePdfMetadata(path, 100)).rejects.toThrow(/cross-reference/u);
  });

  it('rejects an encrypted document via its own dedicated /Encrypt branch, not the generic marker loop', async () => {
    const path = await writeFixture(
      validPdf(1).replace('trailer\n', 'trailer\n<< /Encrypt 5 0 R >>\n'),
    );

    const parse = parsePdfMetadata(path, 100);
    await expect(parse).rejects.toBeInstanceOf(ActivePdfContentError);
    await expect(parse).rejects.toMatchObject({ marker: '/Encrypt' });
  });
});
