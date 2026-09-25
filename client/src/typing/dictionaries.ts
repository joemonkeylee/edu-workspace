import type { DictMeta } from './types';

/**
 * 内置词库清单，由原版 qwerty-learner public/dicts 自动生成。
 *
 * 想加新词库：把 JSON 放进 client/public/dicts/，再往下面的数组加一条即可。
 * 展示顺序不用管 —— `DICT_GROUPS` 会按 CATEGORY_ORDER 分类、
 * 每个分类内 FEATURED_DICT_IDS 里的常用词库置顶、其余按名称自然序排列。
 */

/** 分类展示顺序：按受众广度与常用度排列 */
export const CATEGORY_ORDER = [
  '中国考试',
  '国际考试',
  '青少年英语',
  '英语词典',
  '专业词汇',
  '代码练习',
] as const;

/** 各分类内置顶的高频词库，按数组顺序排在该分类最前面 */
export const FEATURED_DICT_IDS: Record<string, readonly string[]> = {
  中国考试: ['cet4', 'cet6', 'kaoyan', 'level4', 'level8', 'pets3'],
  国际考试: ['ielts', 'toefl', 'gre', 'gmat', 'sat', 'Oxford3000', 'Oxford5000', 'TOEIC'],
  青少年英语: ['gaokao3500', 'zhongkaohexin', 'nce1', 'nce2', 'nce3', 'nce4', 'raz-all'],
  英语词典: ['roger'],
  专业词汇: ['biomedical-terms', 'itVocabulary', 'archVocabulary'],
  代码练习: ['coder', 'ai-machine-learning', 'ai-ai-for-science'],
};

export const DICTIONARIES: DictMeta[] = [
  // ── 中国考试（46）──
  { id: 'cet4', name: 'CET-4', description: '大学英语四级词库', category: '中国考试', url: '/dicts/CET4_T.json', length: 2607 },
  { id: 'cet6', name: 'CET-6', description: '大学英语六级词库', category: '中国考试', url: '/dicts/CET6_T.json', length: 2345 },
  { id: 'kaoyan', name: '考研', description: '研究生英语入学考试词库', category: '中国考试', url: '/dicts/KaoYan_3_T.json', length: 3728 },
  { id: 'level4', name: '专四', description: '英语专业四级词库', category: '中国考试', url: '/dicts/Level4luan_2_T.json', length: 4025 },
  { id: 'level8', name: '专八', description: '英语专业八级词库', category: '中国考试', url: '/dicts/Level8luan_2_T.json', length: 12197 },
  { id: 'pets3', name: 'PETS', description: '全国英语等级考试常考词汇', category: '中国考试', url: '/dicts/PETS_3.json', length: 1942 },
  { id: '2024HongBao T1', name: '2024考研英语hongbaoshu(上)', description: '2024考研英语hongbaoshu必考词（上）', category: '中国考试', url: '/dicts/2024HongBao_T1.json', length: 997 },
  { id: '2024HongBao T2', name: '2024考研英语hongbaoshu(下)', description: '2024考研英语hongbaoshu必考词（下）', category: '中国考试', url: '/dicts/2024HongBao_T2.json', length: 854 },
  { id: '2025KaoYanHongBaoShu', name: '2025考研英语词汇hongbao书', description: '2025考研英语词汇hongbao书', category: '中国考试', url: '/dicts/2025KaoYanHongBaoShu.json', length: 6705 },
  { id: 'hongbaoshu-2026', name: '2026考研英语 hongbaoshu', description: '2026 考研词汇 (必考词+基础词+超纲词）', category: '中国考试', url: '/dicts/hongbaoshu-2026.json', length: 4858 },
  { id: 'cet4-sub', name: 'CET-4-Sub', description: '单词的减法-四级', category: '中国考试', url: '/dicts/DanCiDeJianFa_4.json', length: 1957 },
  { id: 'cet6-sub', name: 'CET-6-Sub', description: '单词的减法-六级', category: '中国考试', url: '/dicts/DanCiDeJianFa_6.json', length: 1949 },
  { id: 'coca_20000', name: 'COCA20000词', description: 'COCA20000词', category: '中国考试', url: '/dicts/coca20000.json', length: 20199 },
  { id: '4000_Essential_English_Words1', name: 'Essential Words', description: '4000 Essential English Words meaning', category: '中国考试', url: '/dicts/4000_Essential_English_Words-meaning.json', length: 3600 },
  { id: '4000_Essential_English_Words2', name: 'Essential Words', description: '4000 Essential English Words sentence', category: '中国考试', url: '/dicts/4000_Essential_English_Words-sentence.json', length: 3600 },
  { id: 'longman_communication_3000_words', name: 'Longman Communication 3000', description: 'Most frequent words in both spoken and written English', category: '中国考试', url: '/dicts/Longman_Communication_3000.json', length: 3168 },
  { id: 'pets3-2023', name: 'PETS-2023', description: '全国英语等级考试常考词汇', category: '中国考试', url: '/dicts/PETS3-2023.json', length: 4449 },
  { id: 'suffix word', name: 'suffix word', description: 'common suffix', category: '中国考试', url: '/dicts/suffix_word.json', length: 126 },
  { id: 'top_50_Prepositions', name: 'Top 50 prep.', description: 'with highest frequency', category: '中国考试', url: '/dicts/Top50Prepositions.json', length: 46 },
  { id: 'top_60_Pronouns', name: 'Top 60 pron.', description: 'with highest frequency', category: '中国考试', url: '/dicts/Top60Pronouns.json', length: 59 },
  { id: 'top_250_Adv_Words', name: 'Top 250 adv.', description: 'with highest frequency', category: '中国考试', url: '/dicts/Top250AdverbWords.json', length: 255 },
  { id: 'top_500_Adj_Words', name: 'Top 500 adj.', description: 'with highest frequency', category: '中国考试', url: '/dicts/Top500AdjectiveWords.json', length: 527 },
  { id: 'top_1000_verb_Words', name: 'Top 1000 Verbs', description: 'with highest frequency', category: '中国考试', url: '/dicts/Top1000VerbWords.json', length: 1011 },
  { id: 'top_1500_nouns_Words', name: 'Top 1500 Nouns', description: 'with highest frequency', category: '中国考试', url: '/dicts/Top1500NounWords.json', length: 1525 },
  { id: 'top_2000_English_Words', name: 'Top 2000 words', description: 'with highest frequency', category: '中国考试', url: '/dicts/top2000words.json', length: 1867 },
  { id: 'word roots1', name: 'word roots1', description: 'common roots', category: '中国考试', url: '/dicts/word_roots1.json', length: 369 },
  { id: '3000_ClassRoom_English_Words', name: '专升本3000词', description: '专升本词汇', category: '中国考试', url: '/dicts/3000_ClassRoom_English_Words.json', length: 2991 },
  { id: 'zhuan-sheng-ben-xue-shi', name: '专升本学士学位的英语', description: '专升本学士学位的英语', category: '中国考试', url: '/dicts/xueshiyingyu.json', length: 897 },
  { id: 'adult self-study examination', name: '专升本词汇', description: '专升本词汇', category: '中国考试', url: '/dicts/adult-self-study-examination.json', length: 3692 },
  { id: 'zhuan-cha-ben-ying-yu', name: '专插本英语词汇', description: '专插本英语词汇', category: '中国考试', url: '/dicts/zhuan-cha-ben.json', length: 3217 },
  { id: 'xinghuoqiaoji_6', name: '六级巧记速记', description: '六级巧记速记', category: '中国考试', url: '/dicts/xinghuoqiaoji_6.json', length: 7520 },
  { id: 'dancimimi_1', name: '单词的秘密-英语一', description: '单词的秘密英语（一）', category: '中国考试', url: '/dicts/DanCiDeMimi_1.json', length: 5657 },
  { id: 'dancimimi_2', name: '单词的秘密-英语二', description: '单词的秘密英语（二）', category: '中国考试', url: '/dicts/DanCiDeMimi_2.json', length: 3827 },
  { id: 'tingshuokaoshi', name: '听说考试常见词汇', description: '听说考试16个场景常见词汇量', category: '中国考试', url: '/dicts/tingshuokaoshi.json', length: 557 },
  { id: 'xinghuoqiaoji_4', name: '四级巧记速记', description: '四级巧记速记', category: '中国考试', url: '/dicts/xinghuoqiaoji_4.json', length: 2522 },
  { id: 'kaoyan_2024', name: '考研 2024', description: '研究生英语入学考试词库 2024', category: '中国考试', url: '/dicts/KaoYan_2024.json', length: 3731 },
  { id: 'kaoyanshanguo2025', name: '考研 shanguo 2025', description: '考研 shanguo 2025', category: '中国考试', url: '/dicts/kaoyanshanguo2025.json', length: 2257 },
  { id: 'kaoyanshanguo_2023', name: '考研闪过 2023', description: '高中低频词2023', category: '中国考试', url: '/dicts/KaoYanShanGuo_2023.json', length: 1771 },
  { id: 'self-study_English1', name: '自考1800高频单词', description: '自考1800高频单词', category: '中国考试', url: '/dicts/self-study_English1.json', length: 1800 },
  { id: 'self-study_English3', name: '自考英语二完整单词', description: '00015自考英语二完整单词书', category: '中国考试', url: '/dicts/self-study_English3.json', length: 4603 },
  { id: 'self-study_English2', name: '自考英语二高频悠悠单词', description: '自考英语二高频悠悠单词', category: '中国考试', url: '/dicts/self-study_English2.json', length: 2181 },
  { id: 'English_II', name: '英语二单词书', description: '考研英语二单词书', category: '中国考试', url: '/dicts/English_II.json', length: 4559 },
  { id: 'frequently_used_words01', name: '超频单词level 1', description: '超频单词level 1', category: '中国考试', url: '/dicts/frequently_used_word01.json', length: 679 },
  { id: 'frequently_used_words02', name: '超频单词level 2', description: '超频单词level 2', category: '中国考试', url: '/dicts/frequently_used_word02.json', length: 1040 },
  { id: 'Merriam_Webster_sVocabularyBuilder', name: '韦氏词根词典', description: '韦氏词根词典', category: '中国考试', url: '/dicts/Merriam_Webster_sVocabularyBuilder.json', length: 1191 },
  { id: 'Macmillan7000', name: '麦克米伦7000', description: '麦克米伦7000', category: '中国考试', url: '/dicts/Macmillan7000.json', length: 6268 },

  // ── 国际考试（96）──
  { id: 'ielts', name: 'IELTS', description: '雅思词库', category: '国际考试', url: '/dicts/IELTS_3_T.json', length: 3575 },
  { id: 'toefl', name: 'TOEFL', description: '托福考试常见词', category: '国际考试', url: '/dicts/TOEFL_3_T.json', length: 4264 },
  { id: 'gre', name: 'GRE', description: 'GRE 词库', category: '国际考试', url: '/dicts/GRE_3_T.json', length: 6515 },
  { id: 'gmat', name: 'GMAT', description: 'GMAT 词库', category: '国际考试', url: '/dicts/GMAT_3_T.json', length: 3047 },
  { id: 'sat', name: 'SAT', description: '美国 SAT 考试词库', category: '国际考试', url: '/dicts/SAT_3_T.json', length: 4464 },
  { id: 'Oxford3000', name: '牛津3000词', description: '牛津3000词', category: '国际考试', url: '/dicts/Oxford3000.json', length: 1342 },
  { id: 'Oxford5000', name: '牛津5000词', description: '牛津5000词', category: '国际考试', url: '/dicts/Oxford5000.json', length: 5836 },
  { id: 'TOEIC', name: 'TOEIC 词汇', description: '', category: '国际考试', url: '/dicts/TOEIC.json', length: 1694 },
  { id: 'IELTSXDF7000', name: '100个句子记完7000个雅思单词', description: 'xdf 100个句子记完7000个雅思单词 词汇表', category: '国际考试', url: '/dicts/IELTS_XDF_7000.json', length: 5567 },
  { id: 'bec3', name: 'BEC', description: 'BEC考试常见词', category: '国际考试', url: '/dicts/BEC_3_T.json', length: 2825 },
  { id: 'Categorized_TOEFL_Vocabulary_by_Zhanghongyan', name: 'Categorized Vocab.', description: '词以类记 TOEFL 2021 by ZhangHongYan (原书释义和助记; 单词序号)', category: '国际考试', url: '/dicts/Categorized_TOEFL_Vocabulary_by_Zhanghongyan.json', length: 4123 },
  { id: 'Common-Phrases-FCE-Unofficial', name: 'FCE 常用短语 (非官方)', description: 'FCE 常用短语', category: '国际考试', url: '/dicts/Common-Phrases-FCE-Unofficial.json', length: 438 },
  { id: 'gre3000', name: 'GRE3000', description: 'GRE3000 词库', category: '国际考试', url: '/dicts/GRE3000_3_T.json', length: 3041 },
  { id: 'GRE-computer-based-test', name: 'GRE机经词汇', description: 'GRE机经词汇', category: '国际考试', url: '/dicts/GRE-computer-based-test.json', length: 1451 },
  { id: 'GRE_equivalent', name: 'GRE等价词', description: 'GRE等价词', category: '国际考试', url: '/dicts/GRE_equivalent.json', length: 827 },
  { id: 'GRE_ciyileiji', name: 'GRE词以类记', description: 'GRE词以类记', category: '国际考试', url: '/dicts/gre-ciyileiji.json', length: 8785 },
  { id: 'gre1500', name: 'GRE重点1500词-fen哥', description: 'GRE & TEM8 重叠高频词汇', category: '国际考试', url: '/dicts/GRE_1500.json', length: 1533 },
  { id: 'heqiong', name: 'heQiong雅思听力必考词汇', description: '综合测试', category: '国际考试', url: '/dicts/HeQiong_IELTS.json', length: 2529 },
  { id: 'ielts_disorder', name: 'IELTS乱序完整版', description: 'IELTS乱序完整版', category: '国际考试', url: '/dicts/IELTS_disorder.json', length: 9389 },
  { id: 'ielts_order', name: 'IELTS顺序完整版', description: 'IELTS顺序完整版', category: '国际考试', url: '/dicts/IELTS_order.json', length: 9389 },
  { id: 'ket', name: 'KET', description: 'KET 2021单词', category: '国际考试', url: '/dicts/ket2021.json', length: 1147 },
  { id: 'pet-2024', name: 'PET-2024', description: '剑桥英语 - 2024', category: '国际考试', url: '/dicts/pet-vacabulary-list-2024.json', length: 1871 },
  { id: 'PTE_WFDgaopinci.json', name: 'PTE WFD高频词汇', description: 'WFD高频词汇从高到低，最低掌握350个', category: '国际考试', url: '/dicts/PTE_WFDgaopinci.json', length: 1175 },
  { id: 'PTE_Listening_apeuni.json', name: 'PTE 听力FIB机经词汇 xingji', description: '', category: '国际考试', url: '/dicts/PTE_Listening_apeuni.json', length: 674 },
  { id: 'PTE_junior', name: 'PTE 基础词汇', description: '', category: '国际考试', url: '/dicts/PTE_junior.json', length: 2651 },
  { id: 'PTE_Basic_apeuni', name: 'PTE 基础词汇 xingji', description: '', category: '国际考试', url: '/dicts/PTE_Basic_apeuni.json', length: 2652 },
  { id: 'Common-Phrases-PTE-Unofficial', name: 'PTE 常用短语 (非官方)', description: 'PTE 常用短语', category: '国际考试', url: '/dicts/Common-Phrases-PTE-Unofficial.json', length: 274 },
  { id: 'PTE_Read_apeuni.json', name: 'PTE 阅读FIB机经词汇 xingji', description: '', category: '国际考试', url: '/dicts/PTE_Read_apeuni.json', length: 630 },
  { id: 'PTE_senior', name: 'PTE 高阶词汇', description: '', category: '国际考试', url: '/dicts/PTE_senior.json', length: 3170 },
  { id: 'PTE_Advanced_apeuni.json', name: 'PTE 高阶词汇 xingji', description: '', category: '国际考试', url: '/dicts/PTE_Advanced_apeuni.json', length: 3169 },
  { id: 'SATen', name: 'SAT en-en', description: 'SAT英英', category: '国际考试', url: '/dicts/SATen.json', length: 2681 },
  { id: 'voa', name: 'VOA 基础词库', description: 'VOA 基础词库', category: '国际考试', url: '/dicts/voa.json', length: 1505 },
  { id: 'IELTSKingLu807', name: 'wanglu807雅思词汇听力第2版', description: 'wanglu807雅思词汇听力第2版', category: '国际考试', url: '/dicts/IELTSKingLu807.json', length: 1916 },
  { id: 'PTE_WFD', name: 'WFD 机经词汇', description: '', category: '国际考试', url: '/dicts/PTE_WFD.json', length: 1212 },
  { id: 'IELTS-listening-NeworientalDirect-Task1', name: 'xdf听力 雅思中级直通车 day1', description: 'xdf听力 雅思中级直通车 day1', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task1.json', length: 44 },
  { id: 'IELTS-listening-NeworientalDirect-Task2', name: 'xdf听力 雅思中级直通车 day2', description: 'xdf听力 雅思中级直通车 day2', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task2.json', length: 33 },
  { id: 'IELTS-listening-NeworientalDirect-Task3', name: 'xdf听力 雅思中级直通车 day3', description: 'xdf听力 雅思中级直通车 day3', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task3.json', length: 33 },
  { id: 'IELTS-listening-NeworientalDirect-Task4', name: 'xdf听力 雅思中级直通车 day4', description: 'xdf听力 雅思中级直通车 day4', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task4.json', length: 33 },
  { id: 'IELTS-listening-NeworientalDirect-Task5', name: 'xdf听力 雅思中级直通车 day5', description: 'xdf听力 雅思中级直通车 day5', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task5.json', length: 38 },
  { id: 'IELTS-listening-NeworientalDirect-Task6', name: 'xdf听力 雅思中级直通车 day6', description: 'xdf听力 雅思中级直通车 day6', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task6.json', length: 33 },
  { id: 'IELTS-listening-NeworientalDirect-Task7', name: 'xdf听力 雅思中级直通车 day7', description: 'xdf听力 雅思中级直通车 day7', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task7.json', length: 39 },
  { id: 'IELTS-listening-NeworientalDirect-Task8', name: 'xdf听力 雅思中级直通车 day8', description: 'xdf听力 雅思中级直通车 day8', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task8.json', length: 32 },
  { id: 'IELTS-listening-NeworientalDirect-Task9', name: 'xdf听力 雅思中级直通车 day9', description: 'xdf听力 雅思中级直通车 day9', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task9.json', length: 46 },
  { id: 'IELTS-listening-NeworientalDirect-Task10', name: 'xdf听力 雅思中级直通车 day10', description: 'xdf听力 雅思中级直通车 day10', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task10.json', length: 44 },
  { id: 'IELTS-listening-NeworientalDirect-Task11', name: 'xdf听力 雅思中级直通车 day11', description: 'xdf听力 雅思中级直通车 day11', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task11.json', length: 36 },
  { id: 'IELTS-listening-NeworientalDirect-Task12', name: 'xdf听力 雅思中级直通车 day12', description: 'xdf听力 雅思中级直通车 day12', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task12.json', length: 45 },
  { id: 'IELTS-listening-NeworientalDirect-Task13', name: 'xdf听力 雅思中级直通车 day13', description: 'xdf听力 雅思中级直通车 day13', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task13.json', length: 49 },
  { id: 'IELTS-listening-NeworientalDirect-Task14', name: 'xdf听力 雅思中级直通车 day14', description: 'xdf听力 雅思中级直通车 day14', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task14.json', length: 46 },
  { id: 'IELTS-listening-NeworientalDirect-Task15', name: 'xdf听力 雅思中级直通车 day15', description: 'xdf听力 雅思中级直通车 day15', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task15.json', length: 29 },
  { id: 'IELTS-listening-NeworientalDirect-Task16', name: 'xdf听力 雅思中级直通车 day16', description: 'xdf听力 雅思中级直通车 day16', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task16.json', length: 42 },
  { id: 'IELTS-listening-NeworientalDirect-Task17', name: 'xdf听力 雅思中级直通车 day17', description: 'xdf听力 雅思中级直通车 day17', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task17.json', length: 22 },
  { id: 'IELTS-listening-NeworientalDirect-Task18', name: 'xdf听力 雅思中级直通车 day18', description: 'xdf听力 雅思中级直通车 day18', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task18.json', length: 37 },
  { id: 'IELTS-listening-NeworientalDirect-Task19', name: 'xdf听力 雅思中级直通车 day19', description: 'xdf听力 雅思中级直通车 day19', category: '国际考试', url: '/dicts/IELTS-listening-NewOrientalDirect-Task19.json', length: 26 },
  { id: 'TOEFL_ZhangHongYan', name: 'ZhangHongYan的TOEFL词汇书', description: 'ZhangHongYan的TOEFL词汇书-词以类记', category: '国际考试', url: '/dicts/TOEFL_ZhangHongYan.json', length: 4032 },
  { id: 'ZaiYaoNiMing_GRE3000', name: '再要你命GRE3000', description: '再要你命GRE3000词库-有词性新版', category: '国际考试', url: '/dicts/ZaiYaoNiMing_GRE3000.json', length: 3041 },
  { id: 'PTE_FIB_L', name: '听力 FIB 机经词汇', description: '', category: '国际考试', url: '/dicts/PTE_FIB_L.json', length: 646 },
  { id: 'bec2', name: '商务英语', description: '商务英语常见词', category: '国际考试', url: '/dicts/BEC_2_T.json', length: 2753 },
  { id: 'Duolingo_Vocabulary_B1', name: '多邻国分级词汇B1', description: '多邻国分级词汇B1', category: '国际考试', url: '/dicts/Duolingo_Vocabulary_B1.json', length: 801 },
  { id: 'Duolingo_Vocabulary_B2', name: '多邻国分级词汇B2', description: '多邻国分级词汇B2', category: '国际考试', url: '/dicts/Duolingo_Vocabulary_B2.json', length: 1423 },
  { id: 'Duolingo_Vocabulary_C1', name: '多邻国分级词汇C1', description: '多邻国分级词汇C1', category: '国际考试', url: '/dicts/Duolingo_Vocabulary_C1.json', length: 1314 },
  { id: 'PTE_FIB_R_junior', name: '阅读 FIB 基础机经词汇', description: '', category: '国际考试', url: '/dicts/PTE_FIB_R_junior.json', length: 941 },
  { id: 'PTE_FIB_R_senior', name: '阅读 FIB 高阶机经词汇', description: '', category: '国际考试', url: '/dicts/PTE_FIB_R_senior.json', length: 1272 },
  { id: 'IELTS9988wangyong', name: '雅思9988wangyong', description: '雅思9988wangyong', category: '国际考试', url: '/dicts/IELTS9988wangyong.json', length: 3698 },
  { id: 'ielts-real-1', name: '雅思 real 词汇 1', description: '雅思 real 词汇 （1频词汇及变频）', category: '国际考试', url: '/dicts/ielts-real-1.json', length: 737 },
  { id: 'ielts-real-2', name: '雅思 real 词汇 2', description: '雅思 real 词汇 （2频词汇及变频）', category: '国际考试', url: '/dicts/ielts-real-2.json', length: 402 },
  { id: 'ielts-real-3', name: '雅思 real 词汇 3', description: '雅思 real 词汇 （3频词汇及变频）', category: '国际考试', url: '/dicts/ielts-real-3.json', length: 256 },
  { id: 'ielts-real-4', name: '雅思 real 词汇 4', description: '雅思 real 词汇 （4频词汇及变频）', category: '国际考试', url: '/dicts/ielts-real-4.json', length: 201 },
  { id: 'ielts-real-5', name: '雅思 real 词汇 5', description: '雅思 real 词汇 （5频词汇及变频）', category: '国际考试', url: '/dicts/ielts-real-5.json', length: 183 },
  { id: 'ielts-real-high', name: '雅思 real 词汇 高频', description: '雅思 real 词汇（高频词汇）', category: '国际考试', url: '/dicts/ielts-real-high.json', length: 524 },
  { id: 'IELTS-807', name: '雅思 wanglu 807', description: '雅思 wanglu 807', category: '国际考试', url: '/dicts/ielts-807.json', length: 4340 },
  { id: 'ieltsWang3', name: '雅思wang C3', description: '雅思听力特别名词语料库', category: '国际考试', url: '/dicts/IELTS_WANG_3.json', length: 1135 },
  { id: 'ieltsWang4', name: '雅思wang C4', description: '雅思听力形容词副词语料库', category: '国际考试', url: '/dicts/IELTS_WANG_4.json', length: 346 },
  { id: 'ieltsWang5', name: '雅思wang C5', description: '吞音连读混合训练语料库', category: '国际考试', url: '/dicts/IELTS_WANG_5.json', length: 1569 },
  { id: 'ieltsWang11', name: '雅思wang C11', description: '综合测试', category: '国际考试', url: '/dicts/IELTS_WANG_11.json', length: 1738 },
  { id: 'IELTS-oral-900', name: '雅思口语 900 beta版', description: '雅思口语 900 句, 需在 qwerty 设置中调小英语字体', category: '国际考试', url: '/dicts/IELTS-oral-900.json', length: 900 },
  { id: 'IELTS_tinglichangjing', name: '雅思听力场景词汇', description: '雅思听力场景词汇', category: '国际考试', url: '/dicts/IELTS_tinglichangjing.json', length: 1204 },
  { id: 'IELTS-listening-18-days-1', name: '雅思听力词汇18天 day1', description: '雅思听力词汇18天 day1', category: '国际考试', url: '/dicts/IELTS-listening-18days-day1.json', length: 74 },
  { id: 'IELTS-listening-18-days-2', name: '雅思听力词汇18天 day2', description: '雅思听力词汇18天 day2', category: '国际考试', url: '/dicts/IELTS-listening-18days-day2.json', length: 77 },
  { id: 'IELTS-listening-18-days-3', name: '雅思听力词汇18天 day3', description: '雅思听力词汇18天 day3', category: '国际考试', url: '/dicts/IELTS-listening-18days-day3.json', length: 77 },
  { id: 'IELTS-listening-18-days-4', name: '雅思听力词汇18天 day4', description: '雅思听力词汇18天 day4', category: '国际考试', url: '/dicts/IELTS-listening-18days-day4.json', length: 73 },
  { id: 'IELTS-listening-18-days-5', name: '雅思听力词汇18天 day5', description: '雅思听力词汇18天 day5', category: '国际考试', url: '/dicts/IELTS-listening-18days-day5.json', length: 76 },
  { id: 'IELTS-listening-18-days-6', name: '雅思听力词汇18天 day6', description: '雅思听力词汇18天 day6', category: '国际考试', url: '/dicts/IELTS-listening-18days-day6.json', length: 77 },
  { id: 'IELTS-listening-18-days-7', name: '雅思听力词汇18天 day7', description: '雅思听力词汇18天 day7', category: '国际考试', url: '/dicts/IELTS-listening-18days-day7.json', length: 75 },
  { id: 'IELTS-listening-18-days-8', name: '雅思听力词汇18天 day8', description: '雅思听力词汇18天 day8', category: '国际考试', url: '/dicts/IELTS-listening-18days-day8.json', length: 76 },
  { id: 'IELTS-listening-18-days-9', name: '雅思听力词汇18天 day9', description: '雅思听力词汇18天 day9', category: '国际考试', url: '/dicts/IELTS-listening-18days-day9.json', length: 76 },
  { id: 'IELTS-listening-18-days-10', name: '雅思听力词汇18天 day10', description: '雅思听力词汇18天 day10', category: '国际考试', url: '/dicts/IELTS-listening-18days-day10.json', length: 33 },
  { id: 'IELTS-listening-18-days-11', name: '雅思听力词汇18天 day11', description: '雅思听力词汇18天 day11', category: '国际考试', url: '/dicts/IELTS-listening-18days-day11.json', length: 52 },
  { id: 'IELTS-listening-18-days-12', name: '雅思听力词汇18天 day12', description: '雅思听力词汇18天 day12', category: '国际考试', url: '/dicts/IELTS-listening-18days-day12.json', length: 77 },
  { id: 'IELTS-listening-18-days-13', name: '雅思听力词汇18天 day13', description: '雅思听力词汇18天 day13', category: '国际考试', url: '/dicts/IELTS-listening-18days-day13.json', length: 78 },
  { id: 'IELTS-listening-18-days-14', name: '雅思听力词汇18天 day14', description: '雅思听力词汇18天 day14', category: '国际考试', url: '/dicts/IELTS-listening-18days-day14.json', length: 76 },
  { id: 'IELTS-listening-18-days-15', name: '雅思听力词汇18天 day15', description: '雅思听力词汇18天 day15', category: '国际考试', url: '/dicts/IELTS-listening-18days-day15.json', length: 77 },
  { id: 'IELTS-listening-18-days-16', name: '雅思听力词汇18天 day16', description: '雅思听力词汇18天 day16', category: '国际考试', url: '/dicts/IELTS-listening-18days-day16.json', length: 77 },
  { id: 'IELTS-listening-18-days-17', name: '雅思听力词汇18天 day17', description: '雅思听力词汇18天 day17', category: '国际考试', url: '/dicts/IELTS-listening-18days-day17.json', length: 46 },
  { id: 'IELTS-listening-18-days-18', name: '雅思听力词汇18天 day18', description: '雅思听力词汇18天 day18', category: '国际考试', url: '/dicts/IELTS-listening-18days-day18.json', length: 76 },
  { id: 'IELTSVocabularyBible', name: '雅思词汇真经', description: '雅思词汇真经', category: '国际考试', url: '/dicts/IELTSVocabularyBible.json', length: 3673 },
  { id: 'DuckCircle_IELTS', name: '鸭圈雅思核心词', description: '鸭圈雅思核心词', category: '国际考试', url: '/dicts/DuckCircle_IELTS.json', length: 2644 },

  // ── 青少年英语（156）──
  { id: 'gaokao3500', name: '高考 3500 词', description: '高考常见词 3500', category: '青少年英语', url: '/dicts/GaoKao_3500.json', length: 3893 },
  { id: 'zhongkaohexin', name: '中考核心词', description: '中考核心词', category: '青少年英语', url: '/dicts/ZhongKaoHeXin.json', length: 2140 },
  { id: 'nce1', name: '新概念英语-1', description: '新概念英语第一册', category: '青少年英语', url: '/dicts/NCE_1.json', length: 900 },
  { id: 'nce2', name: '新概念英语-2', description: '新概念英语第二册', category: '青少年英语', url: '/dicts/NCE_2.json', length: 858 },
  { id: 'nce3', name: '新概念英语-3', description: '新概念英语第三册', category: '青少年英语', url: '/dicts/NCE_3.json', length: 1052 },
  { id: 'nce4', name: '新概念英语-4', description: '新概念英语第四册', category: '青少年英语', url: '/dicts/NCE_4.json', length: 784 },
  { id: 'raz-all', name: 'RAZ 分级阅读 所有词汇', description: 'RAZ 分级阅读 所有词汇', category: '青少年英语', url: '/dicts/raz-all.json', length: 5831 },
  { id: 'eflevel1', name: 'EF-LEVEL-1', description: 'EF等级1', category: '青少年英语', url: '/dicts/EF_LEVEL_1.json', length: 297 },
  { id: 'eflevel2', name: 'EF-LEVEL-2', description: 'EF等级2', category: '青少年英语', url: '/dicts/EF_LEVEL_2.json', length: 353 },
  { id: 'eflevel3', name: 'EF-LEVEL-3', description: 'EF等级3', category: '青少年英语', url: '/dicts/EF_LEVEL_3.json', length: 172 },
  { id: 'eflevel4', name: 'EF-LEVEL-4', description: 'EF等级4', category: '青少年英语', url: '/dicts/EF_LEVEL_4.json', length: 178 },
  { id: 'eflevel5', name: 'EF-LEVEL-5', description: 'EF等级5', category: '青少年英语', url: '/dicts/EF_LEVEL_5.json', length: 172 },
  { id: 'eflevel6', name: 'EF-LEVEL-6', description: 'EF等级6', category: '青少年英语', url: '/dicts/EF_LEVEL_6.json', length: 172 },
  { id: 'eflevel7', name: 'EF-LEVEL-7', description: 'EF等级7', category: '青少年英语', url: '/dicts/EF_LEVEL_7.json', length: 171 },
  { id: 'eflevel8', name: 'EF-LEVEL-8', description: 'EF等级8', category: '青少年英语', url: '/dicts/EF_LEVEL_8.json', length: 172 },
  { id: 'eflevel9', name: 'EF-LEVEL-9', description: 'EF等级9', category: '青少年英语', url: '/dicts/EF_LEVEL_9.json', length: 165 },
  { id: 'eflevel10', name: 'EF-LEVEL-10', description: 'EF等级10', category: '青少年英语', url: '/dicts/EF_LEVEL_10.json', length: 174 },
  { id: 'eflevel11', name: 'EF-LEVEL-11', description: 'EF等级11', category: '青少年英语', url: '/dicts/EF_LEVEL_11.json', length: 176 },
  { id: 'eflevel12', name: 'EF-LEVEL-12', description: 'EF等级12', category: '青少年英语', url: '/dicts/EF_LEVEL_12.json', length: 170 },
  { id: 'eflevel13', name: 'EF-LEVEL-13', description: 'EF等级13', category: '青少年英语', url: '/dicts/EF_LEVEL_13.json', length: 172 },
  { id: 'eflevel14', name: 'EF-LEVEL-14', description: 'EF等级14', category: '青少年英语', url: '/dicts/EF_LEVEL_14.json', length: 171 },
  { id: 'eflevel15', name: 'EF-LEVEL-15', description: 'EF等级15', category: '青少年英语', url: '/dicts/EF_LEVEL_15.json', length: 168 },
  { id: 'eflevel16', name: 'EF-LEVEL-16', description: 'EF等级16', category: '青少年英语', url: '/dicts/EF_LEVEL_16.json', length: 170 },
  { id: 'raz-A', name: 'RAZ 分级阅读 A', description: 'RAZ 分级阅读 A', category: '青少年英语', url: '/dicts/raz-A.json', length: 487 },
  { id: 'raz-AA', name: 'RAZ 分级阅读 AA', description: 'RAZ 分级阅读 AA', category: '青少年英语', url: '/dicts/raz-AA.json', length: 422 },
  { id: 'raz-B', name: 'RAZ 分级阅读 B', description: 'RAZ 分级阅读 B', category: '青少年英语', url: '/dicts/raz-B.json', length: 465 },
  { id: 'raz-C', name: 'RAZ 分级阅读 C', description: 'RAZ 分级阅读 C', category: '青少年英语', url: '/dicts/raz-C.json', length: 480 },
  { id: 'raz-D', name: 'RAZ 分级阅读 D', description: 'RAZ 分级阅读 D', category: '青少年英语', url: '/dicts/raz-D.json', length: 436 },
  { id: 'raz-E', name: 'RAZ 分级阅读 E', description: 'RAZ 分级阅读 E', category: '青少年英语', url: '/dicts/raz-E.json', length: 427 },
  { id: 'raz-F', name: 'RAZ 分级阅读 F', description: 'RAZ 分级阅读 F', category: '青少年英语', url: '/dicts/raz-F.json', length: 437 },
  { id: 'raz-G', name: 'RAZ 分级阅读 G', description: 'RAZ 分级阅读 G', category: '青少年英语', url: '/dicts/raz-G.json', length: 435 },
  { id: 'raz-H', name: 'RAZ 分级阅读 H', description: 'RAZ 分级阅读 H', category: '青少年英语', url: '/dicts/raz-H.json', length: 385 },
  { id: 'raz-I', name: 'RAZ 分级阅读 I', description: 'RAZ 分级阅读 I', category: '青少年英语', url: '/dicts/raz-I.json', length: 408 },
  { id: 'raz-J', name: 'RAZ 分级阅读 J', description: 'RAZ 分级阅读 J', category: '青少年英语', url: '/dicts/raz-J.json', length: 434 },
  { id: 'raz-K', name: 'RAZ 分级阅读 K', description: 'RAZ 分级阅读 K', category: '青少年英语', url: '/dicts/raz-K.json', length: 397 },
  { id: 'raz-L', name: 'RAZ 分级阅读 L', description: 'RAZ 分级阅读 L', category: '青少年英语', url: '/dicts/raz-L.json', length: 402 },
  { id: 'raz-M', name: 'RAZ 分级阅读 M', description: 'RAZ 分级阅读 M', category: '青少年英语', url: '/dicts/raz-M.json', length: 403 },
  { id: 'raz-N', name: 'RAZ 分级阅读 N', description: 'RAZ 分级阅读 N', category: '青少年英语', url: '/dicts/raz-N.json', length: 376 },
  { id: 'raz-O', name: 'RAZ 分级阅读 O', description: 'RAZ 分级阅读 O', category: '青少年英语', url: '/dicts/raz-O.json', length: 429 },
  { id: 'raz-P', name: 'RAZ 分级阅读 P', description: 'RAZ 分级阅读 P', category: '青少年英语', url: '/dicts/raz-P.json', length: 379 },
  { id: 'raz-Q', name: 'RAZ 分级阅读 Q', description: 'RAZ 分级阅读 Q', category: '青少年英语', url: '/dicts/raz-Q.json', length: 442 },
  { id: 'raz-R', name: 'RAZ 分级阅读 R', description: 'RAZ 分级阅读 R', category: '青少年英语', url: '/dicts/raz-R.json', length: 422 },
  { id: 'raz-S', name: 'RAZ 分级阅读 S', description: 'RAZ 分级阅读 S', category: '青少年英语', url: '/dicts/raz-S.json', length: 434 },
  { id: 'raz-T', name: 'RAZ 分级阅读 T', description: 'RAZ 分级阅读 T', category: '青少年英语', url: '/dicts/raz-T.json', length: 427 },
  { id: 'raz-U', name: 'RAZ 分级阅读 U', description: 'RAZ 分级阅读 U', category: '青少年英语', url: '/dicts/raz-U.json', length: 418 },
  { id: 'raz-V', name: 'RAZ 分级阅读 V', description: 'RAZ 分级阅读 V', category: '青少年英语', url: '/dicts/raz-V.json', length: 409 },
  { id: 'raz-W', name: 'RAZ 分级阅读 W', description: 'RAZ 分级阅读 W', category: '青少年英语', url: '/dicts/raz-W.json', length: 392 },
  { id: 'raz-X', name: 'RAZ 分级阅读 X', description: 'RAZ 分级阅读 X', category: '青少年英语', url: '/dicts/raz-X.json', length: 546 },
  { id: 'raz-Y', name: 'RAZ 分级阅读 Y', description: 'RAZ 分级阅读 Y', category: '青少年英语', url: '/dicts/raz-Y.json', length: 461 },
  { id: 'raz-Z', name: 'RAZ 分级阅读 Z', description: 'RAZ 分级阅读 Z', category: '青少年英语', url: '/dicts/raz-Z.json', length: 414 },
  { id: 'raz-Z1', name: 'RAZ 分级阅读 Z1', description: 'RAZ 分级阅读 Z1', category: '青少年英语', url: '/dicts/raz-Z1.json', length: 467 },
  { id: 'raz-Z2', name: 'RAZ 分级阅读 Z2', description: 'RAZ 分级阅读 Z2', category: '青少年英语', url: '/dicts/raz-Z2.json', length: 492 },
  { id: 'ReadingExplorer3', name: 'Reading Explorer 3', description: '词汇表来自Reading Explorer 3, Third Edition', category: '青少年英语', url: '/dicts/ReadingExplorer3.json', length: 239 },
  { id: 'qi1', name: '七年级上', description: '人教版七年级上册', category: '青少年英语', url: '/dicts/PEPChuZhong7_1_T.json', length: 392 },
  { id: 'qi2', name: '七年级下', description: '人教版七年级下册', category: '青少年英语', url: '/dicts/PEPChuZhong7_2_T.json', length: 492 },
  { id: 'san1', name: '三年级上', description: '人教版三年级上册', category: '青少年英语', url: '/dicts/PEPXiaoXue3_1_T.json', length: 64 },
  { id: 'san2', name: '三年级下', description: '人教版三年级下册', category: '青少年英语', url: '/dicts/PEPXiaoXue3_2_T.json', length: 72 },
  { id: 'SHjuniormiddleOxford', name: '上海初中牛津词汇', description: '上海初中牛津词汇', category: '青少年英语', url: '/dicts/OxfordVocabulary_juniorMiddleSH.json', length: 1270 },
  { id: 'shanghai-6-2word', name: '上海新教材六年级下', description: '上海新教材六年级下', category: '青少年英语', url: '/dicts/shanghai-6-2-word.json', length: 274 },
  { id: 'jiu', name: '九年级', description: '人教版九年级全册', category: '青少年英语', url: '/dicts/PEPChuZhong9_1_T.json', length: 551 },
  { id: 'wu1', name: '五年级上', description: '人教版五年级上册', category: '青少年英语', url: '/dicts/PEPXiaoXue5_1_T.json', length: 131 },
  { id: 'wu2', name: '五年级下', description: '人教版五年级下册', category: '青少年英语', url: '/dicts/PEPXiaoXue5_2_T.json', length: 156 },
  { id: 'pep-sl-yi1', name: '人教版(新起点)一年级上', description: '人教版一年级上册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue1_1_t.json', length: 52 },
  { id: 'pep-sl-yi2', name: '人教版(新起点)一年级下', description: '人教版一年级下册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue1_2_t.json', length: 45 },
  { id: 'pep-sl-san1', name: '人教版(新起点)三年级上', description: '人教版三年级上册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue3_1_t.json', length: 103 },
  { id: 'pep-sl-san2', name: '人教版(新起点)三年级下', description: '人教版三年级下册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue3_2_t.json', length: 84 },
  { id: 'pep-sl-er1', name: '人教版(新起点)二年级上', description: '人教版二年级上册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue2_1_t.json', length: 54 },
  { id: 'pep-sl-er2', name: '人教版(新起点)二年级下', description: '人教版二年级下册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue2_2_t.json', length: 55 },
  { id: 'pep-sl-wu1', name: '人教版(新起点)五年级上', description: '人教版五年级上册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue5_1_t.json', length: 66 },
  { id: 'pep-sl-wu2', name: '人教版(新起点)五年级下', description: '人教版五年级下册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue5_2_t.json', length: 96 },
  { id: 'pep-sl-liu1', name: '人教版(新起点)六年级上', description: '人教版六年级上册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue6_1_t.json', length: 102 },
  { id: 'pep-sl-liu2', name: '人教版(新起点)六年级下', description: '人教版六年级下册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue6_2_t.json', length: 41 },
  { id: 'pep-sl-si1', name: '人教版(新起点)四年级上', description: '人教版四年级上册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue4_1_t.json', length: 116 },
  { id: 'pep-sl-si2', name: '人教版(新起点)四年级下', description: '人教版四年级下册', category: '青少年英语', url: '/dicts/PEP_SL_XiaoXue4_2_t.json', length: 87 },
  { id: 'ba1', name: '八年级上', description: '人教版八年级上册', category: '青少年英语', url: '/dicts/PEPChuZhong8_1_T.json', length: 419 },
  { id: 'ba2', name: '八年级下', description: '人教版八年级下册', category: '青少年英语', url: '/dicts/PEPChuZhong8_2_T.json', length: 466 },
  { id: 'liu1', name: '六年级上', description: '人教版六年级上册', category: '青少年英语', url: '/dicts/PEPXiaoXue6_1_T.json', length: 130 },
  { id: 'liu2', name: '六年级下', description: '人教版六年级下册', category: '青少年英语', url: '/dicts/PEPXiaoXue6_2_T.json', length: 108 },
  { id: 'jijiao1', name: '冀教 3 上', description: '冀教版三年级起点三年级上', category: '青少年英语', url: '/dicts/jiJiao3-1.json', length: 75 },
  { id: 'jijiao2', name: '冀教 3 下', description: '冀教版三年级起点三年级下', category: '青少年英语', url: '/dicts/jiJiao3-2.json', length: 76 },
  { id: 'jijiao3', name: '冀教 4 上', description: '冀教版三年级起点四年级上', category: '青少年英语', url: '/dicts/jiJiao4-1.json', length: 78 },
  { id: 'jijiao4', name: '冀教 4 下', description: '冀教版三年级起点四年级下', category: '青少年英语', url: '/dicts/jiJiao4-2.json', length: 84 },
  { id: 'jijiao5', name: '冀教 5 上', description: '冀教版三年级起点五年级上', category: '青少年英语', url: '/dicts/jiJiao5-1.json', length: 79 },
  { id: 'jijiao6', name: '冀教 5 下', description: '冀教版三年级起点五年级下', category: '青少年英语', url: '/dicts/jiJiao5-2.json', length: 96 },
  { id: 'jijiao7', name: '冀教 6 上', description: '冀教版三年级起点六年级上', category: '青少年英语', url: '/dicts/jiJiao6-1.json', length: 66 },
  { id: 'jijiao8', name: '冀教 6 下', description: '冀教版三年级起点六年级下', category: '青少年英语', url: '/dicts/jiJiao6-2.json', length: 51 },
  { id: 'jijiao9', name: '冀教 7 上', description: '冀教版三年级起点七年级上', category: '青少年英语', url: '/dicts/jiJiao7-1.json', length: 561 },
  { id: 'jijiao10', name: '冀教 7 下', description: '冀教版三年级起点七年级下', category: '青少年英语', url: '/dicts/jiJiao7-2.json', length: 514 },
  { id: 'jijiao11', name: '冀教 8 上', description: '冀教版三年级起点八年级上', category: '青少年英语', url: '/dicts/jiJiao8-1.json', length: 420 },
  { id: 'jijiao12', name: '冀教 8 下', description: '冀教版三年级起点八年级下', category: '青少年英语', url: '/dicts/jiJiao8-2.json', length: 487 },
  { id: 'jijiao13', name: '冀教 9 上', description: '冀教版三年级起点九年级全册', category: '青少年英语', url: '/dicts/jiJiao9.json', length: 636 },
  { id: 'Cambridge_JOIN_IN', name: '剑桥小学英语 JOIN IN', description: '外研社和剑桥大学出版社依据《义务教育英语课程标准》要求联合为我国小学生开发的一套英语教材。', category: '青少年英语', url: '/dicts/Cambridge_JOIN_IN.json', length: 1350 },
  { id: 'BJJuniorHigh', name: '北京初中', description: '北京初中', category: '青少年英语', url: '/dicts/beijing_junior_high_school.json', length: 1844 },
  { id: 'si1', name: '四年级上', description: '人教版四年级上册', category: '青少年英语', url: '/dicts/PEPXiaoXue4_1_T.json', length: 84 },
  { id: 'si2', name: '四年级下', description: '人教版四年级下册', category: '青少年英语', url: '/dicts/PEPXiaoXue4_2_T.json', length: 104 },
  { id: 'waiyan9', name: '外研一年级上册', description: '外研一年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_1-Volume-up.json', length: 138 },
  { id: 'waiyan10', name: '外研一年级下册', description: '外研一年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_1-Volume-down.json', length: 118 },
  { id: 'waiyan1', name: '外研七年级上册', description: '外研版七年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_1_T.json', length: 629 },
  { id: 'waiyan2', name: '外研七年级下册', description: '外研版七年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_2_T.json', length: 438 },
  { id: 'waiyan13', name: '外研三年级上册', description: '外研三年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_3-Volume-top.json', length: 82 },
  { id: 'waiyan14', name: '外研三年级下册', description: '外研三年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_3-Volume-down.json', length: 106 },
  { id: 'waiyan5', name: '外研九年级上册', description: '外研版九年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_5_T.json', length: 381 },
  { id: 'waiyan6', name: '外研九年级下册', description: '外研版九年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_6_T.json', length: 128 },
  { id: 'waiyan11', name: '外研二年级上册', description: '外研二年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_2-Volume-top.json', length: 118 },
  { id: 'waiyan12', name: '外研二年级下册', description: '外研二年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_2-Volume-down.json', length: 110 },
  { id: 'waiyan17', name: '外研五年级上册', description: '外研五年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_5-Volume-top.json', length: 80 },
  { id: 'waiyan18', name: '外研五年级下册', description: '外研五年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_5-Volume-down.json', length: 72 },
  { id: 'waiyan3', name: '外研八年级上册', description: '外研版八年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_3_T.json', length: 320 },
  { id: 'waiyan4', name: '外研八年级下册', description: '外研版八年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_4_T.json', length: 266 },
  { id: 'waiyan19', name: '外研六年级上册', description: '外研六年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_6-Volume-top.json', length: 61 },
  { id: 'waiyan20', name: '外研六年级下册', description: '外研六年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_6-Volume-down.json', length: 91 },
  { id: 'waiyan15', name: '外研四年级上册', description: '外研四年级上册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_4-Volume-top.json', length: 116 },
  { id: 'waiyan16', name: '外研四年级下册', description: '外研四年级下册', category: '青少年英语', url: '/dicts/WaiYanSheChuZhong_4-Volume-down.json', length: 78 },
  { id: 'waiyan3-1', name: '外研新起点三年级上册', description: '外研新起点三年级上册', category: '青少年英语', url: '/dicts/waiyan-xin-3-1.json', length: 134 },
  { id: 'waiyan3-2', name: '外研新起点三年级下册', description: '外研新起点三年级下册', category: '青少年英语', url: '/dicts/waiyan-xin-3-2.json', length: 156 },
  { id: 'waiyan5-1', name: '外研新起点五年级上册', description: '外研新起点五年级上册', category: '青少年英语', url: '/dicts/waiyan-xin-5-1.json', length: 152 },
  { id: 'waiyan5-2', name: '外研新起点五年级下册', description: '外研新起点五年级下册', category: '青少年英语', url: '/dicts/waiyan-xin-5-2.json', length: 147 },
  { id: 'waiyan6-1', name: '外研新起点六年级上册', description: '外研新起点六年级上册', category: '青少年英语', url: '/dicts/waiyan-xin-6-1.json', length: 83 },
  { id: 'waiyan6-2', name: '外研新起点六年级下册', description: '外研新起点六年级下册', category: '青少年英语', url: '/dicts/waiyan-xin-6-2.json', length: 105 },
  { id: 'waiyan4-1', name: '外研新起点四年级上册', description: '外研新起点四年级上册', category: '青少年英语', url: '/dicts/waiyan-xin-4-1.json', length: 144 },
  { id: 'waiyan4-2', name: '外研新起点四年级下册', description: '外研新起点四年级下册', category: '青少年英语', url: '/dicts/waiyan-xin-4-2.json', length: 134 },
  { id: 'waiyan7', name: '外研高中必修1', description: '外研高中必修1', category: '青少年英语', url: '/dicts/WaiYanSheGaoZhong_1_T.json', length: 411 },
  { id: 'waiyan8', name: '外研高中必修2', description: '外研高中必修2', category: '青少年英语', url: '/dicts/WaiYanSheGaoZhong_2_T.json', length: 272 },
  { id: 'new-waiyan1', name: '新外研七年级上册', description: '新外研版七年级上册', category: '青少年英语', url: '/dicts/Newwaiyan7-1.json', length: 294 },
  { id: 'new-waiyan2', name: '新外研七年级下册', description: '新外研版七年级下册', category: '青少年英语', url: '/dicts/Newwaiyan7-2.json', length: 306 },
  { id: 'nce-new-1', name: '新概念英语(新版)-1', description: '新概念英语新版第一册', category: '青少年英语', url: '/dicts/nce-new-1.json', length: 908 },
  { id: 'nce-new-2', name: '新概念英语(新版)-2', description: '新概念英语新版第二册', category: '青少年英语', url: '/dicts/nce-new-2.json', length: 862 },
  { id: 'nce-new-3', name: '新概念英语(新版)-3', description: '新概念英语新版第三册', category: '青少年英语', url: '/dicts/nce-new-3.json', length: 1062 },
  { id: 'nce-new-4', name: '新概念英语(新版)-4', description: '新概念英语新版第四册', category: '青少年英语', url: '/dicts/nce-new-4.json', length: 793 },
  { id: 'renjiaogaozhong1', name: '高中必修1', description: '人教版高中必修1', category: '青少年英语', url: '/dicts/PEPGaoZhong_1_T.json', length: 311 },
  { id: 'Yilin1', name: '高中必修1', description: '译林版高中必修1', category: '青少年英语', url: '/dicts/YiLin_1.json', length: 276 },
  { id: 'beishi1', name: '高中必修1', description: '北师大版高中必修1', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_1_T.json', length: 226 },
  { id: 'renjiaogaozhong2', name: '高中必修2', description: '人教版高中必修2', category: '青少年英语', url: '/dicts/PEPGaoZhong_2_T.json', length: 319 },
  { id: 'Yilin2', name: '高中必修2', description: '译林版高中必修2', category: '青少年英语', url: '/dicts/YiLin_2.json', length: 297 },
  { id: 'beishi2', name: '高中必修2', description: '北师大版高中必修2', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_2_T.json', length: 244 },
  { id: 'renjiaogaozhong3', name: '高中必修3', description: '人教版高中必修3', category: '青少年英语', url: '/dicts/PEPGaoZhong_3_T.json', length: 366 },
  { id: 'Yilin3', name: '高中必修3', description: '译林版高中必修3', category: '青少年英语', url: '/dicts/YiLin_3.json', length: 295 },
  { id: 'beishi3', name: '高中必修3', description: '北师大版高中必修3', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_3_T.json', length: 295 },
  { id: 'renjiaogaozhong4', name: '高中必修4', description: '人教版高中必修4', category: '青少年英语', url: '/dicts/PEPGaoZhong_4_T.json', length: 307 },
  { id: 'beishi4', name: '高中必修4', description: '北师大版高中必修4', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_4_T.json', length: 336 },
  { id: 'renjiaogaozhong5', name: '高中必修5', description: '人教版高中必修5', category: '青少年英语', url: '/dicts/PEPGaoZhong_5_T.json', length: 357 },
  { id: 'beishi5', name: '高中必修5', description: '北师大版高中必修5', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_5_T.json', length: 327 },
  { id: 'renjiaogaozhong6', name: '高中选修6', description: '人教版高中选修6', category: '青少年英语', url: '/dicts/PEPGaoZhong_6_T.json', length: 391 },
  { id: 'beishi6', name: '高中选修6', description: '北师大版高中选修6', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_6_T.json', length: 271 },
  { id: 'renjiaogaozhong7', name: '高中选修7', description: '人教版高中选修7', category: '青少年英语', url: '/dicts/PEPGaoZhong_7_T.json', length: 384 },
  { id: 'beishi7', name: '高中选修7', description: '北师大版高中选修7', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_7_T.json', length: 334 },
  { id: 'renjiaogaozhong8', name: '高中选修8', description: '人教版高中选修8', category: '青少年英语', url: '/dicts/PEPGaoZhong_8_T.json', length: 420 },
  { id: 'beishi8', name: '高中选修8', description: '北师大版高中选修8', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_8_T.json', length: 364 },
  { id: 'renjiaogaozhong9', name: '高中选修9', description: '人教版高中选修9', category: '青少年英语', url: '/dicts/PEPGaoZhong_9_T.json', length: 352 },
  { id: 'beishi9', name: '高中选修9', description: '北师大版高中选修9', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_9_T.json', length: 299 },
  { id: 'renjiaogaozhong10', name: '高中选修10', description: '人教版高中选修10', category: '青少年英语', url: '/dicts/PEPGaoZhong_10_T.json', length: 361 },
  { id: 'beishi10', name: '高中选修10', description: '北师大版高中选修10', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_10_T.json', length: 267 },
  { id: 'renjiaogaozhong11', name: '高中选修11', description: '人教版高中选修11', category: '青少年英语', url: '/dicts/PEPGaoZhong_11_T.json', length: 309 },
  { id: 'beishi11', name: '高中选修11', description: '北师大版高中选修11', category: '青少年英语', url: '/dicts/BeiShiGaoZhong_11_T.json', length: 330 },
  { id: 'gaokaozhentihexin', name: '高考历年真题核心高频', description: '高考历年真题核心高频', category: '青少年英语', url: '/dicts/GaoKaoZhenTiHeXinGaoPin.json', length: 799 },
  { id: 'gaokao-yuedu-gaopin', name: '高考英语阅读高频词汇', description: '高考英语阅读高频词汇', category: '青少年英语', url: '/dicts/gaokao-yuedu-gaopin.json', length: 688 },

  // ── 英语词典（1）──
  { id: 'roger', name: 'Roger', description: '学习、工作常用英语', category: '英语词典', url: '/dicts/RogersWords.json', length: 4174 },

  // ── 专业词汇（3）──
  { id: 'biomedical-terms', name: '生物医学专业英语词汇', description: '生物医学专业英语词汇', category: '专业词汇', url: '/dicts/BIOmedical.json', length: 560 },
  { id: 'itVocabulary', name: '计算机专用英语', description: '大学计算机专业英语词汇', category: '专业词汇', url: '/dicts/itVocabulary.json', length: 1665 },
  { id: 'archVocabulary', name: '建筑专业英语', description: '大学建筑专业英语词汇', category: '专业词汇', url: '/dicts/archVocabulary.json', length: 630 },

  // ── 代码练习（5）──
  { id: 'coder', name: 'Coder Dict', description: '程序员常见单词词库', category: '代码练习', url: '/dicts/it-words.json', length: 1700 },
  { id: 'ai-machine-learning', name: '人工智能: 机器学习', description: 'AI机器学习 常用英语词汇', category: '代码练习', url: '/dicts/ai_machine_learning.json', length: 726 },
  { id: 'ai-ai-for-science', name: '人工智能: AI for Science', description: 'AI for Science 常用英语词汇', category: '代码练习', url: '/dicts/ai_for_science.json', length: 491 },
  { id: 'SoundSfxKey2', name: 'AudioKey_UCS-Category', description: '游戏音效常用单词-UCS-Category', category: '代码练习', url: '/dicts/AudioKey_Category.json', length: 82 },
  { id: 'SoundSfxKey', name: 'AudioKey_UCS-SubCategory', description: '游戏音效常用单词-UCS-SubCategory', category: '代码练习', url: '/dicts/AudioKey_SubCategory.json', length: 436 },
];

export const DICT_MAP: Record<string, DictMeta> = Object.fromEntries(
  DICTIONARIES.map((d) => [d.id, d]),
);

/** 数字感知 + 中文按拼音的比较器：CET-4 排在 CET-10 前，raz-Z1 排在 raz-Z2 前 */
const collator = new Intl.Collator(['zh-Hans-CN', 'en'], { numeric: true, sensitivity: 'base' });

export type DictGroup = { category: string; items: DictMeta[] };

/**
 * 按 CATEGORY_ORDER 分组、组内常用词库置顶 + 自然序排列的展示结构。
 * 结果只依赖 DICTIONARIES 内容，新增词库无需手工维护顺序。
 */
export const DICT_GROUPS: DictGroup[] = (() => {
  const buckets = new Map<string, DictMeta[]>();
  for (const d of DICTIONARIES) {
    const list = buckets.get(d.category);
    if (list) list.push(d);
    else buckets.set(d.category, [d]);
  }

  const known = CATEGORY_ORDER.filter((c) => buckets.has(c));
  // CATEGORY_ORDER 里没列出的分类排最后，保证新分类不会丢
  const rest = [...buckets.keys()].filter((c) => !known.includes(c as (typeof CATEGORY_ORDER)[number]));

  return [...known, ...rest].map((category) => {
    const featured = FEATURED_DICT_IDS[category] ?? [];
    const items = [...(buckets.get(category) ?? [])].sort((a, b) => {
      const ia = featured.indexOf(a.id);
      const ib = featured.indexOf(b.id);
      if (ia !== -1 || ib !== -1) {
        // 两个都在置顶名单里 → 按名单顺序；只有其中一个在 → 它排前面
        if (ia !== -1 && ib !== -1) return ia - ib;
        return ia !== -1 ? -1 : 1;
      }
      return collator.compare(a.name, b.name);
    });
    return { category: String(category), items };
  });
})();

/** 所有出现过的分类名，保持展示顺序 */
export const DICT_CATEGORIES: string[] = DICT_GROUPS.map((g) => g.category);

export function getDict(id: string): DictMeta {
  return DICT_MAP[id] ?? DICTIONARIES[0];
}

/** 默认词库：第一个分组的第一项（CET-4） */
export const DEFAULT_DICT_ID: string = DICTIONARIES[0].id;

/** 判断 id 是否指向真实存在的词库（localStorage 里的旧值可能已失效） */
export function isValidDictId(id: string | null | undefined): boolean {
  return !!id && id in DICT_MAP;
}

/** 按名称 / 简介 / 分类模糊搜索，供选择器过滤 */
export function searchDicts(keyword: string): DictGroup[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return DICT_GROUPS;
  return DICT_GROUPS.map((g) => ({
    category: g.category,
    items: g.items.filter(
      (d) =>
        d.name.toLowerCase().includes(kw) ||
        d.description.toLowerCase().includes(kw) ||
        d.category.toLowerCase().includes(kw) ||
        d.id.toLowerCase().includes(kw),
    ),
  })).filter((g) => g.items.length > 0);
}
