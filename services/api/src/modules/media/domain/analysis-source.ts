/**
 * Which stored object to hand a vision provider.
 *
 * An original photograph is whatever the camera produced — a modern phone
 * writes 10–30 MB, and providers refuse above their own limit. The pipeline
 * already generates smaller display derivatives from every image; when one
 * exists it is both cheaper to read and more likely to be accepted, and it
 * shows the same plant.
 *
 * The derivative is not always there: it is generated asynchronously. When
 * neither the original nor a derivative fits the provider transport, this
 * returns `null` so the caller can report a retryable "analysis source is
 * still being prepared" outcome. An oversized original is never silently
 * sent and never converted into an unidentified plant.
 *
 * Source: architecture/media-storage-and-processing.md, section
 * "6. Derivatives"; architecture/external-integrations.md, section
 * "3. Adapter Contract".
 */

/** The subset of a media record this choice needs. `MediaRecord` is assignable. */
export interface AnalysisSourceCandidate {
  readonly bucketName: string | null;
  readonly objectKey: string | null;
  readonly declaredContentType: string;
  readonly verifiedContentType: string | null;
  readonly declaredByteSize: number;
  readonly verifiedByteSize: number | null;
}

export interface AnalysisSource {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

function toSource(candidate: AnalysisSourceCandidate): AnalysisSource | null {
  if (candidate.bucketName === null || candidate.objectKey === null) {
    return null;
  }

  return {
    bucketName: candidate.bucketName,
    objectKey: candidate.objectKey,
    mimeType: candidate.verifiedContentType ?? candidate.declaredContentType,
    byteSize: candidate.verifiedByteSize ?? candidate.declaredByteSize,
  };
}

/**
 * The best object to analyse: the LARGEST one that fits under `maximumBytes`,
 * because detail is what a species guess depends on, and the original when
 * nothing fits.
 *
 * Returns `null` when no stored source fits. The original remains preserved
 * at full quality; this selection affects only the temporary AI input.
 */
export function pickAnalysisSource(
  original: AnalysisSourceCandidate,
  derivatives: readonly AnalysisSourceCandidate[],
  maximumBytes: number,
): AnalysisSource | null {
  const originalSource = toSource(original);

  if (originalSource === null) {
    return null;
  }

  const fitting = [originalSource, ...derivatives.map(toSource)]
    .filter((source): source is AnalysisSource => source !== null)
    .filter((source) => source.byteSize <= maximumBytes)
    .sort((left, right) => right.byteSize - left.byteSize);

  return fitting[0] ?? null;
}
