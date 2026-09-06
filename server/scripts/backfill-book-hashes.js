import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Multiple source roots to scan. Override with BOOK_SOURCE_ROOT (comma-separated).
const ROOTS = (process.env.BOOK_SOURCE_ROOT || '/Users/{user}/Downloads/初中全套资料,/Users/{user}/Downloads/99书本')
  .split(',')
  .map((r) => r.trim())
  .filter((r) => fs.existsSync(r));

function scanDir(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, results);
    } else if (entry.name.toLowerCase().endsWith('.pdf')) {
      results.push(full);
    }
  }
  return results;
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getPdfPageCount(filePath) {
  // Quick page count from PDF metadata (regex on /Count or /Type /Pages)
  try {
    const buf = fs.readFileSync(filePath);
    const text = buf.toString('latin1');
    // Match /Count NNNN (the largest one is usually the page count)
    const matches = text.match(/\/Count\s+(\d+)/g);
    if (matches) {
      const counts = matches.map((m) => parseInt(m.replace(/\/Count\s+/, ''), 10));
      return Math.max(...counts);
    }
  } catch {
    // ignore
  }
  return 0;
}

function normalizeSourcePaths(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()))];
}

(async () => {
  if (ROOTS.length === 0) {
    console.error('No valid BOOK_SOURCE_ROOT directories found.');
    process.exit(1);
  }

  console.log('Loading book metadata...');
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, totalPages: true, fileHash: true, sourcePaths: true },
  });

  // Only backfill books that still lack a hash
  const booksToFill = allBooks.filter((b) => !b.fileHash);
  console.log(`Books without fileHash: ${booksToFill.length} / ${allBooks.length}`);

  console.log(`Scanning PDFs under: ${ROOTS.join(', ')}`);
  let pdfs = [];
  for (const root of ROOTS) {
    pdfs = pdfs.concat(scanDir(root));
  }
  console.log(`Found ${pdfs.length} PDF files`);

  // Build lookup by exact title and by title::category
  const byTitleCategory = new Map();
  const byTitle = new Map();
  for (const book of booksToFill) {
    byTitleCategory.set(`${book.title}::${book.category}`, book);
    if (!byTitle.has(book.title)) byTitle.set(book.title, book);
  }

  const updates = new Map();
  let matchedExact = 0;
  let matchedPrefix = 0;
  let unmatched = 0;

  for (const pdfPath of pdfs) {
    const fileName = path.basename(pdfPath, '.pdf');
    const category = path.basename(path.dirname(pdfPath));

    // 1. Exact title::category match
    let book = byTitleCategory.get(`${fileName}::${category}`);
    // 2. Exact title match
    if (!book) book = byTitle.get(fileName);

    if (!book) {
      // 3. Prefix match: PDF filename starts with book title (handles 学生版/教师版 suffixes)
      for (const [title, candidate] of byTitle) {
        if (fileName.startsWith(title)) {
          // Prefer exact category match if possible
          if (candidate.category === category) {
            book = candidate;
            break;
          }
          // Otherwise use first prefix match (we'll verify by page count below)
          if (!book) book = candidate;
        }
      }
      if (book) matchedPrefix++;
    } else {
      matchedExact++;
    }

    if (!book) {
      unmatched++;
      continue;
    }

    // Skip if already updated in this run
    if (updates.has(book.id)) continue;

    // Verify by page count if the book has totalPages
    if (book.totalPages && book.totalPages > 0) {
      const pages = getPdfPageCount(pdfPath);
      if (pages > 0 && Math.abs(pages - book.totalPages) > 2) {
        // Page count mismatch — try other candidates with same title prefix
        continue;
      }
    }

    const hash = hashFile(pdfPath);
    const existing = updates.get(book.id) || {
      fileHash: book.fileHash || null,
      sourcePaths: normalizeSourcePaths(book.sourcePaths),
    };

    existing.fileHash = existing.fileHash || hash;
    existing.sourcePaths = [...new Set([...existing.sourcePaths, pdfPath])];
    updates.set(book.id, existing);
  }

  console.log(`Matched: exact=${matchedExact}, prefix=${matchedPrefix}, unmatched PDFs=${unmatched}`);
  console.log(`Books to update: ${updates.size}`);

  for (const [id, data] of updates.entries()) {
    await prisma.book.update({
      where: { id },
      data: {
        fileHash: data.fileHash,
        sourcePaths: data.sourcePaths,
      },
    });
  }

  // Report remaining books without hash
  const stillMissing = booksToFill.filter((b) => !updates.has(b.id));
  if (stillMissing.length > 0) {
    console.log(`\n⚠️  ${stillMissing.length} books still without fileHash (no matching source PDF found):`);
    for (const b of stillMissing.slice(0, 50)) {
      console.log(`  ID=${b.id}  pages=${b.totalPages}  "${b.title}"  [${b.category}]`);
    }
    if (stillMissing.length > 50) console.log(`  ... and ${stillMissing.length - 50} more`);
  }

  console.log('\nBackfill complete.');
  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
