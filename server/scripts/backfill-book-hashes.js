import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ROOT = process.env.BOOK_SOURCE_ROOT || '/Users/{user}/Downloads/初中全套资料/七年级全套';

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

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function normalizeSourcePaths(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()))];
}

(async () => {
  if (!fs.existsSync(ROOT)) {
    console.error(`BOOK_SOURCE_ROOT not found: ${ROOT}`);
    console.error('Set BOOK_SOURCE_ROOT to a directory containing the original PDF files before running this script.');
    process.exit(1);
  }

  console.log('Loading book metadata...');
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, fileHash: true, sourcePaths: true },
  });

  const byTitleCategory = new Map();
  const byTitle = new Map();
  for (const book of allBooks) {
    byTitleCategory.set(`${book.title}::${book.category}`, book);
    if (!byTitle.has(book.title)) byTitle.set(book.title, book);
  }

  console.log(`Scanning PDFs under ${ROOT}...`);
  const pdfs = scanDir(ROOT);
  console.log(`Found ${pdfs.length} PDF files`);

  const updates = new Map();
  let matched = 0;
  let unmatched = 0;

  for (const pdfPath of pdfs) {
    const title = path.basename(pdfPath, '.pdf');
    const category = path.basename(path.dirname(pdfPath));
    const book = byTitleCategory.get(`${title}::${category}`) || byTitle.get(title);
    if (!book) {
      unmatched++;
      continue;
    }

    matched++;
    const hash = hashFile(pdfPath);
    const existing = updates.get(book.id) || {
      fileHash: book.fileHash || null,
      sourcePaths: normalizeSourcePaths(book.sourcePaths),
    };

    existing.fileHash = existing.fileHash || hash;
    existing.sourcePaths = [...new Set([...existing.sourcePaths, pdfPath])];
    updates.set(book.id, existing);
  }

  // Fill in any missing hashes by matching same-hash duplicates already in DB.
  const hashGroups = new Map();
  for (const book of allBooks) {
    if (!book.fileHash) continue;
    const group = hashGroups.get(book.fileHash) || new Set();
    group.add(book.id);
    hashGroups.set(book.fileHash, group);
  }

  for (const book of allBooks) {
    if (book.fileHash && !updates.has(book.id)) {
      updates.set(book.id, {
        fileHash: book.fileHash,
        sourcePaths: normalizeSourcePaths(book.sourcePaths),
      });
    }
  }

  console.log(`Matched ${matched} PDFs to existing books, skipped ${unmatched} unmatched PDFs`);
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

  console.log('Backfill complete.');
  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
