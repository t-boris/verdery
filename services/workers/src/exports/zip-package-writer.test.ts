/**
 * `ZipPackageWriter` round-trip: the produced bytes must open with an
 * independent reader (`yauzl`), carry exactly the appended entries, and
 * report a checksum/size that describe the stored bytes exactly.
 */

import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readZipEntries } from './zip-reading.test-support.js';
import { ZipPackageWriter } from './zip-package-writer.js';

async function writePackage(
  entries: readonly { path: string; content: Buffer }[],
): Promise<{ zipContent: Buffer; byteSize: number; checksumSha256: string }> {
  const chunks: Buffer[] = [];
  const sink = new PassThrough();
  sink.on('data', (chunk: Buffer) => chunks.push(chunk));

  const writer = new ZipPackageWriter(sink);
  for (const entry of entries) {
    writer.addEntry(entry.path, entry.content);
  }
  const finalized = await writer.finalize();
  return { zipContent: Buffer.concat(chunks), ...finalized };
}

describe('ZipPackageWriter', () => {
  it('produces a ZIP an independent reader opens, with exactly the appended entries and their exact bytes', async () => {
    const readme = Buffer.from('# Verdery export\n', 'utf8');
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const { zipContent } = await writePackage([
      { path: 'README.md', content: readme },
      { path: 'media/g1/photo.jpg', content: photo },
    ]);

    const entries = await readZipEntries(zipContent);
    expect([...entries.keys()].sort()).toEqual(['README.md', 'media/g1/photo.jpg']);
    expect(entries.get('README.md')?.equals(readme)).toBe(true);
    expect(entries.get('media/g1/photo.jpg')?.equals(photo)).toBe(true);
  });

  it('reports the byte size and SHA-256 of exactly the stored bytes', async () => {
    const { zipContent, byteSize, checksumSha256 } = await writePackage([
      { path: 'export.json', content: Buffer.from('{}\n', 'utf8') },
    ]);

    expect(byteSize).toBe(zipContent.length);
    expect(checksumSha256).toBe(createHash('sha256').update(zipContent).digest('hex'));
  });

  it('propagates a sink failure from finalize instead of resolving with figures for bytes that were never stored', async () => {
    const sink = new PassThrough();
    const writer = new ZipPackageWriter(sink);
    writer.addEntry('export.json', Buffer.from('{}\n', 'utf8'));
    sink.once('data', () => sink.destroy(new Error('stream lost')));

    await expect(writer.finalize()).rejects.toThrow('stream lost');
  });
});
