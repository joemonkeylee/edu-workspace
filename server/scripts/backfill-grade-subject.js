import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { parseGradeSubjectFromPath } from '../dist/services/pdfProcessor.js';

const prisma = new PrismaClient();
const ROOT = '/Users/{user}/Downloads/初中全套资料';

function scanDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDir(full));
    } else if (entry.name.toLowerCase().endsWith('.pdf')) {
      results.push(full);
    }
  }
  return results;
}

(async () => {
  console.log('Loading all books from DB...');
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, grade: true, subject: true },
  });
  console.log(`Loaded ${allBooks.length} books`);

  // Build lookup maps
  const byTitleCategory = new Map();
  const byTitle = new Map();
  for (const b of allBooks) {
    const key1 = `${b.title}||${b.category}`;
    if (!byTitleCategory.has(key1)) byTitleCategory.set(key1, b);
    if (!byTitle.has(b.title)) byTitle.set(b.title, b);
  }

  console.log('Scanning PDFs...');
  const pdfs = scanDir(ROOT);
  console.log(`Found ${pdfs.length} PDFs`);

  const updates = new Map(); // id -> { grade, subject }
  let matched = 0;
  let notFound = 0;
  let noInfo = 0;
  const notFoundSamples = [];
  const VALID_SUBJECTS = new Set(['语文', '数学', '英语', '物理', '化学', '生物', '道法', '历史', '地理', '科学']);

  for (let i = 0; i < pdfs.length; i++) {
    const pdfPath = pdfs[i];
    const title = path.basename(pdfPath, '.pdf');
    const category = path.basename(path.dirname(pdfPath));
    const { grade, subject } = parseGradeSubjectFromPath(pdfPath);

    if (!grade && !subject) {
      noInfo++;
      continue;
    }

    let book = byTitleCategory.get(`${title}||${category}`) || byTitle.get(title);

    if (!book) {
      notFound++;
      if (notFoundSamples.length < 10) notFoundSamples.push({ title, category, grade, subject });
      continue;
    }

    matched++;

    // Always overwrite with freshly parsed values (fixes previous bad values)
    const cur = updates.get(book.id) || { grade: '', subject: '' };
    updates.set(book.id, {
      grade: grade || cur.grade,
      subject: subject || cur.subject,
    });
  }

  // Sanitise: clear any subject that isn't a valid keyword
  for (const [id, data] of updates) {
    if (data.subject && !VALID_SUBJECTS.has(data.subject)) {
      data.subject = '';
    }
  }

  // Fallback: for books still missing grade/subject, try parsing the title.
  // Handles titles like "华师大8年级数学上册【高清教材】" or "湘教版地理七年级上册复习提纲".
  const numMap = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七', '8': '八', '9': '九' };
  const gradeRegex = /([1-9七八九])年级([上下])|([七八九])([上下])/;
  for (const b of allBooks) {
    if (updates.has(b.id)) continue; // already handled
    const m = b.title.match(gradeRegex);
    if (!m) continue;
    let num, dir;
    if (m[1]) { num = numMap[m[1]] || m[1]; dir = m[2]; }
    else { num = m[3]; dir = m[4]; }
    const grade = `${num}${dir}`;
    let subject = '';
    for (const kw of VALID_SUBJECTS) {
      if (b.title.includes(kw)) { subject = kw; break; }
    }
    updates.set(b.id, { grade, subject });
  }

  console.log(`\nMatched: ${matched}, Not found: ${notFound}, No info: ${noInfo}`);
  console.log(`Books to update: ${updates.size}`);

  // Apply updates in batches
  const ids = Array.from(updates.keys());
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    await Promise.all(
      batch.map((id) => prisma.book.update({ where: { id }, data: updates.get(id) }))
    );
    console.log(`Updated ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
  }

  console.log('\n=== Done ===');
  if (notFoundSamples.length) {
    console.log('Not-found samples:');
    notFoundSamples.forEach((s) => console.log('  -', JSON.stringify(s)));
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
