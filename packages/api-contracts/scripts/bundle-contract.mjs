#!/usr/bin/env node
/**
 * Bundles the multi-file contract source tree under `openapi/` into the single
 * `openapi.yaml` document every consumer reads: `openapi-typescript`, the
 * contract tests, and the package's own `./openapi.yaml` export.
 *
 * The bundle is committed rather than built on demand because it is the file
 * three hundred source comments across this repository cite by name, and
 * because a contract that only exists after a build step cannot be read from a
 * pull request. `--check` re-bundles into a temporary file and compares, the
 * same drift guard `check-generated-is-current.mjs` applies to the generated
 * client — with the same reasoning: a hand edit to the bundle, or a tree change
 * that was never bundled, must block the merge rather than surface later as an
 * inexplicable mismatch.
 *
 * Source: architecture/api-design.md, section "3. Contract Ownership".
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourcePath = join(packageRoot, 'openapi', 'root.yaml');
const bundlePath = join(packageRoot, 'openapi.yaml');

const BANNER = [
  '# Bundled contract — generated, never edited by hand.',
  '#',
  '# Source of truth is the tree under `openapi/`: one file per path item, one',
  '# file per schema group, and `openapi/root.yaml` as their index. Edit there,',
  '# then run `pnpm --filter @verdery/api-contracts bundle`. CI fails when this',
  '# file and that tree disagree.',
  '#',
  '# Comments explaining a schema live beside the schema, in the tree — the',
  '# bundler cannot carry them across.',
  '',
].join('\n');

/** Bundles the tree into `outputPath` through the Redocly CLI the package already depends on. */
function bundle(outputPath) {
  execFileSync(
    'node',
    [
      join(packageRoot, 'node_modules', '@redocly', 'cli', 'bin', 'cli.js'),
      'bundle',
      sourcePath,
      '--output',
      outputPath,
    ],
    { stdio: 'pipe', cwd: packageRoot },
  );
  writeFileSync(outputPath, `${BANNER}${readFileSync(outputPath, 'utf8')}`, 'utf8');
}

const checking = process.argv.includes('--check');

if (!checking) {
  bundle(bundlePath);
  process.stdout.write('Bundled openapi/root.yaml into openapi.yaml.\n');
} else {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'verdery-bundle-'));
  const rebundledPath = join(workingDirectory, 'openapi.yaml');

  try {
    bundle(rebundledPath);

    if (readFileSync(bundlePath, 'utf8') === readFileSync(rebundledPath, 'utf8')) {
      process.stdout.write('Bundled contract matches its source tree.\n');
    } else {
      process.stderr.write(
        'Bundled contract is out of date.\n' +
          'Run `pnpm --filter @verdery/api-contracts bundle` and commit the result.\n',
      );
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`Could not verify the bundled contract: ${String(error)}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}
