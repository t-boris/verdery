/**
 * Runs the REAL `pdftoppm` against real PDFs.
 *
 * The binary ships in this service's own image, so a test that faked it would
 * prove nothing about the thing that actually runs. Where poppler is absent —
 * a developer machine without it — the suite says so and skips, the same
 * posture `tests/support/docker.ts` takes for testcontainers, rather than
 * passing on a fake and reporting coverage it does not have.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PdfRasterizationError } from './pdf-page-rasterizer.js';
import { PopplerPdfPageRasterizer } from './poppler-pdf-page-rasterizer.js';

const execFileAsync = promisify(execFile);

/** A one-page PDF drawing a filled rectangle: enough for poppler to render real pixels. */
const ONE_PAGE_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n' +
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n' +
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>endobj\n' +
    '4 0 obj<< /Length 44 >>stream\n0 0 1 rg 20 20 160 60 re f\nendstream\nendobj\n' +
    'trailer<< /Root 1 0 R /Size 5 >>\n%%EOF\n',
  'latin1',
);

async function popplerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('pdftoppm', ['-v']);
    return true;
  } catch {
    return false;
  }
}

/** Resolved once, at module load, because `describe.runIf` needs the answer before any hook runs. */
const POPPLER_AVAILABLE = await popplerAvailable();
if (!POPPLER_AVAILABLE) {
  console.warn('Skipping the poppler rasterizer suite: `pdftoppm` is not on this PATH.');
}

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'verdery-pdf-test-'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function write(name: string, bytes: Buffer): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

describe.runIf(POPPLER_AVAILABLE)('PopplerPdfPageRasterizer', () => {
  it('renders the first page as a PNG at the requested long edge', async () => {
    const path = await write('one-page.pdf', ONE_PAGE_PDF);

    const page = await new PopplerPdfPageRasterizer().rasterizePage(path, 1, 400);

    // A 200x100 page scaled to a 400px long edge: the aspect ratio is the
    // page's own, which is what makes a calibrated plan measure correctly.
    expect(page.widthPx).toBe(400);
    expect(page.heightPx).toBe(200);
    expect(page.png.subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  it('refuses a page the document does not have, terminally', async () => {
    const path = await write('single.pdf', ONE_PAGE_PDF);

    await expect(new PopplerPdfPageRasterizer().rasterizePage(path, 7, 400)).rejects.toBeInstanceOf(
      PdfRasterizationError,
    );
  });

  it('refuses bytes that are not a PDF at all, rather than hanging', async () => {
    const path = await write('not-a.pdf', Buffer.from('this is not a PDF', 'utf8'));

    await expect(new PopplerPdfPageRasterizer().rasterizePage(path, 1, 400)).rejects.toBeInstanceOf(
      PdfRasterizationError,
    );
  });

  // The deployed image installs poppler; a machine without it must fail
  // loudly and terminally, never silently produce nothing.
  it('reports a missing renderer as a rasterization failure', async () => {
    const path = await write('one-page-again.pdf', ONE_PAGE_PDF);

    await expect(
      new PopplerPdfPageRasterizer('pdftoppm-that-does-not-exist').rasterizePage(path, 1, 400),
    ).rejects.toBeInstanceOf(PdfRasterizationError);
  });
});
