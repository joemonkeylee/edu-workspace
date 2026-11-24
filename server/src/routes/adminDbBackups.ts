import { Router, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { adminRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  listBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  getBackupDownloadPath,
  isBackupsAvailable,
  getBackupsRoot,
  uploadBackup,
  resolveConnection,
  getConnectionConfig,
  saveConnectionConfig,
  testConnection,
  type DbConnection,
  type ConnectionConfig,
} from '../services/dbBackup.js';

const router = Router();
router.use(adminRequired);

const uploadTempRoot = path.join(os.tmpdir(), 'edu-workspace-db-backup-uploads');

// Upload to a temporary directory first; the configured object store owns the final copy.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(uploadTempRoot, { recursive: true });
        cb(null, uploadTempRoot);
      } catch (error) {
        cb(error as Error, '');
      }
    },
    filename: (_req, _file, cb) => cb(null, `${uuidv4()}.upload`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (_req, file, cb) => {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.sql(\.gz)?$/.test(name)) {
      return cb(null, false);
    }
    cb(null, true);
  },
});

// ── Backups: list / create / upload / download / delete / restore ─

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const available = await isBackupsAvailable();
  const data = await listBackups();
  res.json({ data, available, root: getBackupsRoot() });
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const compress = req.body?.compress !== false; // default true
  const connectionId = req.body?.connectionId ?? null;
  const connection = await resolveConnection(connectionId);
  const meta = await createBackup({ compress, connection });
  res.status(201).json({ data: meta });
}));

router.post('/upload', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: '未收到文件,或文件名仅允许字母数字及 .sql/.sql.gz 后缀' });
  }
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  try {
    const meta = await uploadBackup(filename, req.file.path);
    res.status(201).json({ data: meta });
  } finally {
    await fs.promises.rm(req.file.path, { force: true });
  }
}));

router.get('/:filename/download', asyncHandler(async (req: Request, res: Response) => {
  const { filePath, cleanup } = await getBackupDownloadPath(req.params.filename);
  res.download(filePath, req.params.filename, (error) => {
    cleanup();
    if (error) {
      if (!res.headersSent) res.status(500).json({ error: 'failed to download backup' });
      else res.destroy(error);
    }
  });
}));

router.delete('/:filename', asyncHandler(async (req: Request, res: Response) => {
  await deleteBackup(req.params.filename);
  res.json({ success: true });
}));

router.post('/:filename/restore', asyncHandler(async (req: Request, res: Response) => {
  const connectionId = req.body?.connectionId ?? null;
  const targetConnection = await resolveConnection(connectionId);
  const result = await restoreBackup(req.params.filename, targetConnection);
  res.json({ data: result });
}));

// ── Connection management ────────────────────────────────────────
//
// NOTE: these routes must be declared BEFORE /:filename routes to avoid
// the dynamic segment capturing "connections" as a filename. We register
// them last in code but Express matches by route shape, so /connections
// (literal) wins over /:filename (param) for the path /connections.
// To be safe, we use distinct shapes: GET/PUT /connections (no :param).

router.get('/connections/list', asyncHandler(async (_req: Request, res: Response) => {
  const config = await getConnectionConfig();
  // Mask passwords in list response
  const safe = {
    connections: config.connections.map((c) => ({ ...c, password: c.password ? '••••••' : '' })),
    defaultConnectionId: config.defaultConnectionId,
    hasEnvFallback: !!config.envFallback,
  };
  res.json({ data: safe });
}));

router.put('/connections', asyncHandler(async (req: Request, res: Response) => {
  const incoming = req.body as ConnectionConfig;
  if (!incoming || !Array.isArray(incoming.connections)) {
    return res.status(400).json({ error: 'connections 数组必填' });
  }
  // Validate each connection
  for (const c of incoming.connections) {
    if (!c.id || !c.name || !c.host || !c.user || !c.database) {
      return res.status(400).json({ error: '每个连接需含 id/name/host/user/database' });
    }
    if (!c.port) c.port = '3306';
    // Treat masked password sentinel as "keep existing"
    if (c.password === '••••••') {
      const existing = (await getConnectionConfig()).connections.find((x) => x.id === c.id);
      c.password = existing?.password || '';
    }
  }
  await saveConnectionConfig({
    connections: incoming.connections,
    defaultConnectionId: incoming.defaultConnectionId || null,
  });
  res.json({ data: { saved: incoming.connections.length } });
}));

router.post('/connections/test', asyncHandler(async (req: Request, res: Response) => {
  const c = req.body as Partial<DbConnection>;
  if (!c?.host || !c?.user || !c?.database) {
    return res.status(400).json({ error: 'host/user/database 必填' });
  }
  // If password is masked sentinel, look up existing config
  let password = c.password || '';
  if (password === '••••••' && c.id) {
    const existing = (await getConnectionConfig()).connections.find((x) => x.id === c.id);
    password = existing?.password || '';
  }
  const conn: DbConnection = {
    id: c.id || 'test',
    name: c.name || 'test',
    host: c.host,
    port: String(c.port || '3306'),
    user: c.user,
    password,
    database: c.database,
  };
  try {
    const version = testConnection(conn);
    res.json({ data: { ok: true, version } });
  } catch (err: any) {
    res.status(200).json({ data: { ok: false, error: err.message } });
  }
}));

// Helper to generate a new connection id (used by frontend when adding)
router.get('/connections/new-id', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: { id: uuidv4() } });
}));

export default router;
