import fs from 'fs';
import path from 'path';

/**
 * 把本地目录里的 MP4 讲解视频关联到 PDF 书籍。
 *
 * 现实中的命名非常脏，例如：
 *   PDF : 【爱豆爱做题】初二人教秋下01邻等对补与角含半角模型【一手资源更新有保障联系sanniaowl】.pdf
 *   MP4 : 第1节 邻等对补与角含半角模型.mp4
 *   MP4 : 11.反比例函数K的几何意义(1).mp4 / 12.【真题易错】反比例函数K的几何意义.mp4
 * 所以匹配靠「归一化标题相似度 + 讲次序号」两条腿走路，而不是简单的字符串相等。
 */

export const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi'];

/** 置信度阈值：>= 该值自动选中，低于该值只作为候选展示 */
export const MATCH_THRESHOLD = 0.8;
/** 候选阈值：低于该值完全丢弃 */
export const CANDIDATE_THRESHOLD = 0.45;

export interface VideoFile {
  filePath: string;
  fileName: string;
  /** 去掉扩展名的文件名（展示用） */
  title: string;
  lessonNo: number | null;
  /** 归一化后的标题，用于相似度计算 */
  normTitle: string;
}

export interface VideoMatch {
  filePath: string;
  fileName: string;
  title: string;
  lessonNo: number | null;
  score: number;
  /** 是否默认选中入库 */
  selected: boolean;
}

/** 课型词，匹配前一律剔除 */
const LESSON_TYPE_WORDS = [
  '新知探索课', '新知探究课', '求知探索课', '题型方法课', '模型专题课', '模型观念课',
  '综合应用课', '构造策略课', '创新应用课', '视野拓展课', '真题易错', '阶段复习',
  '期中复习', '期末复习', '期中', '期末', '赠课', '分班考', '模考',
];

/** 文件名里出现这些词 → 整本讲义 / 合集 / 答案 */
const COLLECTION_KEYWORDS = [
  '讲义', '答案', '解析版', '练习册', '试卷', '真题', '汇总', '总结', '宝典', '手册',
];

/** 归一化后只剩这种"通名"→ 说明没有具体课题，属于整本合集 */
const GENERIC_TITLES = new Set([
  '解析', '答案', '习题', '练习', '题目', '测试', '正文', '讲义', '合集',
  '总复习', '做题', '爱豆爱做题', '爱做题', '爱豆习题', '数学', '课程',
]);

/** 讲次不会超过这个数，超了说明解析到的是年份/题号之类的噪声 */
const MAX_LESSON_NO = 60;

const RE_BRACKET = /【[^】]*】|《[^》]*》|（[^）]*）|\([^)]*\)|\[[^\]]*\]/g;
const RE_TIMESTAMP = /-?\d{10,}/g;
const RE_LESSON_TAG = /第\s*\d+\s*[讲次节]/g;
const RE_LEADING_NUM = /^\s*\d+[.、\s]*/;
const RE_LESSON_NO = /第\s*(\d+)\s*[讲次节]/;
const RE_TRAILING_NOISE = /(正文|无水印|题目版|答案版|水印版|\d+[-—]\d+页?)/g;

/**
 * 剥掉「年级 + 版本 + 班型 + 学期 + 序号」这类前缀噪声。
 * 例：初二人教A+秋下07 → 空；爱豆爱做题初二全国S秋下05 → 空
 */
const RE_NAME_PREFIX = new RegExp(
  '^(?:爱豆爱做题|爱豆习题)?[-—–\\s]*' +
  '(?:初[一二三]|高[一二三]|小[一二三四五六])?[-—–\\s]*' +
  '(?:人教版|人教[AB]?加?|北师[大]?版?|全国版?|苏教版?|沪科版?|浙教版?)?[-—–\\s]*' +
  '(?:A\\+班|A\\+|A加|A)?[-—–\\s]*' +
  '(?:S班|S)?[-—–\\s]*' +
  '(?:秋上|秋下|春上|春下|暑上|暑下|寒[假]?)?[-—–\\s]*' +
  '\\d{0,2}[-—–.\\s]*'
);

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** 相对路径（统一 / 分隔）→ 当前平台的绝对路径 */
export function resolveVideoPath(rootPath: string, relPath: string): string {
  if (!relPath) return rootPath;
  return path.resolve(rootPath, ...relPath.split('/').filter(Boolean));
}

/** 绝对路径 → 相对根目录的 posix 路径；不在根目录下时返回空串 */
export function toRelativePath(rootPath: string, filePath: string): string {
  const rel = path.relative(rootPath, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return toPosix(rel);
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

/** 归一化标题：只保留能区分「讲」的中文/英文字面 */
export function normalizeTitle(name: string): string {
  let s = path.basename(name);
  s = s.replace(/\.[^.]+$/, '');
  s = s.replace(RE_BRACKET, '');
  s = s.replace(RE_TIMESTAMP, '');
  s = s.replace(RE_LESSON_TAG, '');
  s = s.replace(/一手资源[^.]*联系\w*/g, '');
  for (const w of LESSON_TYPE_WORDS) s = s.split(w).join('');
  s = s.replace(RE_TRAILING_NOISE, '');
  s = s.replace(RE_LEADING_NUM, '');
  s = s.replace(RE_NAME_PREFIX, '');
  s = s.replace(/[^一-鿿A-Za-z]/g, '');
  return s.toLowerCase();
}

/** 解析讲次序号 */
export function parseLessonNo(name: string): number | null {
  const base = path.basename(name);
  const tagged = base.match(RE_LESSON_NO);
  if (tagged) return parseInt(tagged[1], 10);

  let s = base.replace(/\.[^.]+$/, '');
  s = s.replace(RE_BRACKET, '');
  s = s.replace(RE_TIMESTAMP, '');
  s = s.replace(/一手资源[^.]*联系\w*/g, '');
  s = s.replace(/^爱豆爱做题\s*[-—]?\s*/, '');
  s = s.replace(
    /^(?:初[一二三]|高[一二三]|小[一二三四五六])?(?:人教版|人教[AB]?加?|北师[大]?版?|全国版?|苏教版?|沪科版?|浙教版?)?(?:A\+班|A\+|A加|A\s)?(?:S班|S)?(?:秋上|秋下|春上|春下|暑上|暑下|寒[假]?)?/,
    ''
  );
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** 讲义 / 合集 / 答案类 PDF 无法精确对应单个视频，改为挂整本课程视频 */
export function isCollectionPdf(fileName: string, normTitle: string, lessonNo: number | null): boolean {
  const base = path.basename(fileName);
  if (COLLECTION_KEYWORDS.some((k) => base.includes(k))) return true;
  if (lessonNo !== null && lessonNo > MAX_LESSON_NO) return true;
  if (lessonNo === null && (normTitle === '' || GENERIC_TITLES.has(normTitle))) return true;
  return false;
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length < 2) {
    if (s) set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** 二元文法 Jaccard + 子串包含，取较高者 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const contains = a.includes(b) || b.includes(a) ? 0.9 : 0;
  return Math.max(jaccard, contains);
}

/** 递归收集视频文件 */
export function scanVideos(rootDir: string): VideoFile[] {
  const out: VideoFile[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (isVideoFile(entry.name)) {
        out.push({
          filePath: full,
          fileName: entry.name,
          title: entry.name.replace(/\.[^.]+$/, ''),
          lessonNo: parseLessonNo(entry.name),
          normTitle: normalizeTitle(entry.name),
        });
      }
    }
  };
  walk(rootDir);
  return out;
}

/** 课程分组：以「直接存放视频的目录」作为课程目录 */
function groupVideosByDir(videos: VideoFile[]): Map<string, VideoFile[]> {
  const map = new Map<string, VideoFile[]>();
  for (const v of videos) {
    const dir = path.dirname(v.filePath);
    const list = map.get(dir) || [];
    list.push(v);
    map.set(dir, list);
  }
  return map;
}

/** 从 PDF 所在目录逐级向上，找到最近的「有视频的目录」 */
function findCourseDir(pdfPath: string, videoDirs: Set<string>, rootDir: string): string | null {
  let dir = path.dirname(pdfPath);
  const root = path.resolve(rootDir);
  while (true) {
    if (videoDirs.has(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir || dir.length < root.length) break;
    dir = parent;
  }
  return null;
}

export interface PdfMatchInput {
  fullPath: string;
  fileName: string;
}

export interface PdfMatchResult extends PdfMatchInput {
  /** lesson = 对应某讲；course = 整本课程视频 */
  scope: 'lesson' | 'course';
  lessonNo: number | null;
  matches: VideoMatch[];
}

function compareVideos(a: VideoFile, b: VideoFile): number {
  const an = a.lessonNo ?? Number.MAX_SAFE_INTEGER;
  const bn = b.lessonNo ?? Number.MAX_SAFE_INTEGER;
  if (an !== bn) return an - bn;
  return a.fileName.localeCompare(b.fileName, 'zh-CN');
}

/**
 * 为一批 PDF 计算视频关联建议。
 * videos 传空数组时所有 PDF 的 matches 也为空。
 */
export function matchVideosToPdfs(
  rootDir: string,
  pdfs: PdfMatchInput[],
  videos: VideoFile[]
): PdfMatchResult[] {
  const byDir = groupVideosByDir(videos);
  const videoDirs = new Set(byDir.keys());

  return pdfs.map((pdf) => {
    const normTitle = normalizeTitle(pdf.fileName);
    const lessonNo = parseLessonNo(pdf.fileName);
    const isCollection = isCollectionPdf(pdf.fileName, normTitle, lessonNo);

    const courseDir = findCourseDir(pdf.fullPath, videoDirs, rootDir);
    const pool = courseDir ? [...(byDir.get(courseDir) || [])] : [];
    pool.sort(compareVideos);

    // 讲义 / 合集：直接挂整本课程的全部视频
    if (isCollection) {
      return {
        ...pdf,
        scope: 'course' as const,
        lessonNo,
        matches: pool.map((v) => ({
          filePath: v.filePath,
          fileName: v.fileName,
          title: v.title,
          lessonNo: v.lessonNo,
          score: 0,
          selected: true,
        })),
      };
    }

    const scored = pool.map((v) => {
      let score = similarity(normTitle, v.normTitle);
      if (lessonNo !== null && v.lessonNo !== null) {
        if (v.lessonNo === lessonNo) score = Math.max(score, 0.85);
        else if (Math.abs(v.lessonNo - lessonNo) === 1) score *= 0.6;
      }
      return { v, score };
    });

    const selected = scored.filter((s) => s.score >= MATCH_THRESHOLD);
    const source = selected.length > 0
      ? selected
      : scored.filter((s) => s.score >= CANDIDATE_THRESHOLD);
    const chosen = selected.length > 0 ? selected : source.slice(0, 3);

    // 保证稳定顺序：按讲次 / 文件名
    chosen.sort((a, b) => compareVideos(a.v, b.v));

    return {
      ...pdf,
      scope: 'lesson' as const,
      lessonNo,
      matches: chosen.map(({ v, score }) => ({
        filePath: v.filePath,
        fileName: v.fileName,
        title: v.title,
        lessonNo: v.lessonNo,
        score: Math.round(score * 100) / 100,
        selected: score >= MATCH_THRESHOLD,
      })),
    };
  });
}
