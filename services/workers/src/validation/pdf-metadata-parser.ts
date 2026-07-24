import { readFile } from 'node:fs/promises';
import type { ValidationMetadata } from './validation-result.js';

const ACTIVE_CONTENT_MARKERS = [
  '/JavaScript',
  '/JS',
  '/Launch',
  '/EmbeddedFile',
  '/OpenAction',
  '/RichMedia',
  '/XFA',
] as const;

export class ActivePdfContentError extends Error {
  constructor(readonly marker: string) {
    super(`PDF contains unsupported active content marker ${marker}.`);
    this.name = 'ActivePdfContentError';
  }
}

/**
 * Performs a deliberately non-rendering PDF safety pass. Rendering and page
 * previews belong to P6-WORKER-02; this pass rejects malformed envelopes,
 * encrypted files, active content, excessive pages, and suspicious object
 * cardinality without executing or decompressing document streams.
 */
export async function parsePdfMetadata(
  path: string,
  maxPages: number,
): Promise<ValidationMetadata> {
  const bytes = await readFile(path);
  const text = bytes.toString('latin1');

  if (!text.startsWith('%PDF-') || !text.slice(-2048).includes('%%EOF')) {
    throw new Error('PDF header or end-of-file marker is invalid.');
  }
  if (!text.includes('xref') && !/\/Type\s*\/XRef/u.test(text)) {
    throw new Error('PDF has no cross-reference table or stream.');
  }
  if (/\/Encrypt\b/u.test(text)) {
    throw new ActivePdfContentError('/Encrypt');
  }
  for (const marker of ACTIVE_CONTENT_MARKERS) {
    if (text.includes(marker)) {
      throw new ActivePdfContentError(marker);
    }
  }

  const pageCount = Array.from(text.matchAll(/\/Type\s*\/Page(?!s)\b/gu)).length;
  if (pageCount < 1 || pageCount > maxPages) {
    throw new Error(`PDF page count ${pageCount} is outside the accepted range.`);
  }

  const objectCount = Array.from(text.matchAll(/\b\d+\s+\d+\s+obj\b/gu)).length;
  if (objectCount > maxPages * 200) {
    throw new Error('PDF object cardinality exceeds the parser-bomb limit.');
  }

  return { kind: 'pdf', pageCount };
}
