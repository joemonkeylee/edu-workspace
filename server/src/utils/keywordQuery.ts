/**
 * 关键字布尔查询：`&` = 与，`|` = 或。
 *
 * 优先级：`&` 高于 `|` —— 先按 `|` 分组（任一组命中即可），组内按 `&` 组合（所有词都要命中）。
 *   "秋下&人教&全国"      → 需同时包含三个词
 *   "秋上|秋下"           → 包含任一
 *   "秋下&人教|秋上&数学"  → (秋下 且 人教) 或 (秋上 且 数学)
 *
 * 多字段时，每个词只需在任一字段中命中（保持各页面原有的跨字段搜索语义）。
 *
 * 返回值是「where 顶层片段」（{ title: {...} } / { AND: [...] } / { OR: [...] }），
 * 由调用方 Object.assign 合入自己的 where —— 本项目的 Prisma 客户端运行时
 * 不支持标量字段内部的 AND/OR（title: { AND: ... } 会报 Unknown argument），
 * 顶层组合则完全支持。输入为空或只有分隔符时返回 undefined。
 */
export function buildKeywordFilter(keyword: string, fields: string[]): Record<string, unknown> | undefined {
  const kw = String(keyword || '').trim();
  if (!kw) return undefined;

  const termCond = (t: string): Record<string, unknown> => {
    const perField = fields.map((f) => ({ [f]: { contains: t } }));
    return perField.length === 1 ? perField[0] : { OR: perField };
  };

  const groups: Record<string, unknown>[] = [];
  for (const group of kw.split('|')) {
    const terms = group.split('&').map((t) => t.trim()).filter(Boolean);
    if (!terms.length) continue;
    const conds = terms.map(termCond);
    groups.push(conds.length === 1 ? conds[0] : { AND: conds });
  }
  if (!groups.length) return undefined;
  return groups.length === 1 ? groups[0] : { OR: groups };
}
