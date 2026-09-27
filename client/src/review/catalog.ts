/**
 * 去重词表索引的访问层。
 *
 * 索引由 scripts/build-review-index.mjs 生成，产物位于静态目录：
 *   meta.json      每个 unit 的 raw / unique 词数与所属 group
 *   g<N>.json      group -> unitId -> 去重后的词（\n 分隔的字符串）
 *
 * 为什么要这份索引：
 * - 书进度分母必须是「书内去重」后的词数（原始词条里有重复，不加去重永远到不了 100%）；
 * - 一级分类进度分母必须是「该分类所有书的并集」，运行时临时拉几十个词库 JSON 不现实；
 * - 索引按 group 分片、懒加载，只有切到某个分类才会下载它那一份。
 */

export type CatalogUnitMeta = {
  id: string;
  group: string;
  raw: number;
  unique: number;
};

export type CatalogGroupMeta = {
  group: string;
  file: string;
  units: number;
  raw: number;
  unique: number;
};

export type CatalogMeta = {
  version: number;
  generatedAt: string;
  unitCount: number;
  units: CatalogUnitMeta[];
  groups: CatalogGroupMeta[];
};

export type Catalog = {
  meta: () => Promise<CatalogMeta | null>;
  unitMeta: (unitId: string) => Promise<CatalogUnitMeta | null>;
  /** 某个 group 下所有 unit 的去重词表 */
  groupUnits: (group: string) => Promise<Record<string, string[]>>;
  /** 某个 group 的词表并集（一级分类进度的分母集合） */
  groupUnion: (group: string) => Promise<Set<string>>;
  /** 某个 unit 的去重词表（书进度的分母集合） */
  unitWords: (unitId: string) => Promise<string[]>;
  clearCache: () => void;
};

/** 同一次 Eval 只 fetch 一次：并发请求共享同一个 promise */
function inflight<T>(cache: Map<string, Promise<T>>, k: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(k);
  if (hit) return hit;
  const p = make().catch((e) => {
    cache.delete(k);
    throw e;
  });
  cache.set(k, p);
  return p;
}

export function createCatalog(baseUrl: string): Catalog {
  const metaCache = new Map<string, Promise<CatalogMeta | null>>();
  const groupCache = new Map<string, Promise<Record<string, string[]>>>();
  const unionCache = new Map<string, Promise<Set<string>>>();

  const loadMeta = () =>
    inflight(metaCache, 'meta', async () => {
      try {
        const res = await fetch(`${baseUrl}/meta.json`);
        if (!res.ok) return null;
        return (await res.json()) as CatalogMeta;
      } catch {
        return null;
      }
    });

  const loadGroupFile = (meta: CatalogMeta, group: string) =>
    inflight(groupCache, group, async () => {
      const g = meta.groups.find((x) => x.group === group);
      if (!g) return {};
      try {
        const res = await fetch(`${baseUrl}/${g.file}`);
        if (!res.ok) return {};
        const raw = (await res.json()) as Record<string, string>;
        const out: Record<string, string[]> = {};
        for (const [unitId, joined] of Object.entries(raw)) {
          out[unitId] = joined ? joined.split('\n') : [];
        }
        return out;
      } catch {
        return {};
      }
    });

  return {
    meta: loadMeta,

    async unitMeta(unitId) {
      const m = await loadMeta();
      return m?.units.find((u) => u.id === unitId) ?? null;
    },

    async groupUnits(group) {
      const m = await loadMeta();
      if (!m) return {};
      return loadGroupFile(m, group);
    },

    groupUnion(group) {
      return inflight(unionCache, group, async () => {
        const units = await this.groupUnits(group);
        const set = new Set<string>();
        for (const words of Object.values(units)) {
          for (const w of words) set.add(w);
        }
        return set;
      });
    },

    async unitWords(unitId) {
      const m = await loadMeta();
      if (!m) return [];
      const unit = m.units.find((u) => u.id === unitId);
      if (!unit) return [];
      const bucket = await loadGroupFile(m, unit.group);
      return bucket[unitId] ?? [];
    },

    clearCache() {
      metaCache.clear();
      groupCache.clear();
      unionCache.clear();
    },
  };
}
