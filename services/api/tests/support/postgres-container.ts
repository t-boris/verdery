/**
 * Shared PostgreSQL/PostGIS test-container startup for every
 * container-backed suite (P7-QA-01).
 *
 * WHY THIS EXISTS — the root cause of the recurring harness flake: this
 * package holds ~64 Docker-backed suites, and vitest's default fork pool
 * starts one file per available CPU (24 on the reference machine), so a
 * full run began with ~20 SIMULTANEOUS `postgis/postgis` container
 * starts — each an emulated linux/amd64 `initdb` on an arm64 host. The
 * saturated Docker daemon then missed Testcontainers' NON-CONFIGURABLE
 * 10-second port-binding inspection deadline
 * (`inspectContainerUntilPortsExposed`, hardcoded in testcontainers
 * 12.x), failing healthy suites with "Timed out after 10000ms while
 * waiting for container ports to be bound" — observed live in this
 * package's own baseline measurement and previously recorded by the
 * P7-AI-01/P7-NOTIF-02 stage notes. The same saturation is what made
 * `docker info` probes overrun and produced teardown-time connection
 * terminations (`57P01`) when the stressed daemon or reaper closed
 * backends early.
 *
 * THE FIX, deliberately narrow: a cross-process semaphore bounds how many
 * container STARTUPS may be in flight at once, machine-wide. Only the
 * startup burst is serialized — once a container is running, its suite
 * proceeds fully parallel, every suite keeps its OWN container, and no
 * isolation semantics change (same image, same platform, same
 * one-database-per-suite lifecycle). A single startup retry absorbs the
 * residual case where the daemon still misses the fixed 10-second
 * inspection deadline; the wait-strategy budget (which IS configurable)
 * is raised so a slow emulated boot is distinguished from a dead one.
 *
 * The slot directory lives in the machine's shared temp directory so the
 * bound holds across vitest's separate fork processes (and across
 * concurrently running packages). Crashed holders are reclaimed by
 * pid-liveness and age, so an interrupted run cannot starve later ones.
 *
 * Source: architecture/testing-strategy.md, section "6. Backend
 * Integration Tests".
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/** The one supported server image — real PostgreSQL/PostGIS, the testing-strategy mandate. */
export const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
/** The image publishes no arm64 variant; Docker Desktop emulates amd64 on Apple silicon. */
export const POSTGIS_PLATFORM = 'linux/amd64';

/**
 * Concurrent container startups allowed machine-wide. Empirical: 24
 * simultaneous emulated `initdb` runs miss the fixed 10-second inspection
 * deadline; 8 keeps the daemon responsive while the startup queue drains
 * far faster than the suites behind it run.
 */
const STARTUP_SLOTS = 8;
const SLOT_DIRECTORY = join(tmpdir(), 'verdery-testcontainer-startup-slots');
/** A held slot older than this belongs to a crashed or wedged run and is reclaimed. */
const SLOT_STALE_AFTER_MS = 180_000;
const SLOT_POLL_INTERVAL_MS = 250;
/** Wait-strategy budget for the emulated boot — the configurable half of startup time. */
const STARTUP_TIMEOUT_MS = 120_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Reclaims `slotPath` when its holder is provably gone or the claim has gone stale. */
function reclaimIfAbandoned(slotPath: string): void {
  let holder: { pid: number; claimedAt: number };
  try {
    holder = JSON.parse(readFileSync(slotPath, 'utf8')) as { pid: number; claimedAt: number };
  } catch {
    // Unreadable or mid-write: only age can judge it; retry next poll.
    return;
  }
  const stale = Date.now() - holder.claimedAt > SLOT_STALE_AFTER_MS;
  if (stale || !isProcessAlive(holder.pid)) {
    rmSync(slotPath, { force: true });
  }
}

/** Acquires one startup slot, polling until one frees; returns its release function. */
async function acquireStartupSlot(): Promise<() => void> {
  mkdirSync(SLOT_DIRECTORY, { recursive: true });
  for (;;) {
    for (let slot = 0; slot < STARTUP_SLOTS; slot += 1) {
      const slotPath = join(SLOT_DIRECTORY, `slot-${String(slot)}`);
      try {
        writeFileSync(slotPath, JSON.stringify({ pid: process.pid, claimedAt: Date.now() }), {
          flag: 'wx',
        });
        return () => rmSync(slotPath, { force: true });
      } catch {
        reclaimIfAbandoned(slotPath);
      }
    }
    await sleep(SLOT_POLL_INTERVAL_MS);
  }
}

/** True for the one non-configurable Testcontainers deadline this helper retries. */
function isPortBindingInspectionTimeout(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes('waiting for container ports to be bound')
  );
}

/**
 * Starts one dedicated PostgreSQL/PostGIS container under the machine-wide
 * startup bound. Every suite still owns its container exclusively; only
 * the moment of starting is coordinated.
 */
export async function startPostgresTestContainer(): Promise<StartedPostgreSqlContainer> {
  const release = await acquireStartupSlot();
  try {
    try {
      return await newContainer().start();
    } catch (error) {
      if (!isPortBindingInspectionTimeout(error)) {
        throw error;
      }
      // The daemon missed the fixed 10s inspection deadline once; the
      // abandoned container is reaped by Testcontainers' own Ryuk. One
      // retry under the still-held slot absorbs the transient.
      await sleep(1_000);
      return await newContainer().start();
    }
  } finally {
    release();
  }
}

function newContainer(): PostgreSqlContainer {
  return new PostgreSqlContainer(POSTGIS_IMAGE)
    .withPlatform(POSTGIS_PLATFORM)
    .withStartupTimeout(STARTUP_TIMEOUT_MS);
}
