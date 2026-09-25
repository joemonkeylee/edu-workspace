import type { DictMeta } from './types';

/**
 * 内置词库清单。
 * JSON 数据来自 qwerty-learner（MIT）的 public/dicts，已按需挑选并放置到
 * client/public/dicts 下。length 为实际词条数，用于计算章节数。
 */
export const DICTIONARIES: DictMeta[] = [
  {
    id: 'cet4',
    name: 'CET-4 四级',
    description: '大学英语四级核心词汇',
    category: '国内考试',
    url: '/dicts/CET4_T.json',
    length: 2607,
  },
  {
    id: 'cet6',
    name: 'CET-6 六级',
    description: '大学英语六级核心词汇',
    category: '国内考试',
    url: '/dicts/CET6_T.json',
    length: 2345,
  },
  {
    id: 'cet4-sub',
    name: '四级词根助记',
    description: '按词根归类的四级词汇',
    category: '国内考试',
    url: '/dicts/DanCiDeJianFa_4.json',
    length: 1957,
  },
  {
    id: 'pets3',
    name: 'PETS 三级',
    description: '全国英语等级考试三级',
    category: '国内考试',
    url: '/dicts/PETS_3.json',
    length: 1942,
  },
  {
    id: 'level4',
    name: '英语专四',
    description: '英语专业四级词汇',
    category: '国内考试',
    url: '/dicts/Level4luan_2_T.json',
    length: 4025,
  },
  {
    id: 'kaoyan',
    name: '考研英语',
    description: '考研英语核心词汇',
    category: '国内考试',
    url: '/dicts/KaoYan_3_T.json',
    length: 3728,
  },
  {
    id: 'kaoyan-hongbao',
    name: '考研红宝书 2025',
    description: '考研英语词汇红宝书',
    category: '国内考试',
    url: '/dicts/2025KaoYanHongBaoShu.json',
    length: 6705,
  },
  {
    id: 'ielts',
    name: 'IELTS 雅思',
    description: '雅思核心词汇',
    category: '出国考试',
    url: '/dicts/IELTS_3_T.json',
    length: 3575,
  },
  {
    id: 'toefl',
    name: 'TOEFL 托福',
    description: '张红岩托福词汇',
    category: '出国考试',
    url: '/dicts/TOEFL_ZhangHongYan.json',
    length: 4032,
  },
  {
    id: 'gre3000',
    name: 'GRE 3000',
    description: 'GRE 核心 3000 词',
    category: '出国考试',
    url: '/dicts/GRE3000_3_T.json',
    length: 3041,
  },
  {
    id: 'gmat',
    name: 'GMAT',
    description: 'GMAT 核心词汇',
    category: '出国考试',
    url: '/dicts/GMAT_3_T.json',
    length: 3047,
  },
  {
    id: 'oxford5000',
    name: '牛津 5000',
    description: '牛津高频 5000 词',
    category: '能力提升',
    url: '/dicts/Oxford5000.json',
    length: 5836,
  },
];

export const DICT_MAP: Record<string, DictMeta> = Object.fromEntries(
  DICTIONARIES.map((d) => [d.id, d]),
);

export const DICT_CATEGORIES: string[] = Array.from(new Set(DICTIONARIES.map((d) => d.category)));

export function getDict(id: string): DictMeta {
  return DICT_MAP[id] ?? DICTIONARIES[0];
}
