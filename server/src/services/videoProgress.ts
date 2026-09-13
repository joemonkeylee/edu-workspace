import type { VideoProgress } from '@prisma/client';
import prisma from '../prisma.js';

/** 播放比例达到该阈值即视为「已看完」（手动完成另算） */
export const WATCHED_RATIO = 0.95;

/** 请求者身份（standalone 模式下为 undefined） */
export interface ProgressUser {
  userId?: number;
  isAdmin?: boolean;
}

/**
 * 数据归属过滤，遵循 AUTH_ENABLED 原则：
 * - AUTH_ENABLED=false（无 user）→ 单机版，进度以匿名（userId=null）共享，不隔离
 * - 管理员 → 可见全部
 * - 普通用户 → 仅自己的记录
 */
export function userScope(user?: ProgressUser): { userId?: number | null } {
  if (!user) return { userId: null };
  if (user.isAdmin) return {};
  return { userId: user.userId ?? null };
}

export type VideoStatus = 'not_started' | 'in_progress' | 'watched' | 'completed';

export interface VideoProgressInfo {
  positionSec: number;
  durationSec: number;
  watched: boolean;
  completed: boolean;
  completedAt: string | null;
  lastViewedAt: string | null;
  /** 完成度 0-100（已完成=100；否则按播放位置/时长） */
  percent: number;
  status: VideoStatus;
}

export interface VideoReadiness {
  assignmentsDone: number;
  assignmentsTotal: number;
  mistakesDone: number;
  mistakesTotal: number;
  /** 作业全部提交 + 错题全部整理完 → 可手动标记视频完成 */
  ready: boolean;
}

type ProgressRow = Pick<VideoProgress, 'positionSec' | 'durationSec' | 'watched' | 'completed'>;

/** 单条进度的完成度 0~1 */
export function progressFraction(p?: ProgressRow | null): number {
  if (!p) return 0;
  if (p.completed) return 1;
  if (p.durationSec > 0) {
    const ratio = p.positionSec / p.durationSec;
    if (ratio > 0) return Math.min(ratio, p.watched ? 1 : 0.99);
  }
  return p.watched ? 1 : 0;
}

export function progressStatus(p?: ProgressRow | null): VideoStatus {
  if (!p || (!p.completed && !p.watched && p.positionSec <= 0)) return 'not_started';
  if (p.completed) return 'completed';
  if (p.watched) return 'watched';
  return 'in_progress';
}

export function toProgressInfo(p?: VideoProgress | null): VideoProgressInfo | null {
  if (!p) return null;
  return {
    positionSec: p.positionSec,
    durationSec: p.durationSec,
    watched: p.watched,
    completed: p.completed,
    completedAt: p.completedAt ? p.completedAt.toISOString() : null,
    lastViewedAt: p.lastViewedAt ? p.lastViewedAt.toISOString() : null,
    percent: Math.round(progressFraction(p) * 100),
    status: progressStatus(p),
  };
}

/** 批量读取若干视频（按 relPath 身份）的进度 */
export async function loadProgressMap(
  videoKeys: string[],
  user?: ProgressUser,
): Promise<Map<string, VideoProgress>> {
  const keys = [...new Set(videoKeys.filter(Boolean))];
  const map = new Map<string, VideoProgress>();
  if (keys.length === 0) return map;
  const rows = await prisma.videoProgress.findMany({
    where: { videoKey: { in: keys }, ...userScope(user) },
  });
  for (const row of rows) map.set(row.videoKey, row);
  return map;
}

/**
 * 某本书的「手动完成」就绪状态：作业全部提交/批改 + 错题全部整理完。
 * 就绪条件是书级别的（作业与错题都挂在书上），因此该书所有视频共用同一份判定。
 */
export async function bookReadiness(bookId: number, user?: ProgressUser): Promise<VideoReadiness> {
  if (!Number.isFinite(bookId)) {
    return { assignmentsDone: 0, assignmentsTotal: 0, mistakesDone: 0, mistakesTotal: 0, ready: true };
  }
  const scope = userScope(user);
  const [assignments, mistakes] = await Promise.all([
    prisma.assignment.findMany({ where: { bookId, ...scope }, select: { status: true } }),
    prisma.mistake.findMany({ where: { bookId, ...scope }, select: { reviewStatus: true } }),
  ]);

  const assignmentsTotal = assignments.length;
  const assignmentsDone = assignments.filter((a) => a.status === 'submitted' || a.status === 'graded').length;
  const mistakesTotal = mistakes.length;
  const mistakesDone = mistakes.filter((m) => m.reviewStatus === 1).length;

  return {
    assignmentsDone,
    assignmentsTotal,
    mistakesDone,
    mistakesTotal,
    ready: assignmentsDone === assignmentsTotal && mistakesDone === mistakesTotal,
  };
}

/** 读取或新建某视频对某用户的进度行（videoKey 为视频身份，跨书共享） */
export async function upsertProgress(
  videoKey: string,
  userId: number | null,
  data: Partial<Pick<VideoProgress, 'positionSec' | 'durationSec' | 'watched' | 'completed' | 'completedAt' | 'lastViewedAt'>>,
): Promise<VideoProgress> {
  const existing = await prisma.videoProgress.findFirst({ where: { videoKey, userId } });
  if (existing) {
    return prisma.videoProgress.update({ where: { id: existing.id }, data });
  }
  return prisma.videoProgress.create({ data: { videoKey, userId, ...data } });
}
