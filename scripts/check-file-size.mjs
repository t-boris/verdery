#!/usr/bin/env node
/**
 * Enforces the repository rule that source code files stay at or below 600 lines.
 *
 * Documentation and other text-only files are exempt by rule, so only source
 * extensions are inspected. Generated output is exempt because it is never
 * hand-edited and is excluded from review.
 *
 * Source: AGENTS.md, "Keep source code files at or below 600 lines."
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_LINES = 600;

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.swift',
  '.py',
  '.tf',
]);

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.build',
  '.swiftpm',
  'DerivedData',
  'generated',
  '.dde',
]);

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/** Collects every source file below `directory`, skipping ignored directories. */
function collectSourceFiles(directory) {
  const found = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      found.push(...collectSourceFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      found.push(absolutePath);
    }
  }

  return found;
}

/** Counts lines the way a reviewer would: a trailing newline does not add a line. */
function countLines(absolutePath) {
  const contents = readFileSync(absolutePath, 'utf8');
  if (contents === '') {
    return 0;
  }
  const withoutTrailingNewline = contents.endsWith('\n') ? contents.slice(0, -1) : contents;
  return withoutTrailingNewline.split('\n').length;
}

/** True when the path contains a directory segment that is ignored. */
function isGeneratedPath(absolutePath) {
  return relative(repositoryRoot, absolutePath)
    .split(sep)
    .some((segment) => IGNORED_DIRECTORIES.has(segment));
}

function main() {
  const violations = [];

  for (const absolutePath of collectSourceFiles(repositoryRoot)) {
    if (isGeneratedPath(absolutePath)) {
      continue;
    }

    const lines = countLines(absolutePath);
    if (lines > MAX_LINES) {
      violations.push({ path: relative(repositoryRoot, absolutePath), lines });
    }
  }

  if (violations.length === 0) {
    process.stdout.write(`All source files are at or below ${MAX_LINES} lines.\n`);
    return;
  }

  violations.sort((left, right) => right.lines - left.lines);

  process.stderr.write(`Source files exceeding ${MAX_LINES} lines:\n`);
  for (const violation of violations) {
    process.stderr.write(`  ${violation.lines.toString().padStart(5)}  ${violation.path}\n`);
  }
  process.stderr.write('\nSplit these files before merging. See AGENTS.md.\n');
  process.exitCode = 1;
}

try {
  statSync(repositoryRoot);
} catch {
  process.stderr.write(`Repository root is not readable: ${repositoryRoot}\n`);
  process.exit(1);
}

main();
