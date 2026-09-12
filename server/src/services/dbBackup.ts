import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';
import { getStorageRoot } from './storage.js';
import prisma from '../prisma.js';

// ── Types ────────────────────────────────────────────────────────

export interface DbConnection {
  id: string;
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export interface ConnectionConfig {
  connections: DbConnection[];
  defaultConnectionId: string | null;
}

export interface BackupMeta {
  filename: string;
  size: number;
  createdAt: string; // ISO
  compressed: boolean;
  type: 'backup' | 'pre-restore';
  connectionName?: string; // for display
}

// ── CLI path auto-detection ──────────────────────────────────────
//
// Resolution order:
// 1. MYSQL_BIN_DIR env var (Windows or manual override)
// 2. Tool found in system PATH (which/where)
// 3. macOS brew mysql-client prefix: /opt/homebrew/opt/mysql-client/bin or /usr/local/opt/mysql-client/bin
// 4. Common Windows install dirs
// 5. Fall back to bare name (let spawn fail with ENOENT for clearer error)

let cliPathCache: { mysqldump: string; mysql: string } | null = null;

function findInPath(tool: string): string | null {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const name = tool + ext;
  const paths = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  for (const p of paths) {
    if (!p) continue;
    const candidate = path.join(p, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch { /* ignore */ }
  }
  return null;
}

function resolveMysqlCommand(tool: 'mysqldump' | 'mysql'): string {
  if (cliPathCache) return tool === 'mysqldump' ? cliPathCache.mysqldump : cliPathCache.mysql;

  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates: string[] = [];

  // 1. MYSQL_BIN_DIR
  const binDir = process.env.MYSQL_BIN_DIR;
  if (binDir) candidates.push(path.join(binDir, tool + ext));

  // 2. PATH
  const inPath = findInPath(tool);
  if (inPath) candidates.push(inPath);

  // 3. macOS brew mysql-client (Apple Silicon then Intel)
  if (process.platform === 'darwin') {
    candidates.push(`/opt/homebrew/opt/mysql-client/bin/${tool}`);
    candidates.push(`/usr/local/opt/mysql-client/bin/${tool}`);
  }

  // 4. Windows common install dirs
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    candidates.push(path.join(programFiles, 'MySQL', 'MySQL Server 8.0', 'bin', tool + ext));
    candidates.push(path.join(programFiles, 'MySQL', 'MySQL Server 5.7', 'bin', tool + ext));
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        if (!cliPathCache) cliPathCache = { mysqldump: '', mysql: '' };
        if (tool === 'mysqldump') cliPathCache.mysqldump = c;
        else cliPathCache.mysql = c;
        return c;
      }
    } catch { /* ignore */ }
  }

  // 5. Fall back to bare name (will fail with ENOENT, error handler gives hint)
  if (!cliPathCache) cliPathCache = { mysqldump: '', mysql: '' };
  if (tool === 'mysqldump') cliPathCache.mysqldump = tool;
  else cliPathCache.mysql = tool;
  return tool;
}

function handleSpawnError(err: any, tool: string): Error {
  if (err?.code === 'ENOENT') {
    const binDir = process.env.MYSQL_BIN_DIR;
    const hint = binDir
      ? `MYSQL_BIN_DIR=${binDir} 下未找到 ${tool},请检查路径是否正确`
      : process.platform === 'darwin'
        ? `未找到 ${tool},请运行 \`brew install mysql-client\` 或在 .env 设置 MYSQL_BIN_DIR`
        : `未在系统 PATH 找到 ${tool},请在 .env 设置 MYSQL_BIN_DIR 指向 MySQL bin 目录`;
    return new Error(`${tool} 未找到:${hint}`);
  }
  return err;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const SAFE_NAME = /^[a-zA-Z0-9._-]+\.sql(\.gz)?$/;

export function getBackupsRoot(): string {
  return path.join(getStorageRoot(), 'db-backups');
}

export function ensureBackupsDir(): string {
  const root = getBackupsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function resolveSafePath(filename: string): string {
  if (!SAFE_NAME.test(filename)) throw new Error('invalid filename');
  const root = ensureBackupsDir();
  const resolved = path.resolve(root, filename);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('invalid filename');
  return resolved;
}

function buildMysqlArgs(db: DbConnection, withDb: boolean): string[] {
  const args = ['-h', db.host, '-P', String(db.port), '-u', db.user];
  if (db.password) args.push(`-p${db.password}`);
  args.push('--default-character-set=utf8mb4');
  if (withDb) args.push(db.database);
  return args;
}

// ── Connection config persistence ─────────────────────────────────

const CONN_KEY = 'dbConnections';

/** Get connection config; falls back to DATABASE_URL as implicit default. */
export async function getConnectionConfig(): Promise<ConnectionConfig & { envFallback?: DbConnection }> {
  const setting = await prisma.appSetting.findUnique({ where: { key: CONN_KEY } });
  if (setting?.value) {
    try {
      const parsed = JSON.parse(setting.value) as ConnectionConfig;
      return { connections: parsed.connections || [], defaultConnectionId: parsed.defaultConnectionId || null };
    } catch { /* fall through */ }
  }
  // No saved config: synthesize a fallback from DATABASE_URL
  const envConn = connFromEnv();
  return {
    connections: envConn ? [envConn] : [],
    defaultConnectionId: envConn?.id || null,
    envFallback: envConn || undefined,
  };
}

export async function saveConnectionConfig(config: ConnectionConfig): Promise<void> {
  const value = JSON.stringify({
    connections: config.connections,
    defaultConnectionId: config.defaultConnectionId,
  });
  await prisma.appSetting.upsert({
    where: { key: CONN_KEY },
    create: { key: CONN_KEY, value },
    update: { value },
  });
}

function connFromEnv(): DbConnection | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return {
      id: 'env',
      name: '默认连接(DATABASE_URL)',
      host: url.hostname || 'localhost',
      port: url.port || '3306',
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\/+/, ''),
    };
  } catch {
    return null;
  }
}

/** Find a connection by id; if not found, fall back to env-derived default. */
export async function resolveConnection(connectionId: string | null | undefined): Promise<DbConnection> {
  const config = await getConnectionConfig();
  // If no connections saved anywhere, throw a helpful error
  if (config.connections.length === 0 && !config.envFallback) {
    throw new Error('未配置任何 MySQL 连接,请先在「连接管理」添加');
  }
  // No id provided: use default
  if (!connectionId) {
    const def = config.connections.find((c) => c.id === config.defaultConnectionId);
    if (def) return def;
    if (config.connections.length > 0) return config.connections[0];
    return config.envFallback!;
  }
  const found = config.connections.find((c) => c.id === connectionId);
  if (found) return found;
  // Id was provided but not found — if env fallback matches, use it
  if (connectionId === 'env' && config.envFallback) return config.envFallback;
  throw new Error(`连接 ${connectionId} 不存在`);
}

/** Test a connection by running `mysql --version` style ping. Returns version string or throws. */
export function testConnection(conn: DbConnection): string {
  const args = ['-h', conn.host, '-P', String(conn.port), '-u', conn.user];
  if (conn.password) args.push(`-p${conn.password}`);
  args.push('-e', 'SELECT VERSION();');
  try {
    const out = execFileSync(resolveMysqlCommand('mysql'), args, { encoding: 'utf8', env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const match = out.match(/VERSION\(\)\s*\n([^\n]+)/);
    return match ? match[1].trim() : out.trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString?.() || err.message;
    throw new Error(`连接失败:${stderr}`);
  }
}

// ── Backup / Restore ─────────────────────────────────────────────

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
export async function createBackup(opts: { compress?: boolean; tag?: string; connection?: DbConnection } = {}): Promise<BackupMeta> {
  const { compress = true, tag, connection } = opts;
  if (!connection) throw new Error('connection required');
  const root = ensureBackupsDir();
  const ts = formatTimestamp(new Date());
  const prefix = tag ? `${tag}-` : 'backup-';
  const ext = compress ? '.sql.gz' : '.sql';
  const filename = `${prefix}${ts}${ext}`;
  const filePath = path.join(root, filename);

  const args = [...buildMysqlArgs(connection, false), '--single-transaction', '--routines', '--triggers', '--events', connection.database];
  const dump = spawn(resolveMysqlCommand('mysqldump'), args, { env: process.env });
  const out = fs.createWriteStream(filePath);

  let stderr = '';
  dump.stderr.on('data', (d) => { stderr += d.toString(); });

  const gzip = compress ? zlib.createGzip() : undefined;
  const streams: any[] = [dump.stdout];
  if (gzip) streams.push(gzip);
  streams.push(out);

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
    connectionName: connection.name,
  };
}

/** Restore from a backup file into the given target connection. Automatically backs up current data of the target first. */
export async function restoreBackup(filename: string, targetConnection: DbConnection): Promise<{ preRestoreFile: string }> {
  const filePath = resolveSafePath(filename);
  if (!fs.existsSync(filePath)) throw new Error('备份文件不存在');

  // Safety net: snapshot current data of the TARGET connection before overwriting.
  const preRestore = await createBackup({ compress: true, tag: 'pre-restore', connection: targetConnection });

  const args = buildMysqlArgs(targetConnection, true);
  const mysql = spawn(resolveMysqlCommand('mysql'), args, { env: process.env });
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
