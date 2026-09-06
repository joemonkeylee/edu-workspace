import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SOURCE_ROOT = path.resolve(process.env.BOOK_SOURCE_ROOT || '/Users/{user}/Downloads/初中全套资料/七年级全套');
const CONCURRENCY = Math.max(1, Number(process.env.COPY_CONCURRENCY || 4));
const DRY_RUN = process.env.DRY_RUN === '1';
const STORAGE_KEY = 'storageRoot';

function scanPdfFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) scanPdfFiles(fullPath, results);
    else if (entry.name.toLowerCase().endsWith('.pdf')) results.push(fullPath);
  }
  return results;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function copyFile(sourcePath, targetPath) {
  await pipeline(fs.createReadStream(sourcePath), fs.createWriteStream(targetPath, { flags: 'wx' }));
}

function getAvailableName(bookDir, originalName) {
  const parsed = path.parse(originalName);
  let candidate = path.join(bookDir, parsed.base);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(bookDir, `${parsed.name}-${suffix}${parsed.ext}`);
    suffix++;
  }
  return candidate;
}

async function findExistingPdf(bookDir, sourceHash) {
  if (!fs.existsSync(bookDir)) return null;
  const entries = fs.readdirSync(bookDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
    const candidate = path.join(bookDir, entry.name);
    if (await hashFile(candidate) === sourceHash) return candidate;
  }
  return null;
}

async function runWithConcurrency(items, worker) {
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, consume));
}

async function main() {
  if (!fs.existsSync(SOURCE_ROOT)) throw new Error(`源目录不存在: ${SOURCE_ROOT}`);

  const setting = await prisma.appSetting.findUnique({ where: { key: STORAGE_KEY } });
  const storageRoot = path.resolve(setting?.value || process.env.STORAGE_DIR || path.join(process.cwd(), 'storage'));
  const targetRoot = path.join(storageRoot, 'books');
  const pdfFiles = scanPdfFiles(SOURCE_ROOT);
  const books = await prisma.book.findMany({
    select: { id: true, fileHash: true, sourcePaths: true },
    where: { fileHash: { not: null } },
  });
  const booksByHash = new Map(books.filter((book) => book.fileHash).map((book) => [book.fileHash, book]));

  console.log(`Source: ${SOURCE_ROOT}`);
  console.log(`Storage: ${storageRoot}`);
  console.log(`PDFs: ${pdfFiles.length}, books with hash: ${booksByHash.size}, concurrency: ${CONCURRENCY}`);
  if (DRY_RUN) console.log('DRY_RUN=1: no files will be copied or database records updated');

  let matched = 0;
  let copied = 0;
  let skipped = 0;
  let unmatched = 0;
  let failed = 0;
  const handledHashes = new Set();
  const unmatchedSamples = [];

  await runWithConcurrency(pdfFiles, async (sourcePath) => {
    try {
      const sourceHash = await hashFile(sourcePath);
      const book = booksByHash.get(sourceHash);
      if (!book) {
        unmatched++;
        if (unmatchedSamples.length < 20) unmatchedSamples.push(sourcePath);
        return;
      }

      if (handledHashes.has(sourceHash)) return;
      handledHashes.add(sourceHash);

      matched++;
      const bookDir = path.join(targetRoot, String(book.id));
      const existingPdf = await findExistingPdf(bookDir, sourceHash);
      if (existingPdf) {
        skipped++;
        return;
      }

      const targetPath = getAvailableName(bookDir, path.basename(sourcePath));
      if (!DRY_RUN) {
        fs.mkdirSync(bookDir, { recursive: true });
        await copyFile(sourcePath, targetPath);
        const sourcePaths = Array.isArray(book.sourcePaths) ? book.sourcePaths : [];
        if (!sourcePaths.includes(sourcePath)) {
          await prisma.book.update({
            where: { id: book.id },
            data: { sourcePaths: [...sourcePaths, sourcePath] },
          });
        }
      }
      copied++;
      console.log(`${DRY_RUN ? 'Would copy' : 'Copied'} book=${book.id}: ${path.basename(sourcePath)}`);
    } catch (error) {
      failed++;
      console.error(`Failed: ${sourcePath}`, error.message);
    }
  });

  console.log(`\nMatched PDFs: ${matched}`);
  console.log(`Copied: ${copied}`);
  console.log(`Already present: ${skipped}`);
  console.log(`Unmatched: ${unmatched}`);
  console.log(`Failed: ${failed}`);
  if (unmatchedSamples.length > 0) {
    console.log('\nUnmatched samples:');
    unmatchedSamples.forEach((filePath) => console.log(`  ${filePath}`));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
