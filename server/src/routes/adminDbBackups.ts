import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { adminRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  listBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  resolveSafePath,
  ensureBackupsDir,
  resolveConnection,
  getConnectionConfig,
  saveConnectionConfig,
  testConnection,
  type BackupMeta,
  type DbConnection,
  type ConnectionConfig,
} from '../services/dbBackup.js';

const router = Router();
router.use(adminRequired);

// Upload config: disk storage into backups dir, keep original name, validate suffix.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureBackupsDir()),
    filename: (_req, file, cb) => cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8')),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (_req, file, cb) => {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!/^[a-zA-Z0-9._-]+\.sql(\.gz)?$/.test(name)) {
      return cb(null, false);
    }
    cb(null, true);
  },
});

// ── Backups: list / create / upload / download / delete / restore ─

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const data = listBackups();
  res.json({ data });
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
  const stat = await import('fs').then((m) => m.statSync(req.file!.path));
  const meta: BackupMeta = {
    filename: req.file.filename!,
    size: stat.size,
    createdAt: stat.mtime.toISOString(),
    compressed: req.file.filename!.endsWith('.gz'),
    type: req.file.filename!.startsWith('pre-restore-') ? 'pre-restore' : 'backup',
  };
  res.status(201).json({ data: meta });
}));

router.get('/:filename/download', asyncHandler(async (req: Request, res: Response) => {
  const filePath = resolveSafePath(req.params.filename);
  res.download(filePath, req.params.filename);
}));

router.delete('/:filename', asyncHandler(async (req: Request, res: Response) => {
  deleteBackup(req.params.filename);
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
