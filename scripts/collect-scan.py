#!/usr/bin/env python3
"""
PDF 专栏 · P1 扫描（只读，不写任何地方）

对原始资料盘做「目录分组 + 分类 + 噪声/占位/重复标记」，产出预览页要的两份 JSON：
  - collect-files.json : 扁平文件清单（复制步骤用）
  - collect-tree.json  : 嵌套目录树（预览页「目录树 + 内联编辑」用）

分类规则与 scripts/scan-pdf-source.py 保持一致（见下方 RULES 区）。

用法:
  # 试跑「数学」一个科目（不哈希，快）
  python3 scripts/collect-scan.py "/Volumes/WD10JPVT-75/资料" -o /tmp/pdf-collect --subject 数学 --no-hash

  # 全量（含内容 sha256 去重，慢，需读全量 PDF）
  python3 scripts/collect-scan.py "/Volumes/WD10JPVT-75/资料" -o /tmp/pdf-collect

  # 只扫某个子目录
  python3 scripts/collect-scan.py "/Volumes/WD10JPVT-75/资料/更多资料1" -o /tmp/pdf-collect --subject 数学

字段说明（每个文件）:
  relPath / absPath / sizeMB / name
  dir            : 所属源目录（批量赋值的最小单元，= 父目录 relPath）
  subject/grade  : 解析结果
  subjectConf/gradeConf : 置信度 0~1（命中文件名=高，仅命中目录路径=中）
  series/seriesConf  : 系列（嵌在文件名里，如《初中数学•学霸题中题》→学霸题中题）；
                        conf 0.9=白名单命中 / 0.5=文件名通用提取兜底
  docType        : 形态标签（教材/练习卷/试卷/字帖…）
  noise          : 命中目录级黑名单（字帖等）或非考试科目
  noiseReason    : noise 原因
  pending        : 是否为网盘配置壳（现盘已清空，保留逻辑）
  dupOf          : 内容 sha256 与哪个文件重复（第一份的 relPath），否则 null
  sha256         : 内容哈希（--no-hash 时为 null）
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime

# ======================================================================
# RULES —— 与 scripts/scan-pdf-source.py 同步
# ======================================================================
SUBJECTS = [
    ('语文', ['语文', '语']),
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

# 考试科目白名单（决定纳入专栏）；其余识别出的科目 → noise(非考试)
EXAM_WHITELIST = {'语文', '数学', '英语', '物理', '化学', '生物', '地理',
                  '历史', '政治', '科学'}

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

# 通用系列提取（白名单之外的兜底）：系列名几乎都嵌在文件名里，
# 典型结构  《初中数学•学霸题中题》七上(RJ)  /  7-9年级数学上册《学霸题中题》人教版
# —— 源目录名（如「初中资料合集」）只是笼统桶名，不能用来判断系列。
SUBJECT_TOKEN_SET = set()
for _s, _ in SUBJECTS:
    SUBJECT_TOKEN_SET.add(_s)
    for _pre in ('初中', '高中', '小学', ''):
        SUBJECT_TOKEN_SET.add(_pre + _s)
VERSION_KW = (r'人教版|北师大|北师|沪科|沪教|苏科|苏教|冀教|外研|译林|牛津|'
              r'鲁教|湘教|教科|川教|浙教|通用|新版|新编|修订|全新|升级')
# 这些词永远不该是系列名：分册标记 / 版本后缀 / 空书
SERIES_NEG = {'上册', '下册', '全一册', '主书', '空白', '无答案', '含答案', '答案',
              '解析', '完整版', '打印版', '高清版', '扫描版', '电子版', '正式版',
              '试用版', '内部', '预览', '样书', '样本'}
SEP_RE = r'[•·・、\s/｜|｜]+'

# 目录级黑名单（目录名含这些子串 → 整目录 noise）
NOISE_DIR_SUBSTR = ['字帖', '练字', '书法', '控笔', '描红', '电子字帖']

HASH_BUF = 1 << 20  # 1MB


def _first_kw(text, kws):
    for kw in kws:
        i = text.find(kw)
        if i >= 0:
            return kw, i
    return None, -1


def classify(text, filename):
    """返回 (subjects, grade, series, doc_type, excludes, subject_conf, grade_conf)。"""
    subjects = []
    subject_conf = 0.0
    for name, kws in SUBJECTS:
        kw, idx = _first_kw(text, kws)
        if idx < 0:
            continue
        if name not in subjects:
            subjects.append(name)
        # 命中在文件名里 → 高置信；只在目录路径里 → 中置信
        if idx >= 0 and kw in filename:
            subject_conf = max(subject_conf, 0.95)
        else:
            subject_conf = max(subject_conf, 0.6)

    grade = ''
    grade_conf = 0.0
    for name, pat in GRADE_RULES:
        m = re.search(pat, text)
        if m:
            grade = name
            start = m.start()
            # 文件名里命中 → 高
            if start >= len(text) - len(filename) - 1:
                grade_conf = 0.95
            else:
                grade_conf = 0.6
            break

    series = ''
    series_conf = 0.0
    # 1) 白名单优先（高置信）
    for name, pat in SERIES_RULES:
        if re.search(pat, text, re.I):
            series = name
            series_conf = 0.9
            break
    # 2) 通用提取兜底：系列名嵌在文件名里（书名号 / 间隔号结构），见下
    if not series:
        g = extract_series_generic(filename)
        if g:
            series = g
            series_conf = 0.5

    doc_type = ''
    for name, pat in DOC_TYPES:
        if re.search(pat, text, re.I):
            doc_type = name
            break

    excludes = [name for name, kws in EXCLUDE_KEYWORDS.items()
                if any(kw.lower() in text.lower() for kw in kws)]

    return subjects, grade, series, series_conf, doc_type, excludes, subject_conf, grade_conf


def extract_series_generic(filename):
    """白名单之外的兜底：从文件名结构里抽系列名。

    典型：2026《初中数学•学霸题中题》七上(RJ).pdf
      → 书名号内 = 初中数学•学霸题中题 → 去掉科目段「初中数学」→ 学霸题中题
    通用做法：
      - 优先取《…》内文；无书名号则取整个文件名（去扩展名）
      - 剥掉 版本括号 / 年份 / 版本关键词 / 年级关键词
      - 按分隔符切段，含科目 token 的段丢弃，剩下的长段即系列候选
    """
    stem = re.sub(r'\.pdf$', '', filename, flags=re.I)
    inner = re.findall(r'[《〈]([^》〉]*)', stem)
    cand = inner[0] if inner else stem
    cand = re.sub(r'[\(（][^)）]*[\)）]', '', cand)   # 版本括号
    cand = re.sub(r'20\d{2}', '', cand)               # 年份
    cand = re.sub(VERSION_KW, '', cand, flags=re.I)   # 版本关键词
    for _, pat in GRADE_RULES:                        # 年级关键词
        cand = re.sub(pat, '', cand, flags=re.I)
    cand = re.sub(r'(上册|下册|全一册)', '', cand)   # 分册标记
    segs = [s.strip('•·・、 ') for s in re.split(SEP_RE, cand) if s.strip('•·・、 ')]
    cands = []
    for seg in segs:
        if any(tok in seg for tok in SUBJECT_TOKEN_SET):   # 科目段丢弃
            continue
        if any(re.search(p, seg, re.I) for _, p in DOC_TYPES):  # 纯文档类型丢弃
            continue
        if seg in SERIES_NEG or any(n in seg for n in SERIES_NEG):  # 否定词丢弃
            continue
        if len(seg) >= 2 and not seg.isdigit():
            cands.append(seg)
    if not cands:
        return ''
    cands.sort(key=len, reverse=True)
    return cands[0]


def dir_is_noise(rel_dir_parts):
    """目录级黑名单：任一祖先目录名命中 → noise。"""
    for part in rel_dir_parts:
        for s in NOISE_DIR_SUBSTR:
            if s in part:
                return True, f'目录黑名单:{s}'
    return False, ''


# ======================================================================
# main
# ======================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('-o', '--out', default='/tmp/pdf-collect')
    ap.add_argument('--no-hash', action='store_true', help='跳过内容 sha256（快，但无 dupOf）')
    ap.add_argument('--subject', default='', help='只保留推断科目==该值的文件（试跑用）')
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f'ERROR: 目录不存在 {root}', file=sys.stderr)
        sys.exit(1)
    os.makedirs(args.out, exist_ok=True)

    files = []
    total = 0
    pending_count = 0
    noise_dir_count = 0

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir_parts = rel_dir.split(os.sep) if rel_dir != '.' else []
        dnoise, dnoise_reason = dir_is_noise(rel_dir_parts)

        for fn in filenames:
            if fn.startswith('.'):
                continue
            total += 1
            abs_path = os.path.join(dirpath, fn)
            rel = os.path.relpath(abs_path, root)
            parts = rel.split(os.sep)

            kind = 'pdf'
            stem = fn
            pending = False
            if fn.lower().endswith('.baiduyun.uploading.cfg'):
                kind = 'pending_cfg'
                pending = True
                pending_count += 1
                stem = re.sub(r'\.baiduyun\.uploading\.cfg$', '', fn, flags=re.I)
            elif not fn.lower().endswith('.pdf'):
                continue  # 只看 PDF（pending 壳也只看 pdf 后缀的）

            if pending:
                # 占位壳：记录但标 pending，不进正式清单
                files.append({
                    'name': fn, 'relPath': rel, 'absPath': abs_path,
                    'sizeMB': round(os.path.getsize(abs_path) / 1048576, 2) if os.path.exists(abs_path) else 0,
                    'dir': os.path.dirname(rel), 'kind': 'pending',
                    'subject': '', 'subjectConf': 0, 'grade': '', 'gradeConf': 0,
                    'series': '', 'docType': '', 'noise': True, 'noiseReason': 'pending_cfg',
                    'pending': True, 'dupOf': None, 'sha256': None,
                })
                continue

            try:
                size = os.path.getsize(abs_path)
            except OSError:
                size = 0

            text = ' '.join(parts)
            subjects, grade, series, series_conf, doc_type, excludes, sc, gc = classify(text, fn)

            # 非考试科目 → noise
            noise = dnoise
            noise_reason = dnoise_reason
            recog_subject = [s for s in subjects if s in EXAM_WHITELIST]
            non_exam = [s for s in subjects if s and s not in EXAM_WHITELIST]
            if non_exam and not recog_subject:
                noise = True
                noise_reason = f'非考试科目:{",".join(non_exam)}'
            if excludes:
                noise = True
                noise_reason = (noise_reason + ';' if noise_reason else '') + '排除:' + '|'.join(excludes)

            # 命中黑名单（目录级 / 路径级 / 非考试科目）→ 清空所有解析字段。
            # 这类文件既不解析科目/年级/系列，也不会入库，避免污染可解析计数与误导入门。
            if noise:
                subjects = []
                recog_subject = []
                grade = ''
                series = ''
                series_conf = 0.0
                doc_type = ''
                sc = 0.0
                gc = 0.0

            sha = None
            if not args.no_hash:
                sha = sha256_file(abs_path)

            files.append({
                'name': fn,
                'relPath': rel,
                'absPath': abs_path,
                'sizeMB': round(size / 1048576, 2),
                'dir': os.path.dirname(rel),
                'kind': 'pdf',
                'subject': recog_subject[0] if recog_subject else '',
                'subjectConf': round(sc, 2),
                'grade': grade,
                'gradeConf': round(gc, 2),
                'series': series,
                'seriesConf': round(series_conf, 2),
                'docType': doc_type,
                'noise': noise,
                'noiseReason': noise_reason,
                'pending': False,
                'dupOf': None,
                'sha256': sha,
            })

    # 去重：按 sha256 分组（仅当算了 hash）
    dup_groups = 0
    if not args.no_hash:
        by_hash = defaultdict(list)
        for f in files:
            if f['kind'] == 'pdf' and f['sha256']:
                by_hash[f['sha256']].append(f)
        for h, grp in by_hash.items():
            if len(grp) > 1:
                dup_groups += 1
                grp_sorted = sorted(grp, key=lambda x: x['relPath'])
                canon = grp_sorted[0]['relPath']
                for f in grp_sorted[1:]:
                    f['dupOf'] = canon

    # 科目过滤（试跑）
    if args.subject:
        kept = [f for f in files if f['kind'] == 'pdf' and f['subject'] == args.subject]
        pending_files = [f for f in files if f['kind'] == 'pending']
        files_out = kept + pending_files
    else:
        files_out = files

    # 构建目录树（仅 pdf + pending，供预览页）
    tree = build_tree([f for f in files_out])
    noise_dir_count = sum(1 for n in iter_tree(tree) if n.get('isNoise'))

    stats = {
        'root': root,
        'scannedAt': datetime.now().isoformat(timespec='seconds'),
        'totalWalked': total,
        'pdfCount': sum(1 for f in files if f['kind'] == 'pdf'),
        'pendingCount': pending_count,
        'noiseDirCount': noise_dir_count,
        'dupGroups': dup_groups,
        'subjectFilter': args.subject or None,
        'hashed': not args.no_hash,
        'subjectDist': dict(Counter(f['subject'] for f in files_out if f['kind'] == 'pdf').most_common()),
        'gradeDist': dict(Counter(f['grade'] or '(未解析)' for f in files_out if f['kind'] == 'pdf').most_common()),
        'noiseDist': dict(Counter((f['noiseReason'].split(';')[0] if f['noise'] else '(clean)')
                                  for f in files_out if f['kind'] == 'pdf').most_common()),
    }

    files_path = os.path.join(args.out, 'collect-files.json')
    tree_path = os.path.join(args.out, 'collect-tree.json')
    with open(files_path, 'w', encoding='utf-8') as f:
        json.dump({'meta': stats, 'files': files_out}, f, ensure_ascii=False, indent=1)
    with open(tree_path, 'w', encoding='utf-8') as f:
        json.dump(tree, f, ensure_ascii=False, indent=1)

    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f'\n写出: {files_path}\n      {tree_path}')


def sha256_file(path, buf=HASH_BUF):
    h = hashlib.sha256()
    try:
        with open(path, 'rb') as f:
            while True:
                b = f.read(buf)
                if not b:
                    break
                h.update(b)
        return h.hexdigest()
    except OSError:
        return None


def build_tree(files):
    """把扁平文件列表组织成嵌套目录树。根节点 children 为一级目录。

    目录噪声模型（不向上传染）：
      - isNoise : 该目录「自身」命中目录级黑名单（字帖等）→ 整目录排除
      - hasNoise: 该目录（含子孙）含有 noise 文件 → 仅用于 UI 打标记，不传染父级
    文件级 noise 标记在 files 里独立保存。
    """
    root = {'name': '', 'relPath': '', 'isDir': True, 'isNoise': False,
            'noiseReason': '', 'hasNoise': False, 'fileCount': 0,
            'noiseCount': 0, 'files': [], 'children': {}}

    for f in files:
        parts = f['relPath'].split(os.sep)
        node = root
        acc = []
        for part in parts[:-1]:  # 除最后文件名
            acc.append(part)
            child = node['children'].get(part)
            if child is None:
                child = {'name': part, 'relPath': os.sep.join(acc),
                         'isDir': True, 'isNoise': False, 'noiseReason': '',
                         'hasNoise': False, 'fileCount': 0, 'noiseCount': 0,
                         'files': [], 'children': {}}
                node['children'][part] = child
            node = child
        node['files'].append(f)

    # 后序：目录级黑名单 → isNoise；再向上聚合 fileCount / noiseCount / hasNoise
    def aggregate(node):
        fc = len(node['files'])
        nc = sum(1 for f in node['files'] if f.get('noise'))
        for c in node['children'].values():
            cf, cn = aggregate(c)
            fc += cf
            nc += cn
        node['fileCount'] = fc
        node['noiseCount'] = nc
        # 自身命中黑名单 → isNoise
        if not node['isNoise']:
            for s in NOISE_DIR_SUBSTR:
                if s in node['name']:
                    node['isNoise'] = True
                    node['noiseReason'] = f'目录黑名单:{s}'
                    break
        node['hasNoise'] = (nc > 0) or any(c['isNoise'] or c['hasNoise']
                                        for c in node['children'].values())
        return fc, nc

    aggregate(root)
    return sort_tree(root)


def sort_tree(node):
    children = sorted(node['children'].values(), key=lambda n: n['relPath'])
    for c in children:
        sort_tree(c)
    node['children'] = children
    return node


def iter_tree(node):
    yield node
    for c in node['children']:
        yield from iter_tree(c)


if __name__ == '__main__':
    main()
