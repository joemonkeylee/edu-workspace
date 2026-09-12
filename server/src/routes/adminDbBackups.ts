import { Router, Request, Response } from 'express';
import multer from 'multer';
import { adminRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  listBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  resolveSafePath,
  ensureBackupsDir,
  type BackupMeta,
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
    // multer may deliver latin1-encoded names; decode first for the regex check
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!/^[a-zA-Z0-9._-]+\.sql(\.gz)?$/.test(name)) {
      // reject silently; handler reports a clearer 400
      return cb(null, false);
    }
    cb(null, true);
  },
});

// ── List all backups ─────────────────────────────────────────────
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const data = listBackups();
  res.json({ data });
}));

// ── Create a new backup ──────────────────────────────────────────
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const compress = req.body?.compress !== false; // default true
  const meta = await createBackup({ compress });
  res.status(201).json({ data: meta });
}));

// ── Upload a backup file ─────────────────────────────────────────
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

// ── Download a backup ────────────────────────────────────────────
router.get('/:filename/download', asyncHandler(async (req: Request, res: Response) => {
  const filePath = resolveSafePath(req.params.filename);
  res.download(filePath, req.params.filename);
}));

// ── Delete a backup ──────────────────────────────────────────────
router.delete('/:filename', asyncHandler(async (req: Request, res: Response) => {
  deleteBackup(req.params.filename);
  res.json({ success: true });
}));

// ── Restore from a backup ───────────────────────────────────────
router.post('/:filename/restore', asyncHandler(async (req: Request, res: Response) => {
  const result = await restoreBackup(req.params.filename);
  res.json({ data: result });
}));

export default router;
