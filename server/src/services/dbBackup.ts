import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';
import { getStorageRoot } from './storage.js';

// ── Types ────────────────────────────────────────────────────────

export interface BackupMeta {
  filename: string;
  size: number;
  createdAt: string; // ISO
  compressed: boolean;
  type: 'backup' | 'pre-restore';
}

interface DbConn {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Filename must be plain (letters/digits/dot/dash/underscore) and end with .sql / .sql.gz */
const SAFE_NAME = /^[a-zA-Z0-9._-]+\.sql(\.gz)?$/;

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Parse DATABASE_URL (mysql://user:pass@host:port/db) into connection parts. */
function parseDatabaseUrl(): DbConn {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not configured');
  const url = new URL(raw);
  return {
    host: url.hostname || 'localhost',
    port: url.port || '3306',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\/+/, ''),
  };
}

export function getBackupsRoot(): string {
  return path.join(getStorageRoot(), 'db-backups');
}

export function ensureBackupsDir(): string {
  const root = getBackupsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Resolve a user-supplied filename to an absolute path inside the backups dir, rejecting traversal. */
export function resolveSafePath(filename: string): string {
  if (!SAFE_NAME.test(filename)) throw new Error('invalid filename');
  const root = ensureBackupsDir();
  const resolved = path.resolve(root, filename);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('invalid filename');
  return resolved;
}

function buildMysqlArgs(db: DbConn, withDb: boolean): string[] {
  const args = ['-h', db.host, '-P', db.port, '-u', db.user];
  if (db.password) args.push(`-p${db.password}`);
  args.push('--default-character-set=utf8mb4');
  if (withDb) args.push(db.database);
  return args;
}

function handleSpawnError(err: any, tool: string): Error {
  if (err?.code === 'ENOENT') {
    return new Error(`${tool} 未找到,请确认 MySQL 客户端已安装且在系统 PATH 中`);
  }
  return err;
}

// ── Public API ───────────────────────────────────────────────────

/** List all backup files, newest first. */
export function listBackups(): BackupMeta[] {
  const root = ensureBackupsDir();
  let files: string[];
  try {
    files = fs.readdirSync(root);
  } catch (e) {
    if ((e as any).code === 'ENOENT') return [];
    throw e;
  }
  const result: BackupMeta[] = [];
  for (const name of files) {
    if (!SAFE_NAME.test(name)) continue;
    const full = path.join(root, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    result.push({
      filename: name,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
      compressed: name.endsWith('.gz'),
      type: name.startsWith('pre-restore-') ? 'pre-restore' : 'backup',
    });
  }
  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return result;
}

/** Create a new backup. compress=true (default) writes .sql.gz, else .sql. */
export async function createBackup(opts: { compress?: boolean; tag?: string } = {}): Promise<BackupMeta> {
  const { compress = true, tag } = opts;
  const db = parseDatabaseUrl();
  const root = ensureBackupsDir();
  const ts = formatTimestamp(new Date());
  const prefix = tag ? `${tag}-` : 'backup-';
  const ext = compress ? '.sql.gz' : '.sql';
  const filename = `${prefix}${ts}${ext}`;
  const filePath = path.join(root, filename);

  const args = [...buildMysqlArgs(db, false), '--single-transaction', '--routines', '--triggers', '--events', db.database];
  const dump = spawn('mysqldump', args, { env: process.env });
  const out = fs.createWriteStream(filePath);

  let stderr = '';
  dump.stderr.on('data', (d) => { stderr += d.toString(); });

  const gzip = compress ? zlib.createGzip() : undefined;
  const streams: any[] = [dump.stdout];
  if (gzip) streams.push(gzip);
  streams.push(out);

  // Wait for the pipeline (data fully written) and the dump process to exit.
  await Promise.all([
    pipeline(streams).catch((err) => {
      fs.rmSync(filePath, { force: true });
      throw handleSpawnError(err, 'mysqldump');
    }),
    new Promise<void>((resolve, reject) => {
      dump.on('error', (err) => { fs.rmSync(filePath, { force: true }); reject(handleSpawnError(err, 'mysqldump')); });
      dump.on('close', (code) => {
        if (code !== 0) {
          fs.rmSync(filePath, { force: true });
          reject(new Error(`mysqldump 退出码 ${code}${stderr ? `: ${stderr}` : ''}`));
        } else {
          resolve();
        }
      });
    }),
  ]);

  const stat = fs.statSync(filePath);
  return {
    filename,
    size: stat.size,
    createdAt: stat.mtime.toISOString(),
    compressed: compress,
    type: tag ? 'pre-restore' : 'backup',
  };
}

/** Restore from a backup file. Automatically backs up current data first (pre-restore-*.sql.gz). */
export async function restoreBackup(filename: string): Promise<{ preRestoreFile: string }> {
  const filePath = resolveSafePath(filename);
  if (!fs.existsSync(filePath)) throw new Error('备份文件不存在');

  // Safety net: snapshot current DB before overwriting.
  const preRestore = await createBackup({ compress: true, tag: 'pre-restore' });

  const db = parseDatabaseUrl();
  const args = buildMysqlArgs(db, true);
  const mysql = spawn('mysql', args, { env: process.env });
  const readStream = fs.createReadStream(filePath);
  const isGz = filename.endsWith('.gz');
  const gunzip = isGz ? zlib.createGunzip() : undefined;

  let stderr = '';
  mysql.stderr.on('data', (d) => { stderr += d.toString(); });

  const source: any = gunzip ? readStream.pipe(gunzip) : readStream;

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      mysql.on('error', (err) => reject(handleSpawnError(err, 'mysql')));
      mysql.on('close', (code) => {
        if (code !== 0) reject(new Error(`mysql 还原退出码 ${code}${stderr ? `: ${stderr}` : ''}`));
        else resolve();
      });
    }),
    pipeline(source, mysql.stdin).catch((err) => { throw handleSpawnError(err, 'mysql'); }),
  ]);

  return { preRestoreFile: preRestore.filename };
}

/** Delete a backup file. Idempotent: missing file does not throw. */
export function deleteBackup(filename: string): void {
  const filePath = resolveSafePath(filename);
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    if ((e as any).code !== 'ENOENT') throw e;
  }
}
