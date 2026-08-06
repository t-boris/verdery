/**
 * The one adapter behind {@link PdfPageRasterizer}: poppler's `pdftoppm`,
 * installed in the worker image (`services/workers/Dockerfile`).
 *
 * WHY A NATIVE BINARY, AND WHY THIS ONE (owner decision, 2026-08-06): a plan
 * PDF has to become pixels somewhere, and the two candidates were poppler and
 * a `pdf.js` + canvas stack. Poppler renders in a SEPARATE PROCESS, which is
 * the property that matters most here: the input is a document a stranger
 * uploaded, and parsing it inside the worker's own process would put an
 * untrusted parser next to the worker's credentials. It is also about 30 MB
 * in the image against a heavier native canvas dependency, and decades older.
 *
 * Every run is bounded three ways — one page, a wall-clock timeout, and a
 * pixel ceiling — because an adversarial PDF's whole game is to be expensive.
 *
 * Source: architecture/external-integrations.md, section "3. Adapter
 * Contract"; architecture/media-storage-and-processing.md, section "9. Image
 * Derivatives"; docs/architecture/decisions/ADR-0017-pdf-plans-rendered-without-a-malware-scanner.md.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  PdfRasterizationError,
  type PdfPageRasterizer,
  type RasterizedPdfPage,
} from './pdf-page-rasterizer.js';

const execFileAsync = promisify(execFile);

/**
 * Long enough for a dense survey drawing on Cloud Run's slower CPU, short
 * enough that a hostile file cannot hold a worker.
 *
 * Was 30 seconds, and a real scanned plat hit it in production on 2026-08-06.
 * The render size came down at the same time (see the job's own
 * `PDF_RENDER_LONG_EDGE_PX`), which is the actual fix; this margin exists so
 * that a page slower than that one fails on its own merits rather than on a
 * budget tuned to a single measurement.
 */
const RENDER_TIMEOUT_MS = 60_000;

/** Refuses a render whose output would exceed this, whatever the page's own size claims. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** PNG signature, checked so a truncated or substituted output is caught rather than stored. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function readPngDimensions(png: Buffer): { readonly width: number; readonly height: number } {
  // IHDR is the first chunk of every PNG: width and height are big-endian
  // 32-bit integers at fixed offsets. Reading them here avoids decoding the
  // image twice, since the caller only needs to know what it received.
  if (png.length < 24 || !png.subarray(0, 4).equals(PNG_MAGIC)) {
    throw new PdfRasterizationError('the renderer did not produce a PNG');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export class PopplerPdfPageRasterizer implements PdfPageRasterizer {
  constructor(private readonly executablePath = 'pdftoppm') {}

  async rasterizePage(
    sourcePath: string,
    pageNumber: number,
    targetLongEdgePx: number,
  ): Promise<RasterizedPdfPage> {
    const directory = await mkdtemp(join(tmpdir(), 'verdery-pdf-'));
    const outputPrefix = join(directory, 'page');

    try {
      await execFileAsync(
        this.executablePath,
        [
          '-png',
          // One page, both ends of the range, so a thousand-page document
          // costs exactly as much as a one-page one.
          '-f',
          String(pageNumber),
          '-l',
          String(pageNumber),
          // Scales the longer edge, preserving the page's own aspect ratio.
          '-scale-to',
          String(targetLongEdgePx),
          sourcePath,
          outputPrefix,
        ],
        { timeout: RENDER_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      );

      const produced = (await readdir(directory)).filter((name) => name.endsWith('.png')).sort();
      const first = produced[0];
      if (first === undefined) {
        throw new PdfRasterizationError(`page ${String(pageNumber)} produced no image`);
      }

      const png = await readFile(join(directory, first));
      if (png.byteLength > MAX_OUTPUT_BYTES) {
        throw new PdfRasterizationError('the rendered page is larger than this stage accepts');
      }

      const { width, height } = readPngDimensions(png);
      return { png, widthPx: width, heightPx: height };
    } catch (error) {
      if (error instanceof PdfRasterizationError) {
        throw error;
      }
      // `execFile` reports a missing binary, a non-zero exit and a timeout
      // through the same rejection. All three mean the same thing to the
      // caller — this document did not become pixels — and the message keeps
      // the distinction for the log.
      throw new PdfRasterizationError(error instanceof Error ? error.message : String(error));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
