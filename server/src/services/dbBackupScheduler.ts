/**
 * Automatic DB backup scheduler.
 *
 * Two mechanisms:
 *   1. Periodic — every N hours (configurable via AppSetting `autoBackupIntervalHours`)
 *   2. Change-triggered — Assignment/Annotation/Mistake writes debounced by 5 min
 *
 * Both are fire-and-forget; errors only log, never block requests.
 */
import fs from 'fs';
import path from 'path';
import { listBackups, createBackup, resolveConnection } from './dbBackup.js';
import { getStorageRoot } from './storage.js';
import { setWriteListener } from '../prisma.js';
import prisma from '../prisma.js';

// ── Config (can be overridden via AppSetting key) ────────────────

const PERIODIC_ENABLED_KEY = 'autoBackupEnabled';
const PERIODIC_INTERVAL_KEY = 'autoBackupIntervalHours';
const KEEP_PERIODIC = 7;    // keep last N periodic backups
const KEEP_CHANGE = 20;     // keep last N change-triggered backups
const CHANGE_DEBOUNCE_MS = 5 * 60 * 1000; // 5 min debounce

// ── Runtime state ────────────────────────────────────────────────

let periodicTimer: NodeJS.Timeout | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let startupDone = false;

// ── Public API ───────────────────────────────────────────────────

/** Register Prisma write listener + start periodic timer. Idempotent. */
export async function startBackupScheduler(): Promise<void> {
  if (startupDone) return;
  startupDone = true;

  // 1. Hook into Prisma $extends (registered in prisma.ts)
  setWriteListener(() => scheduleChangeBackup());

  // 2. Start periodic timer
  await restartPeriodicTimer();

  // 3. Pre-create a backup if none recent (gap > 6h)
  try {
    const backups = listBackups();
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    const latestPeriodic = backups.find((b) => b.filename.startsWith('backup-auto-'));
    if (!latestPeriodic || new Date(latestPeriodic.createdAt).getTime() < sixHoursAgo) {
      console.log('[auto-backup] no recent periodic backup, creating one now');
      fireBackup('auto');
    }
  } catch (e) {
    console.warn('[auto-backup] startup pre-backup check failed:', e);
  }

  console.log('[auto-backup] scheduler started');
}

/** Stop everything (for graceful shutdown). */
export function stopBackupScheduler(): void {
  if (periodicTimer) { clearInterval(periodicTimer); periodicTimer = null; }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  startupDone = false;
}

/** Debounced trigger — called by Prisma write hooks. */
export function scheduleChangeBackup(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    fireBackup('change');
  }, CHANGE_DEBOUNCE_MS);
}

/** Re-read AppSetting and restart periodic timer (after user changes config). */
export async function restartPeriodicTimer(): Promise<void> {
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = null;

  const enabled = await getBoolSetting(PERIODIC_ENABLED_KEY, true);
  if (!enabled) return;

  const intervalHours = Math.max(1, await getIntSetting(PERIODIC_INTERVAL_KEY, 6));
  const intervalMs = intervalHours * 60 * 60 * 1000;

  periodicTimer = setInterval(() => fireBackup('auto'), intervalMs);
  console.log(`[auto-backup] periodic timer: every ${intervalHours}h`);
}

// ── Helpers ──────────────────────────────────────────────────────

async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  try {
    const s = await prisma.appSetting.findUnique({ where: { key } });
    if (!s?.value) return fallback;
    return s.value === 'true' || s.value === '1';
  } catch { return fallback; }
}

async function getIntSetting(key: string, fallback: number): Promise<number> {
  try {
    const s = await prisma.appSetting.findUnique({ where: { key } });
    const n = s?.value ? parseInt(s.value, 10) : NaN;
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

/** Fire a backup — completely detached, errors only log. */
async function fireBackup(kind: 'auto' | 'change'): Promise<void> {
  try {
    const conn = await resolveConnection(null);
    const tag = kind === 'change' ? 'change' : 'auto';
    const meta = await createBackup({ compress: true, tag, connection: conn });
    console.log(`[auto-backup] ✓ ${kind} backup: ${meta.filename} (${(meta.size / 1024 / 1024).toFixed(2)} MB)`);
    cleanupOldBackups();
  } catch (e: any) {
    console.error(`[auto-backup] ✗ ${kind} backup failed:`, e?.message || e);
  }
}

/** Keep the last N periodic + last N change backups; delete the rest. */
function cleanupOldBackups(): void {
  try {
    const backups = listBackups();
    const periodic = backups.filter((b) => b.filename.startsWith('backup-auto-'));
    const change = backups.filter((b) => b.filename.startsWith('backup-change-'));

    const dropPeriodic = periodic.slice(KEEP_PERIODIC);
    const dropChange = change.slice(KEEP_CHANGE);
    const drop = [...dropPeriodic, ...dropChange];

    if (drop.length === 0) return;

    const root = path.join(getStorageRoot(), 'db-backups');
    for (const b of drop) {
      try {
        fs.unlinkSync(path.join(root, b.filename));
        console.log(`[auto-backup] cleaned up old: ${b.filename}`);
      } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn('[auto-backup] cleanup failed:', e);
  }
}
