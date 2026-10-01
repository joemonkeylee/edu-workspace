#!/usr/bin/env python3
"""基于 scan-pdf-source.py 产出的 manifest.csv 做二次分析：排除规则校验 + 初中子集画像。"""
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict

MANIFEST = '/tmp/pdf-scan/manifest.csv'

rows = []
with open(MANIFEST, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        rows.append(r)

pdfs = [r for r in rows if r['kind'] == 'pdf']
pending = [r for r in rows if r['kind'] == 'pending_cfg']

print(f"manifest 行数={len(rows)}  真实PDF={len(pdfs)}  占位cfg={len(pending)}")
print()

# ---- 1. 排除原因逐一抽样，找误伤 ----
print("=" * 70)
print("1. 排除规则命中抽样（每类最多 6 条）")
print("=" * 70)
by_reason = defaultdict(list)
for r in pdfs:
    for reason in filter(None, r['excludes'].split('|')):
        by_reason[reason].append(r)
for reason, items in sorted(by_reason.items(), key=lambda kv: -len(kv[1])):
    print(f"\n--- {reason}  ({len(items)} 个) ---")
    for it in items[:6]:
        print(f"    {it['rel_path'][:150]}")

# ---- 2. 小升初 / 小学 是否误伤：看文件名里到底出现了什么 ----
print()
print("=" * 70)
print("2. 「小学」命中里出现的年级词统计（判断是否误伤初中文件）")
print("=" * 70)
xiaoxue = by_reason.get('小学', [])
cnt = Counter()
for r in xiaoxue:
    text = r['rel_path']
    for m in re.findall(r'[一二三四五六1-6]年级|小升初|小学|幼儿|学前', text):
        cnt[m] += 1
print(dict(cnt.most_common()))

# ---- 3. 初中子集：排除后剩余 ----
print()
print("=" * 70)
print("3. 初中子集画像（排除 小升初/高中/小学/大学考研/竞赛/非图书 后）")
print("=" * 70)
kept = [r for r in pdfs if not r['excludes']]

# 中考 单独拎出来看
zhongkao = [r for r in kept if r['grade'] == '中考']
print(f"排除 {len(pdfs)-len(kept)} 个，保留 {len(kept)} 个（其中 中考 类 {len(zhongkao)} 个）")

def multi(rows, key):
    c = Counter()
    for r in rows:
        vals = [v for v in r[key].split('|') if v] or ['(未识别)']
        for v in vals:
            c[v] += 1
    return c

print("\n科目分布:", dict(multi(kept, 'subjects').most_common()))
print("\n学期分布:", dict(multi(kept, 'grade').most_common()))
print("\n系列分布:", dict(multi(kept, 'series').most_common()))
print("\n文档类型:", dict(multi(kept, 'doc_type').most_common()))

# ---- 4. 主力目录：file 集中度 ----
print()
print("=" * 70)
print("4. 保留集的目录集中度（二级目录，取前 35）")
print("=" * 70)
def second_dir(rel):
    p = rel.split(os.sep)
    return '/'.join(p[:2]) if len(p) > 2 else '/'.join(p[:1])
c = Counter(second_dir(r['rel_path']) for r in kept)
for k, v in c.most_common(35):
    print(f"  {v:5d}  {k}")

# ---- 5. 未识别科目的都是什么 ----
print()
print("=" * 70)
print("5. 未识别科目抽样（保留集内，抽 25）")
print("=" * 70)
nosub = [r for r in kept if not r['subjects']]
print(f"共 {len(nosub)} 个")
for r in nosub[:25]:
    print(f"    [{r['grade'] or '-'}] {r['rel_path'][:130]}")

# ---- 6. 重复文件名 ----
print()
print("=" * 70)
print("6. 疑似重复（stem 相同且 >=2，按组数统计）")
print("=" * 70)
g = defaultdict(list)
for r in kept:
    g[os.path.splitext(os.path.basename(r['rel_path']))[0]].append(r['rel_path'])
dup = {k: v for k, v in g.items() if len(v) > 1}
print(f"重复组 {len(dup)} 组，涉及 {sum(len(v) for v in dup.values())} 个文件")
# 同名不同目录但目录尾名相同 → 极可能真重复
suspect = {k: v for k, v in dup.items()
           if len({os.path.basename(os.path.dirname(x)) for x in v}) == 1}
print(f"其中「文件名+父目录名都相同」的强重复 {len(suspect)} 组")
for k, v in list(suspect.items())[:12]:
    print(f"    {k[:60]}")
    for x in v[:3]:
        print(f"        {x[:150]}")

# ---- 7. 体量估算 ----
kept_bytes = sum(int(float(r['size_mb']) * 1048576) for r in kept)
print()
print(f"保留集总体积: {kept_bytes/1073741824:.2f} GB")
