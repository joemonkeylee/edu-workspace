import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';
import { hashPassword, revokeAllUserRefreshTokens, countUserDevices, getAllAuthSettings, setSetting } from '../services/auth.js';
import { adminRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(adminRequired);

// ── List users ───────────────────────────────────────────────────

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string) || 20));
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const role = typeof req.query.role === 'string' ? req.query.role : 'all';

  const where: any = {};
  if (search) {
    where.OR = [
      { phone: { contains: search } },
      { email: { contains: search } },
      { nickName: { contains: search } },
    ];
  }
  if (role !== 'all') where.role = role;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, phone: true, email: true, isAdmin: true, role: true, nickName: true,
        avatar: true, status: true, maxDevices: true, createdAt: true, updatedAt: true,
      },
      orderBy: { id: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  // Batch device counts (avoid N+1)
  const userIds = users.map((u) => u.id);
  const deviceCounts = await prisma.refreshToken.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _count: { userId: true },
  });
  const deviceCountMap = new Map<number, number>();
  for (const dc of deviceCounts) {
    deviceCountMap.set(dc.userId, dc._count.userId);
  }
  const result = users.map((u) => ({ ...u, deviceCount: deviceCountMap.get(u.id) || 0 }));

  res.json({ data: result, total, page, pageSize });
}));

// ── Create user ───────────────────────────────────────────────────

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : null;
  const isAdmin = !!req.body?.isAdmin;
  const role = typeof req.body?.role === 'string' ? req.body.role : 'student';
  const nickName = typeof req.body?.nickName === 'string' ? req.body.nickName.trim() : '';
  const maxDevices = Math.max(1, Math.min(10, parseInt(req.body?.maxDevices) || 3));

  if (!phone || !password) return res.status(400).json({ error: 'phone and password required' });

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) return res.status(409).json({ error: 'phone already registered' });

  const hashed = await hashPassword(password);
  const user = await prisma.user.create({
    data: { phone, password: hashed, email: email || null, isAdmin, role, nickName, maxDevices },
    select: {
      id: true, phone: true, email: true, isAdmin: true, role: true, nickName: true,
      avatar: true, status: true, maxDevices: true, createdAt: true,
    },
  });
  res.json({ user });
}));

// ── Update user ───────────────────────────────────────────────────

router.put('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'user not found' });

  const data: any = {};
  if (typeof req.body?.phone === 'string' && req.body.phone.trim()) data.phone = req.body.phone.trim();
  if (typeof req.body?.email === 'string' && req.body.email.trim()) data.email = req.body.email.trim();
  else if (req.body?.email === '' || req.body?.email === null) data.email = null;
  if (typeof req.body?.isAdmin === 'boolean') data.isAdmin = req.body.isAdmin;
  if (typeof req.body?.role === 'string') data.role = req.body.role;
  if (typeof req.body?.nickName === 'string') data.nickName = req.body.nickName.trim();
  if (typeof req.body?.status === 'string') data.status = req.body.status;
  if (typeof req.body?.maxDevices === 'number') data.maxDevices = Math.max(1, Math.min(10, req.body.maxDevices));

  if (data.phone && data.phone !== user.phone) {
    const conflict = await prisma.user.findUnique({ where: { phone: data.phone } });
    if (conflict) return res.status(409).json({ error: 'phone already in use' });
  }

  if (data.email && data.email !== user.email) {
    const conflict = await prisma.user.findUnique({ where: { email: data.email } });
    if (conflict) return res.status(409).json({ error: 'email already in use' });
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true, phone: true, email: true, isAdmin: true, role: true, nickName: true,
      avatar: true, status: true, maxDevices: true, updatedAt: true,
    },
  });
  res.json({ user: updated });
}));

// ── Reset password ────────────────────────────────────────────────

router.put('/:id/password', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || password.length < 4) return res.status(400).json({ error: 'password too short' });

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'user not found' });

  const hashed = await hashPassword(password);
  await prisma.user.update({ where: { id }, data: { password: hashed } });
  await revokeAllUserRefreshTokens(id);
  res.json({ success: true });
}));

// ── Delete user ────────────────────────────────────────────────────

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  await revokeAllUserRefreshTokens(id);
  await prisma.user.delete({ where: { id } });
  res.json({ success: true });
}));

// ── List user devices ─────────────────────────────────────────────

router.get('/:id/devices', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const tokens = await prisma.refreshToken.findMany({
    where: { userId: id, expiresAt: { gt: new Date() } },
    select: { id: true, deviceInfo: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: tokens });
}));

// ── Kick device ────────────────────────────────────────────────────

router.delete('/:id/devices/:tokenId', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const tokenId = parseInt(req.params.tokenId);
  if (isNaN(id) || isNaN(tokenId)) return res.status(400).json({ error: 'invalid id' });

  const token = await prisma.refreshToken.findFirst({ where: { id: tokenId, userId: id } });
  if (!token) return res.status(404).json({ error: 'device not found' });
  await prisma.refreshToken.delete({ where: { id: tokenId } });
  res.json({ success: true });
}));

// ── Auth settings ──────────────────────────────────────────────────

router.get('/settings/auth', asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getAllAuthSettings();
  res.json(settings);
}));

router.put('/settings/auth', asyncHandler(async (req: Request, res: Response) => {
  const allowed = [
    'auth.access_token_expiry',
    'auth.refresh_token_expiry',
    'auth.token_rotation',
    'auth.login_max_attempts',
    'auth.lock_duration',
  ];
  const updates = req.body || {};
  for (const key of allowed) {
    if (typeof updates[key] === 'string') {
      await setSetting(key, updates[key]);
    }
  }
  const settings = await getAllAuthSettings();
  res.json(settings);
}));

export default router;
