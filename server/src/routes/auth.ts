import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import svgCaptcha from 'svg-captcha';
import prisma from '../prisma.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  isAuthEnabled,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  storeRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  validateRefreshToken,
  countUserDevices,
  hashPassword,
  verifyPassword,
  storeCaptcha,
  verifyCaptcha,
  checkLoginLock,
  recordLoginFailure,
  clearLoginLock,
  getSetting,
} from '../services/auth.js';

const router = Router();

// ── Status (no token required) ───────────────────────────────────

router.get('/status', (_req: Request, res: Response) => {
  res.json({ authEnabled: isAuthEnabled() });
});

// ── Captcha ──────────────────────────────────────────────────────

router.get('/captcha', (req: Request, res: Response) => {
  const captcha = svgCaptcha.create({ size: 4, noise: 2, color: true, background: '#f0f0f0' });
  const key = crypto.randomBytes(16).toString('hex');
  storeCaptcha(key, captcha.text);
  res.json({ key, svg: captcha.data });
});

// ── Login ─────────────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response) => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const captchaKey = typeof req.body?.captchaKey === 'string' ? req.body.captchaKey : '';
    const captchaText = typeof req.body?.captchaText === 'string' ? req.body.captchaText : '';
    const deviceInfo = typeof req.body?.deviceInfo === 'string' ? req.body.deviceInfo : req.headers['user-agent'] || 'unknown';

    if (!phone || !password) return res.status(400).json({ error: 'phone and password required' });

    // Check captcha
    if (!verifyCaptcha(captchaKey, captchaText)) {
      return res.status(400).json({ error: 'captcha invalid' });
    }

    // Check lock
    const lock = await checkLoginLock(phone);
    if (lock.locked) {
      return res.status(429).json({ error: 'too many attempts, try later', retryMs: lock.remainingMs });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user || !(await verifyPassword(password, user.password))) {
      await recordLoginFailure(phone);
      return res.status(401).json({ error: 'phone or password incorrect' });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'account disabled' });
    }

    clearLoginLock(phone);

    // Check device limit
    const deviceCount = await countUserDevices(user.id);
    if (deviceCount >= user.maxDevices) {
      // Revoke oldest device
      const oldest = await prisma.refreshToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      if (oldest) {
        await prisma.refreshToken.delete({ where: { id: oldest.id } }).catch(() => {});
      }
    }

    const payload = { userId: user.id, phone: user.phone, isAdmin: user.isAdmin, role: user.role, tokenVersion: user.tokenVersion };
    const accessToken = await signAccessToken(payload);
    const refreshToken = await signRefreshToken(payload);
    const refreshExpiry = await getSetting('auth.refresh_token_expiry');
    await storeRefreshToken(user.id, refreshToken, deviceInfo, refreshExpiry);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        isAdmin: user.isAdmin,
        role: user.role,
        nickName: user.nickName,
        avatar: user.avatar,
        status: user.status,
        maxDevices: user.maxDevices,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Refresh ───────────────────────────────────────────────────────

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
    const deviceInfo = typeof req.body?.deviceInfo === 'string' ? req.body.deviceInfo : req.headers['user-agent'] || 'unknown';
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

    const decoded = verifyRefreshToken(refreshToken) as any;
    const valid = await validateRefreshToken(refreshToken);
    if (!valid) return res.status(401).json({ error: 'refresh token invalid or expired' });

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || user.status === 'disabled') {
      await revokeAllUserRefreshTokens(decoded.userId);
      return res.status(403).json({ error: 'account disabled or not found' });
    }

    const rotation = (await getSetting('auth.token_rotation')) === 'true';

    if (rotation) {
      await revokeRefreshToken(refreshToken);
    }

    const payload = { userId: user.id, phone: user.phone, isAdmin: user.isAdmin, role: user.role, tokenVersion: user.tokenVersion };
    const newAccessToken = await signAccessToken(payload);
    let newRefreshToken = refreshToken;

    if (rotation) {
      newRefreshToken = await signRefreshToken(payload);
      const refreshExpiry = await getSetting('auth.refresh_token_expiry');
      await storeRefreshToken(user.id, newRefreshToken, deviceInfo, refreshExpiry);
    }

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err: any) {
    res.status(401).json({ error: 'refresh token invalid' });
  }
});

// ── Logout ────────────────────────────────────────────────────────

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// ── Me (current user) ─────────────────────────────────────────────

router.get('/me', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Standalone mode: no user, return a virtual admin user
  if (!req.user) {
    return res.json({
      userId: 0,
      phone: '',
      email: null,
      isAdmin: true,
      role: 'admin',
      nickName: '本机用户',
      avatar: '',
      status: 'normal',
      maxDevices: 99,
    });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) return res.status(401).json({ error: 'user not found' });
  res.json({
    userId: user.id,
    phone: user.phone,
    email: user.email,
    isAdmin: user.isAdmin,
    role: user.role,
    nickName: user.nickName,
    avatar: user.avatar,
    status: user.status,
    maxDevices: user.maxDevices,
  });
}));

// ── Claim anonymous data ──────────────────────────────────────────
// Assign all userId=null records (annotations, mistakes, assignments)
// to the currently logged-in user. Useful when migrating from standalone
// mode (AUTH_ENABLED=false) to multi-user mode.

router.post('/claim-anonymous', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!req.user) return res.status(400).json({ error: 'not available in standalone mode' });

  const userId = req.user.userId;

  const [annotations, mistakes, assignments] = await Promise.all([
    prisma.annotation.updateMany({
      where: { userId: null },
      data: { userId },
    }),
    prisma.mistake.updateMany({
      where: { userId: null },
      data: { userId },
    }),
    prisma.assignment.updateMany({
      where: { userId: null },
      data: { userId },
    }),
  ]);

  res.json({
    success: true,
    claimed: {
      annotations: annotations.count,
      mistakes: mistakes.count,
      assignments: assignments.count,
    },
  });
}));

export default router;
