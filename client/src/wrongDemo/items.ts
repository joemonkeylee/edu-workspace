/**
 * 「错题本样例」静态清单 —— 一次性展示用，无数据库、无后端接口。
 *
 * 文件本体放在 client/wrong-demo-assets/（见 .gitignore），由 vite.config.ts 里的
 * localAssets 插件在 dev / preview 下映射到 /wrong-demo/*。生产构建不包含这批文件，
 * 因此这个页面只在本地开发环境可见。
 *
 * 要下线这个样例：删掉本目录 + App.tsx 里的两条路由 + AppHeaderRight 的入口，
 * 再删掉 client/wrong-demo-assets/ 即可，不留任何残留。
 */

import type { PdfBookDetail } from '../pdf/api/pdfClient';

/** 资源 URL 前缀，与 vite 插件注册的路径保持一致 */
const ASSET_BASE = '/wrong-demo';

export interface WrongDemoItem {
  /** URL 片段，同时是文件名主干：/wrong-demo/:slug */
  slug: string;
  /** 卡片标题 */
  title: string;
  /** 学科，用于分组与配色 */
  subject: string;
  /** 总页数，详情页显示 */
  pages: number;
  /** 科目卷次说明，展示在标题下方 */
  note: string;
  /** PDF 文件地址 */
  file: string;
  /** 封面缩略图地址（由 pdftoppm 只渲染第 1 页生成） */
  cover: string;
}

interface RawItem {
  slug: string;
  title: string;
  subject: string;
  pages: number;
  note: string;
}

const RAW: RawItem[] = [
  { slug: 'preface', title: '错题本前言', subject: '前言', pages: 2, note: '使用说明' },

  { slug: 'math-1', title: '数学（一）', subject: '数学', pages: 155, note: '上卷' },
  { slug: 'math-2', title: '数学（二）', subject: '数学', pages: 155, note: '下卷' },

  { slug: 'chemistry-1', title: '化学（一）', subject: '化学', pages: 106, note: '上卷' },
  { slug: 'chemistry-2', title: '化学（二）', subject: '化学', pages: 93, note: '下卷' },

  { slug: 'physics-1', title: '物理（一）', subject: '物理', pages: 102, note: '上卷' },
  { slug: 'physics-2', title: '物理（二）', subject: '物理', pages: 53, note: '下卷' },

  { slug: 'biology-1', title: '生物（一）', subject: '生物', pages: 146, note: '上卷' },
  { slug: 'biology-2', title: '生物（二）', subject: '生物', pages: 71, note: '下卷' },

  { slug: 'english', title: '英语', subject: '英语', pages: 112, note: '全一册' },
  { slug: 'chinese', title: '语文', subject: '语文', pages: 76, note: '全一册' },
];

export const WRONG_DEMO_ITEMS: WrongDemoItem[] = RAW.map((r) => ({
  ...r,
  file: `${ASSET_BASE}/${r.slug}.pdf`,
  cover: `${ASSET_BASE}/covers/${r.slug}.png`,
}));

/** 按 slug 取单条，找不到返回 undefined */
export function findWrongDemo(slug: string | undefined): WrongDemoItem | undefined {
  if (!slug) return undefined;
  return WRONG_DEMO_ITEMS.find((i) => i.slug === slug);
}

/** 学科展示顺序，与 RAW 中的出现顺序一致 */
export const WRONG_DEMO_SUBJECTS: string[] = RAW.reduce<string[]>((acc, r) => {
  if (!acc.includes(r.subject)) acc.push(r.subject);
  return acc;
}, []);

/** 各学科配色，用于卡片上的学科色块与强调色 */
export const SUBJECT_COLORS: Record<string, { fg: string; bg: string; dot: string }> = {
  前言: { fg: '#5F5E5A', bg: '#F1EFE8', dot: '#888780' },
  数学: { fg: '#185FA5', bg: '#E6F1FB', dot: '#378ADD' },
  化学: { fg: '#0F6E56', bg: '#E1F5EE', dot: '#1D9E75' },
  物理: { fg: '#534AB7', bg: '#EEEDFE', dot: '#7F77DD' },
  生物: { fg: '#3B6D11', bg: '#EAF3DE', dot: '#639922' },
  英语: { fg: '#993556', bg: '#FBEAF0', dot: '#D4537E' },
  语文: { fg: '#854F0B', bg: '#FAEEDA', dot: '#EF9F27' },
};

export function subjectColor(subject: string) {
  return SUBJECT_COLORS[subject] ?? SUBJECT_COLORS['前言'];
}

/** 样例的批次标记，只用于标识来源，不参与任何查询 */
export const WRONG_DEMO_BATCH = 'wrong-demo-local';

/**
 * 把静态清单里的一条样例拼成 `pdf_book` 行的形状，直接喂给 PDF 阅读器。
 *
 * 这样详情页就不用查库了 —— 阅读器拿到的是一个和 getBook() 返回结构一样的普通对象。
 * 相关字段说明：
 * - id 给 0：本地样例没有真实主键，阅读器在 local 模式下也不会拿它去发请求
 * - searchable 统一 'no_text'：前言的文本是好的，但数学/物理卷的字体映射是乱码
 *   （pdftotext 出来是 Კ᷌๜tTV 这种），索性按不可搜处理，避免搜出一屏乱码
 * - tocJson 为空数组：样例没有目录树，左侧栏在 local 模式下也不展示
 */
export function toPdfBookDetail(item: WrongDemoItem): PdfBookDetail {
  return {
    id: 0,
    title: item.title,
    category: '错题本',
    grade: '',
    subject: item.subject,
    totalPages: item.pages,
    coverPage: 1,
    searchable: 'no_text',
    missing: false,
    pdfKind: 'pdf',
    fileSize: 0,
    batchId: WRONG_DEMO_BATCH,
    createdAt: new Date(0).toISOString(),
    isFavorite: false,
    filePath: '',
    rootPath: '',
    relPath: '',
    fileHash: null,
    pageSizes: null,
    textStats: null,
    textExtracted: false,
    tocSource: 'none',
    tocJson: [],
    attributes: {},
    fileUrl: item.file,
    coverUrl: item.cover,
    pairSummary: null,
  };
}
