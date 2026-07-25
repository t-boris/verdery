/**
 * Test-only ZIP reading over `yauzl` (a devDependency — this file is
 * excluded from the production build by `tsconfig.build.json`'s
 * `*.test-support.ts` pattern, the reason it is not a `*-test-doubles.ts`
 * file like the dependency-free fakes). `yauzl` is the boring, maintained
 * ZIP READER counterpart to `archiver`'s writer role: the tests must prove
 * the produced package opens with an implementation the writer does not
 * share code with, not merely that the writer can read itself.
 */

import { Buffer } from 'node:buffer';
import yauzl from 'yauzl';

/** Every entry of a ZIP buffer, path -> content. Rejects on any structural corruption — a test failure, never a skip. */
export async function readZipEntries(zipContent: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipContent, { lazyEntries: true }, (openError, zipFile) => {
      if (openError !== null && openError !== undefined) {
        reject(openError);
        return;
      }

      const entries = new Map<string, Buffer>();
      zipFile.on('error', reject);
      zipFile.on('end', () => {
        resolve(entries);
      });
      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) {
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError !== null && streamError !== undefined) {
            reject(streamError);
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    });
  });
}
