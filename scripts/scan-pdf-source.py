#!/usr/bin/env python3
"""
扫描原始资料盘，产出 PDF 清单 + 分类统计，供「pdf 专栏」入库设计参考。

用法:
    python3 scripts/scan-pdf-source.py "/Volumes/WD10JPVT-75/资料" -o /tmp/pdf-scan

产出:
    manifest.csv   每个 PDF 一行(pending 占位文件也记录，用 kind 区分)
    summary.json   统计汇总
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict

# ---------- 分类规则 ----------

SUBJECTS = [
    ('语文', ['语文', '语'], ),
    ('数学', ['数学', '数']),
    ('英语', ['英语', '英']),
    ('物理', ['物理', '物']),
    ('化学', ['化学', '化']),
    ('生物', ['生物', '生']),
    ('地理', ['地理', '地']),
    ('历史', ['历史', '史']),
    ('政治', ['政治', '道法', '道德与法治', '思政']),
    ('科学', ['科学']),
    ('信息技术', ['信息技术']),
]
# 只做精确匹配(避免「英语」被「语文英语」这种多科合卷误判)。多科合卷单独标 multi。

# 非初中 / 应排除
EXCLUDE_KEYWORDS = {
    '小升初': ['小升初', '小升初分班', '六升七预习', '分班考试', '分班测试'],
    '高中': ['高中', '高考', '高一', '高二', '高三', '高1', '高2', '高3', '必修一', '必修1',
             '必修二', '必修2', '必修三', '必修3', '选择性必修', '五三高考', '五年高考'],
    '小学': ['小学', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
             '1年级', '2年级', '3年级', '4年级', '5年级', '6年级', '幼小', '幼儿', '学前'],
    '大学考研': ['大学', '考研', '四级', '六级', '雅思', '托福', '专升本', '成人高考'],
    '竞赛': ['竞赛', '奥赛', '培优竞赛', '自主招生', '强基'],
    '非图书': ['教师资格', '招聘', '公务员', '课件', '教案', '班主任', '家长会',
               '评语', '工作手册', '制度', '方案', '模板', '表格', '通知'],
}

GRADE_RULES = [
    ('七上', r'(?<![0-9A-Za-z第])七(年级)?上|(?<![0-9A-Za-z第])7上|初一上|七年级上册|鲁七上|RJ7上'),
    ('七下', r'(?<![0-9A-Za-z第])七(年级)?下|(?<![0-9A-Za-z第])7下|初一下|七年级下册'),
    ('八上', r'(?<![0-9A-Za-z第])八(年级)?上|(?<![0-9A-Za-z第])8上|初二上|八年级上册'),
    ('八下', r'(?<![0-9A-Za-z第])八(年级)?下|(?<![0-9A-Za-z第])8下|初二下|八年级下册'),
    ('九上', r'(?<![0-9A-Za-z第])九(年级)?上|(?<![0-9A-Za-z第])9上|初三上|九年级上册'),
    ('九下', r'(?<![0-9A-Za-z第])九(年级)?下|(?<![0-9A-Za-z第])9下|初三下|九年级下册'),
    ('七年级', r'七年级|(?<![0-9A-Za-z第])7年级|初一'),
    ('八年级', r'八年级|(?<![0-9A-Za-z第])8年级|初二'),
    ('九年级', r'九年级|(?<![0-9A-Za-z第])9年级|初三'),
    ('中考', r'中考|学业水平|会考|总复习|一轮复习|二轮复习|三轮复习'),
    ('初中通用', r'初中|7-9年级|789年级|七-九年级'),
]

SERIES_RULES = [
    ('五年高考三年模拟', r'五年高考三年模拟|五三|5年高考3年模拟|5·3'),
    ('必刷题', r'必刷题|必刷卷'),
    ('一遍过', r'一遍过'),
    ('教材帮', r'教材帮'),
    ('课堂笔记', r'课堂笔记'),
    ('学霸题中题', r'学霸题中题'),
    ('全品', r'全品'),
    ('点拨', r'点拨训练|荣德基'),
    ('名校学典', r'名校学典'),
    ('计算高手', r'计算高手'),
    ('时文阅读', r'时文阅读'),
    ('知识清单', r'知识清单'),
    ('王朝霞', r'王朝霞'),
    ('典中点', r'典中点'),
    ('实验班', r'实验班'),
    ('课时作业', r'课时作业|课时练'),
    ('单元测试', r'单元测试|单元检测|单元卷'),
    ('期中期末', r'期中|期末'),
    ('同步讲义', r'讲义|同步'),
    ('试卷真题', r'真题|模拟|押题|密卷|联考|月考'),
]

DOC_TYPES = [
    ('教材课本', r'课本|教材|电子课本|教科书'),
    ('知识点总结', r'知识点|考点|归纳|总结|梳理|清单|背默|早背晚默|课课贴'),
    ('字帖练字', r'字帖|练字|描红|书法'),
    ('单词默写', r'单词|默写|词汇|短语|中英互译|听写'),
    ('练习卷', r'练习|专项|训练|作业|每日一练|小纸条|题卡|活页'),
    ('试卷', r'试卷|测试卷|考卷|真题|模拟|月考|期中|期末|单元测'),
    ('阅读', r'阅读|完型|完形|七选五|六选五|五选五|时文'),
    ('作文', r'作文|写作|范文'),
    ('答案', r'答案|解析|参考答案'),
    ('预习衔接', r'预习|衔接|暑假|寒假|开学'),
]


def classify(text: str):
    subjects = [name for name, kws in SUBJECTS for kw in kws if kw in text]
    # 去掉「语」这种单字导致的误判
    subjects = [s for s in subjects if s in ('语文', '数学', '英语', '物理', '化学', '生物',
                                             '地理', '历史', '政治', '科学', '信息技术')]
    subjects = [s for s in subjects if (len(s) > 1 and s in text)]
    # 单词级去重：如果一个科目名是另一个的子串(如「政治」vs「思想政治」)保留更长的
    subjects = sorted(set(subjects), key=len, reverse=True)

    grade = ''
    for name, pat in GRADE_RULES:
        if re.search(pat, text):
            grade = name
            break

    series = ''
    for name, pat in SERIES_RULES:
        if re.search(pat, text, re.I):
            series = name
            break

    doc_type = ''
    for name, pat in DOC_TYPES:
        if re.search(pat, text, re.I):
            doc_type = name
            break

    excludes = [name for name, kws in EXCLUDE_KEYWORDS.items()
                if any(kw.lower() in text.lower() for kw in kws)]

    return subjects, grade, series, doc_type, excludes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('-o', '--out', default='/tmp/pdf-scan')
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    os.makedirs(args.out, exist_ok=True)
    manifest = os.path.join(args.out, 'manifest.csv')

    total_files = 0
    rows = []
    ext_counter = Counter()
    top_dirs = Counter()
    dup_names = defaultdict(list)
    size_by_top = Counter()

    with open(manifest, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['rel_path', 'abs_path', 'kind', 'ext', 'size_mb', 'name',
                    'subjects', 'grade', 'series', 'doc_type', 'excludes',
                    'depth', 'top_dir'])

        for dirpath, dirnames, filenames in os.walk(root):
            # 跳过明显的非资料目录
            dirnames[:] = [d for d in dirnames if not d.startswith('.')]
            for fn in filenames:
                if fn.startswith('.'):
                    continue
                total_files += 1
                abs_path = os.path.join(dirpath, fn)
                rel = os.path.relpath(abs_path, root)
                parts = rel.split(os.sep)
                top = parts[0] if parts else ''

                ext = os.path.splitext(fn)[1].lower()
                kind = 'other'
                stem = fn
                if fn.lower().endswith('.baiduyun.uploading.cfg'):
                    # 网盘未完成占位：真实文件其实没下下来
                    kind = 'pending_cfg'
                    stem = re.sub(r'\.baiduyun\.uploading\.cfg$', '', fn, flags=re.I)
                    ext = os.path.splitext(stem)[1].lower()
                elif ext == '.pdf':
                    kind = 'pdf'

                if kind == 'other' and ext not in ('.pdf',):
                    ext_counter[ext] += 1
                    continue

                try:
                    size = os.path.getsize(abs_path)
                except OSError:
                    size = 0

                ext_counter[ext] += 1
                top_dirs[top] += 1
                size_by_top[top] += size

                text = ' '.join(parts)
                subjects, grade, series, doc_type, excludes = classify(text)
                dup_names[os.path.splitext(stem)[0]].append(rel)

                w.writerow([rel, abs_path, kind, ext, f'{size/1048576:.2f}', stem,
                            '|'.join(subjects), grade, series, doc_type,
                            '|'.join(excludes), len(parts), top])

    # 汇总
    import csv as _csv
    with open(manifest, encoding='utf-8') as f:
        rdr = list(_csv.DictReader(f))

    real_pdf = [r for r in rdr if r['kind'] == 'pdf']
    pending = [r for r in rdr if r['kind'] == 'pending_cfg']

    def dist(rows, key):
        c = Counter()
        for r in rows:
            for v in (r[key].split('|') if '|' in r[key] else [r[key] or '(空)']):
                c[v] += 1
        return dict(c.most_common(60))

    # 会被排除的比例
    excluded = [r for r in real_pdf if r['excludes']]
    kept = [r for r in real_pdf if not r['excludes']]

    dup = {k: v for k, v in dup_names.items() if len(v) > 1 and len(k) > 4}

    summary = {
        'root': root,
        'total_files': total_files,
        'real_pdf': len(real_pdf),
        'pending_cfg': len(pending),
        'ext_dist': dict(ext_counter.most_common(30)),
        'by_top_dir': dict(top_dirs.most_common(20)),
        'size_gb_by_top': {k: round(v / 1073741824, 2) for k, v in size_by_top.most_common(20)},
        'real_pdf_by_top': dict(Counter(r['top_dir'] for r in real_pdf).most_common(20)),
        'subject_dist': dist(real_pdf, 'subjects'),
        'subject_dist_kept': dist(kept, 'subjects'),
        'grade_dist': dist(real_pdf, 'grade'),
        'grade_dist_kept': dist(kept, 'grade'),
        'series_dist': dist(real_pdf, 'series'),
        'doc_type_dist': dist(real_pdf, 'doc_type'),
        'exclude_dist': dist(excluded, 'excludes') if excluded else {},
        'excluded_count': len(excluded),
        'kept_count': len(kept),
        'no_subject_count': sum(1 for r in real_pdf if not r['subjects']),
        'no_grade_count': sum(1 for r in real_pdf if not r['grade']),
        'duplicate_stem_groups': len(dup),
        'duplicate_stem_examples': {k: v[:3] for k, v in list(dup.items())[:25]},
    }

    with open(os.path.join(args.out, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
