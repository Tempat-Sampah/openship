import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from "fs";
import { dirname, basename, join } from "path";
import { hostname } from "os";

/**
 * Single-instance lock for a PGlite data directory.
 *
 * PGlite is single-process embedded Postgres with NO real cross-process lock —
 * it writes a `-42` sentinel into `postmaster.pid` that identifies no process.
 * Two processes opening the same data dir corrupt the WASM cluster
 * (`RuntimeError: Aborted()`), which is unrecoverable. This lock provides the
 * exclusion PGlite lacks:
 *
 *   - acquisition is atomic (`open(..., "wx")` / O_EXCL) so exactly one process
 *     can ever hold the dir — no concurrent-open corruption is possible;
 *   - it self-heals a crashed previous run (dead pid → reclaim) so a SIGKILL
 *     never wedges the dir shut;
 *   - it only ever creates/removes its own `<dir>.lock` file (a sibling of the
 *     data dir) and never reads, writes, moves, or deletes cluster data — so it
 *     can never lose data.
 */

/**
 * Lock file path — a SIBLING of the data dir, never inside it. PGlite's initdb
 * refuses a non-empty directory when bootstrapping a fresh cluster, so a lock
 * file placed inside the data dir would break every first-time install. Keeping
 * it beside the dir (`<dir>.lock`) leaves the cluster directory pristine.
 */
function lockPathFor(dataDir: string): string {
  return join(dirname(dataDir), `${basename(dataDir)}.lock`);
}

interface LockRecord {
  pid: number;
  startedAt: number;
  host: string;
}

// Path of the lock this process currently holds (null when unheld). Module-
// scoped so the exit hook and releasePgliteLock can find it without threading
// state through every caller.
let heldLockPath: string | null = null;
let exitHookRegistered = false;

export interface AcquireLockOptions {
  /** Max time to wait for a live holder to release before failing (ms). */
  waitMs?: number;
  /** Poll interval while waiting (ms). */
  pollMs?: number;
}

function readLock(lockPath: string): LockRecord | "unreadable" {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<LockRecord>;
    if (
      typeof parsed.pid === "number" &&
      Number.isFinite(parsed.pid) &&
      typeof parsed.host === "string"
    ) {
      return {
        pid: parsed.pid,
        startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
        host: parsed.host,
      };
    }
    return "unreadable";
  } catch {
    return "unreadable";
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 = liveness probe; sends nothing
    return true;
  } catch (err) {
    // ESRCH = no such process (dead). EPERM = exists but not ours (alive).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function tryRemove(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    /* already gone, or a racing peer removed it — either way, fine */
  }
}

function claim(lockPath: string): void {
  // O_EXCL: create-or-fail atomically. The kernel guarantees exactly one caller
  // wins even under a concurrent race — this is the exclusion primitive.
  const fd = openSync(lockPath, "wx");
  try {
    const record: LockRecord = { pid: process.pid, startedAt: Date.now(), host: hostname() };
    writeSync(fd, JSON.stringify(record));
  } finally {
    closeSync(fd);
  }
  heldLockPath = lockPath;
  registerExitHook();
}

function registerExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  // Best-effort synchronous release on normal exit / process.exit(). Crash and
  // SIGKILL can't run this — those are covered by stale-pid reclamation on the
  // next boot.
  process.once("exit", () => releasePgliteLock());
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Acquire exclusive access to `dataDir`, waiting up to `waitMs` for a live
 * holder to release. Throws with an actionable message if a live instance
 * still holds it after the wait, or if the lock belongs to another host.
 */
export async function acquirePgliteLock(
  dataDir: string,
  { waitMs = 5000, pollMs = 100 }: AcquireLockOptions = {},
): Promise<void> {
  const lockPath = lockPathFor(dataDir);
  const deadline = Date.now() + Math.max(0, waitMs);

  for (;;) {
    try {
      claim(lockPath);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    // A lock file exists — classify it: stale (reclaim) or live (wait/fail).
    const holder = readLock(lockPath);

    if (holder === "unreadable") {
      tryRemove(lockPath);
      continue;
    }

    if (holder.host !== hostname()) {
      throw new Error(
        `The Openship database at ${dataDir} is locked by a process on a different host ` +
          `(${holder.host}, pid ${holder.pid}). PGlite data directories cannot be shared ` +
          `across machines. If that host no longer uses it, remove the lock file: ${lockPath}`,
      );
    }

    if (!isProcessAlive(holder.pid)) {
      // Previous holder crashed without releasing — safe to reclaim.
      tryRemove(lockPath);
      continue;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Another Openship instance is already using the database at ${dataDir} ` +
          `(pid ${holder.pid}). PGlite allows only one process per data directory; opening a ` +
          `second would corrupt it. Stop the other instance (e.g. quit the desktop app) and ` +
          `retry. If you are certain no Openship process is running, remove: ${lockPath}`,
      );
    }

    await sleep(pollMs);
  }
}

/**
 * Release the lock held by this process. No-op if we hold nothing, and refuses
 * to delete a lock that another process has taken over (owner check).
 */
export function releasePgliteLock(): void {
  if (!heldLockPath) return;
  const lockPath = heldLockPath;
  heldLockPath = null;
  const holder = readLock(lockPath);
  if (holder !== "unreadable" && holder.pid === process.pid && holder.host === hostname()) {
    tryRemove(lockPath);
  }
}
