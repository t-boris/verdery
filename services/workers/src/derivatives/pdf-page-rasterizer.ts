/**
 * Turning the first page of an imported plan into pixels.
 *
 * A surveyor's plat arrives as a PDF, and everything downstream of this point
 * works in rasters: the screen preview, the tile pyramid, the calibration
 * overlay a person drags onto two known distances. Without a rasteriser a PDF
 * plan uploads, validates, and then sits with nothing to show and nothing to
 * calibrate against — which is exactly what a real plat did on 2026-08-06.
 *
 * A port with one adapter, the shape this codebase uses for every external
 * capability (architecture/external-integrations.md, section "3. Adapter
 * Contract"): the job below knows it can ask for a page as PNG bytes, and
 * nothing more about how that happens.
 *
 * Source: architecture/media-storage-and-processing.md, section "9. Image
 * Derivatives".
 */

export interface RasterizedPdfPage {
  readonly png: Buffer;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface PdfPageRasterizer {
  /**
   * Renders `pageNumber` (1-based) of the PDF at `sourcePath` to PNG bytes,
   * at approximately `targetLongEdgePx` on its longer side.
   *
   * Rejects with {@link PdfRasterizationError} for anything the renderer
   * refuses — a page that is not there, a document it cannot parse, a run
   * that exceeds its own time limit.
   */
  rasterizePage(
    sourcePath: string,
    pageNumber: number,
    targetLongEdgePx: number,
  ): Promise<RasterizedPdfPage>;
}

/**
 * The renderer refused the document. Terminal, never retryable: the same
 * bytes will be refused the same way tomorrow, and a plan that cannot be
 * rendered should tell its owner so rather than occupying a queue for ever —
 * which is what the never-selected malware scanner used to do to every PDF.
 */
export class PdfRasterizationError extends Error {
  constructor(reason: string) {
    super(`The PDF page could not be rendered: ${reason}`);
    this.name = 'PdfRasterizationError';
  }
}
