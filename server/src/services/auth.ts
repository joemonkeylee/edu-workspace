import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../prisma.js';

// ── Settings helper ──────────────────────────────────────────────

const SETTING_DEFAULTS: Record<string, string> = {
  'auth.access_token_expiry': '0',
  'auth.refresh_token_expiry': '7d',
  'auth.token_rotation': 'false',
  'auth.login_max_attempts': '5',
  'auth.lock_duration': '5m',
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? SETTING_DEFAULTS[key] ?? '';
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getAllAuthSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { startsWith: 'auth.' } },
  });
  const map: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  return map;
}

// ── JWT ───────────────────────────────────────────────────────────

export function isAuthEnabled(): boolean {
  // Default to true for safety; only disabled when explicitly set to 'false'
  return process.env.AUTH_ENABLED !== 'false';
}

function getAccessTokenExpiry(expiryStr: string): number | undefined {
  if (!expiryStr || expiryStr === '0') return undefined;
  return expiryStr as any;
}

function parseDurationToMs(str: string): number {
  if (!str || str === '0') return 0;
  const match = str.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return num * multipliers[unit];
}

export interface JwtPayload {
  userId: number;
  phone: string;
  isAdmin: boolean;
  role: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && isAuthEnabled()) {
    throw new Error('JWT_SECRET must be set when auth is enabled. Set AUTH_ENABLED=false for standalone mode.');
  }
  return secret || 'standalone-dev-secret';
}

function getJwtRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret && isAuthEnabled()) {
    throw new Error('JWT_REFRESH_SECRET must be set when auth is enabled.');
  }
  return secret || 'standalone-dev-refresh-secret';
}

export async function signAccessToken(payload: JwtPayload): Promise<string> {
  const expiry = await getSetting('auth.access_token_expiry');
  const options: jwt.SignOptions = {};
  if (expiry && expiry !== '0') {
    options.expiresIn = expiry as any;
  }
  return jwt.sign(payload, getJwtSecret(), options);
}

export async function signRefreshToken(payload: JwtPayload): Promise<string> {
  const expiry = await getSetting('auth.refresh_token_expiry');
  const options: jwt.SignOptions = {};
  if (expiry && expiry !== '0') {
    options.expiresIn = expiry as any;
  }
  return jwt.sign(payload, getJwtRefreshSecret(), options);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtRefreshSecret()) as JwtPayload;
}

// ── Refresh token storage (multi-device) ─────────────────────────

export async function storeRefreshToken(
  userId: number,
  token: string,
  deviceInfo: string,
  expiryStr: string
): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const ms = parseDurationToMs(expiryStr);
  const expiresAt = ms > 0 ? new Date(Date.now() + ms) : new Date(Date.now() + 7 * 86400000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, deviceInfo, expiresAt },
  });
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await prisma.refreshToken.deleteMany({ where: { tokenHash } }).catch(() => {});
}

export async function revokeAllUserRefreshTokens(userId: number): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
}

export async function validateRefreshToken(token: string): Promise<{ userId: number; id: number } | null> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!record) return null;
  if (record.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: record.id } }).catch(() => {});
    return null;
  }
  return { userId: record.userId, id: record.id };
}

export async function countUserDevices(userId: number): Promise<number> {
  await prisma.refreshToken.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  }).catch(() => {});
  return prisma.refreshToken.count({ where: { userId } });
}

// ── Password ──────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Captcha store (in-memory with TTL) ───────────────────────────

interface CaptchaEntry {
  text: string;
  expiresAt: number;
}

const captchaStore = new Map<string, CaptchaEntry>();

export function storeCaptcha(key: string, text: string, ttlMs = 5 * 60000): void {
  captchaStore.set(key, { text, expiresAt: Date.now() + ttlMs });
  // Cleanup expired
  if (captchaStore.size > 200) {
    const now = Date.now();
    for (const [k, v] of captchaStore) {
      if (v.expiresAt < now) captchaStore.delete(k);
    }
  }
}

export function verifyCaptcha(key: string, text: string): boolean {
  const entry = captchaStore.get(key);
  if (!entry) return false;
  captchaStore.delete(key);
  if (entry.expiresAt < Date.now()) return false;
  return entry.text.toLowerCase() === text.toLowerCase();
}

// ── Login limiter (in-memory) ────────────────────────────────────

interface LockEntry {
  attempts: number;
  lockedUntil: number;
}

const loginLimiter = new Map<string, LockEntry>();

export async function checkLoginLock(phone: string): Promise<{ locked: boolean; remainingMs: number }> {
  const entry = loginLimiter.get(phone);
  if (!entry) return { locked: false, remainingMs: 0 };
  if (entry.lockedUntil > Date.now()) {
    return { locked: true, remainingMs: entry.lockedUntil - Date.now() };
  }
  return { locked: false, remainingMs: 0 };
}

export async function recordLoginFailure(phone: string): Promise<void> {
  const maxAttempts = parseInt(await getSetting('auth.login_max_attempts'), 10) || 5;
  const lockMs = parseDurationToMs(await getSetting('auth.lock_duration')) || 300000;

  let entry = loginLimiter.get(phone);
  if (!entry) {
    entry = { attempts: 0, lockedUntil: 0 };
    loginLimiter.set(phone, entry);
  }
  entry.attempts++;
  if (entry.attempts >= maxAttempts) {
    entry.lockedUntil = Date.now() + lockMs;
    entry.attempts = 0;
  }
}

export function clearLoginLock(phone: string): void {
  loginLimiter.delete(phone);
}
