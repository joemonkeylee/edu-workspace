/**
 * 学期/学科解析器回归用例。
 *
 * 教材文件名里的学期写法很杂（「七年级上册」「初一上」「7上」「【2025秋下】初三」…），
 * 解析规则一旦退化，导入时 grade 就会整批错掉，所以这里锁住一批典型输入。
 *
 * 用法：cd server && npx tsx scripts/check-grade-parser.ts
 * 全部通过退码 0，有失败退码 1。
 */
import { parseGradeSubjectFromText } from '../src/services/pdfProcessor.js';

// [输入文本, 期望学期, 期望学科]
const cases: [string, string, string][] = [
  // 教辅紧凑写法（本次踩坑的格式，来自「初中必刷题」批次）
  ['初中必刷题-7上-数学人教版批注式详答与详析', '七上', '数学'],
  ['初中必刷题-9下-英语人教版狂K重点', '九下', '英语'],
  ['初中必刷题-8下-数学人教版', '八下', '数学'],

  // 原有写法（回归）
  ['七年级上册数学', '七上', '数学'],
  ['7年级下册 英语', '七下', '英语'],
  ['初一上数学', '七上', '数学'],
  ['初二下-物理', '八下', '物理'],
  ['初三化学', '九上', '化学'],
  ['高一数学', '高一', '数学'],
  ['高二下 生物', '高二下', '生物'],
  ['【2025秋下】初三数学A+', '九下', '数学'],

  // 不应误判
  ['2017上海中考数学真题', '', '数学'],
  ['第7单元测试卷', '', ''],
  ['练习册7上午习题', '', ''],
  ['20260913222541', '', ''],
  ['初中必刷题-数学人教版', '', '数学'],
];

let pass = 0;
const failures: string[] = [];
for (const [text, expectedGrade, expectedSubject] of cases) {
  const r = parseGradeSubjectFromText(text);
  const ok = r.grade === expectedGrade && r.subject === expectedSubject;
  if (ok) pass++;
  else failures.push(`${text} => ${JSON.stringify(r)}，期望 ${JSON.stringify({ grade: expectedGrade, subject: expectedSubject })}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${text} => grade=${JSON.stringify(r.grade)} subject=${JSON.stringify(r.subject)}`);
}

console.log(`\n${pass}/${cases.length} passed`);
if (failures.length) {
  console.error('\n失败用例：');
  for (const f of failures) console.error('  ' + f);
  process.exitCode = 1;
}
