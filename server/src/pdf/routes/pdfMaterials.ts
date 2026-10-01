import { Router, type Response } from 'express';
import { adminRequired, type AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import prisma from '../../prisma.js';

/**
 * 教辅资料（teaching_materials）管理端只读展示 + 筛选。
 *
 * 这张表是外部资料盘的教辅清单（名称 / 科目 / 地区 / 来源 / 难度 / 热度 / 网盘链接），
 * 目前**不在 Prisma schema 里**（属遗留表），因此这里全部走参数化原生 SQL，
 * 既不改 schema、也不跑 db push（避免影响其它遗留表）。
 *
 * 一个重要的数据特征：`subject` 是**多值字段**，用「、」连接（如「英语、物理」「生物、地理、历史、道法」），
 * 所以科目筛选必须用 LIKE 匹配，不能等号；/facets 里则把它拆成单值科目再统计。
 */

const router = Router();
router.use(adminRequired);

const TABLE = 'teaching_materials';

/** 排序字段白名单（ORDER BY 无法参数化，只能白名单映射，防注入） */
const SORTABLE: Record<string, string> = {
  id: 'id',
  name: 'name',
  subject: 'subject',
  region: 'region',
  source: 'source',
  difficulty: 'difficulty',
  popularity: 'popularity',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * LIKE 的 ESCAPE 子句。
 * 注意这里是**两层转义**：MySQL 字符串字面量里表示一个反斜杠要写 '\\'，
 * 而 JS 模板字符串里要产出这两个字符又得写成 '\\\\'。
 * （写成 '\\' 只会产出一个反斜杠，MySQL 会把它当成转义引号 → 1064 语法错误）
 */
const ESCAPE_CLAUSE = `ESCAPE '\\\\'`;

/** LIKE 通配符转义，与 SQL 里的 ESCAPE 子句配套 */
function escLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface Filters {
  q: string;
  subject: string;
  region: string;
  source: string;
  difficulty: number | null;
  popularity: number | null;
  /** '1' = 仅有链接，'0' = 无链接，'' = 不限 */
  hasUrl: string;
}

/** 按入参拼 WHERE 子句；所有值都走 ? 占位符，杜绝拼接注入 */
function buildWhere(f: Filters): { clause: string; params: unknown[] } {
  const w: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    w.push(`name LIKE ? ${ESCAPE_CLAUSE}`);
    params.push(`%${escLike(f.q)}%`);
  }
  if (f.subject) {
    // 多值字段：用 LIKE 命中「英语、物理」这类组合值中的任意一项
    w.push(`subject LIKE ? ${ESCAPE_CLAUSE}`);
    params.push(`%${escLike(f.subject)}%`);
  }
  if (f.region) {
    w.push('region = ?');
    params.push(f.region);
  }
  if (f.source) {
    w.push('source = ?');
    params.push(f.source);
  }
  if (f.difficulty !== null) {
    w.push('difficulty = ?');
    params.push(f.difficulty);
  }
  if (f.popularity !== null) {
    w.push('popularity = ?');
    params.push(f.popularity);
  }
  if (f.hasUrl === '1') w.push(`url IS NOT NULL AND url <> ''`);
  if (f.hasUrl === '0') w.push(`(url IS NULL OR url = '')`);
  return { clause: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

function readFilters(req: AuthedRequest): Filters {
  return {
    q: str(req.query.q),
    subject: str(req.query.subject),
    region: str(req.query.region),
    source: str(req.query.source),
    difficulty: num(req.query.difficulty),
    popularity: num(req.query.popularity),
    hasUrl: str(req.query.hasUrl),
  };
}

/** GET /api/pdf/admin/materials —— 分页列表（带筛选 / 排序） */
router.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const f = readFilters(req);
    const page = Math.max(1, Math.floor(num(req.query.page) ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(num(req.query.pageSize) ?? 20)));
    const sortKey = str(req.query.sort);
    const sortCol = SORTABLE[sortKey] || 'id';
    const order = str(req.query.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const { clause, params } = buildWhere(f);

    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM ${TABLE} ${clause}`,
      ...params
    );
    const total = Number((countRows as { n: number | bigint }[])[0]?.n ?? 0);

    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, name, difficulty, subject, popularity, region, source, url, created_at, updated_at
       FROM ${TABLE} ${clause}
       ORDER BY ${sortCol} ${order}
       LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize
    );

    res.json({
      data: {
        rows: (rows as Record<string, unknown>[]).map((r) => ({
          id: Number(r.id),
          name: String(r.name ?? ''),
          difficulty: r.difficulty === null || r.difficulty === undefined ? null : Number(r.difficulty),
          subject: String(r.subject ?? ''),
          popularity: r.popularity === null || r.popularity === undefined ? null : Number(r.popularity),
          region: String(r.region ?? ''),
          source: String(r.source ?? ''),
          url: String(r.url ?? ''),
          createdAt: r.created_at ?? null,
          updatedAt: r.updated_at ?? null,
        })),
        total,
        page,
        pageSize,
      },
    });
  })
);

/** GET /api/pdf/admin/materials/facets —— 各筛选项的可选值 + 计数（基于全表，不随筛选收敛） */
router.get(
  '/facets',
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    // 科目：原字段是多值（「、」连接），拆成单值后统计命中行数
    const subjectRows = await prisma.$queryRawUnsafe(`SELECT subject FROM ${TABLE}`);
    const subjectCount = new Map<string, number>();
    for (const r of subjectRows as { subject: string | null }[]) {
      const raw = String(r.subject ?? '').trim();
      if (!raw) continue;
      for (const token of raw.split('、')) {
        const t = token.trim();
        if (!t) continue;
        subjectCount.set(t, (subjectCount.get(t) ?? 0) + 1);
      }
    }
    const subjects = [...subjectCount.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh'));

    // 其余字段是单值，直接 GROUP BY
    async function groupBy(col: string): Promise<{ value: string; count: number }[]> {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT \`${col}\` AS v, COUNT(*) AS n FROM ${TABLE} GROUP BY \`${col}\` ORDER BY n DESC, v ASC`
      );
      return (rows as { v: string | null; n: number | bigint }[]).map((r) => ({
        value: String(r.v ?? ''),
        count: Number(r.n ?? 0),
      }));
    }

    const [regions, sources, difficulties, popularities] = await Promise.all([
      groupBy('region'),
      groupBy('source'),
      groupBy('difficulty'),
      groupBy('popularity'),
    ]);
    const totalRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${TABLE}`);
    const total = Number((totalRows as { n: number | bigint }[])[0]?.n ?? 0);

    res.json({
      data: {
        subjects,
        regions,
        sources,
        // 难度 / 热度是数值，前端下拉按数值排序
        difficulties: difficulties
          .map((d) => ({ value: Number(d.value), count: d.count }))
          .sort((a, b) => a.value - b.value),
        popularities: popularities
          .map((p) => ({ value: Number(p.value), count: p.count }))
          .sort((a, b) => a.value - b.value),
        total,
      },
    });
  })
);

export default router;
