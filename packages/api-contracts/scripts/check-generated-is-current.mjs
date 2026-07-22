#!/usr/bin/env node
/**
 * Fails when the committed generated client no longer matches the OpenAPI
 * document.
 *
 * Generated files are never edited by hand, so drift means someone changed the
 * contract without regenerating, or edited the generated file directly. Both
 * must block the merge.
 *
 * Source: architecture/api-design.md, section "3. Contract Ownership".
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const contractPath = join(packageRoot, 'openapi.yaml');
const committedPath = join(packageRoot, 'src', 'generated', 'schema.ts');

const workingDirectory = mkdtempSync(join(tmpdir(), 'verdery-contract-'));
const regeneratedPath = join(workingDirectory, 'schema.ts');

try {
  execFileSync(
    'node',
    [
      join(packageRoot, 'node_modules', 'openapi-typescript', 'bin', 'cli.js'),
      contractPath,
      '--output',
      regeneratedPath,
    ],
    { stdio: 'pipe' },
  );

  const committed = readFileSync(committedPath, 'utf8');
  const regenerated = readFileSync(regeneratedPath, 'utf8');

  if (committed === regenerated) {
    process.stdout.write('Generated client matches the OpenAPI document.\n');
  } else {
    process.stderr.write(
      'Generated client is out of date.\n' +
        'Run `pnpm --filter @verdery/api-contracts generate` and commit the result.\n',
    );
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`Could not verify the generated client: ${String(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(workingDirectory, { recursive: true, force: true });
}
