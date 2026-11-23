import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const sourceUrl = process.env.DATABASE_URL?.trim();
const targetUrl = process.env.PRODUCTION_DATABASE_URL?.trim();
const targetStorageUrl = process.env.PRODUCTION_FILE_SERVICE_URL?.trim().replace(/\/+$/, '');
const targetStorageToken = process.env.PRODUCTION_FILE_SERVICE_TOKEN?.trim();
const sourceStorageUrl = process.env.PDF_STORAGE_API_URL?.trim().replace(/\/+$/, '');
const sourceStorageToken = process.env.PDF_STORAGE_TOKEN?.trim();
const sourceStorageMode = (process.env.PDF_STORAGE_MODE || 'local').trim().toLowerCase();
const sourceStorageRoot = path.resolve(process.env.STORAGE_DIR || './storage');
const pdfRoot = path.join(sourceStorageRoot, 'pdf');
const apply = process.argv.includes('--apply');

function databaseLocation(value) {
  const url = new URL(value);
  const host = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'loopback' : url.hostname.toLowerCase();
  const port = url.port || (url.protocol === 'mysql:' ? '3306' : '');
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  return `${url.protocol}//${host}:${port}/${database}`;
}

if (process.argv.includes('--help')) {
  console.log('Usage: npm run pdf:sync:production -- [--apply]');
  console.log('Default is a read-only dry run. --apply uploads PDF assets and copies PDF module data into an empty production PDF schema.');
  process.exit(0);
}
if (!sourceUrl || !targetUrl || !targetStorageUrl || !targetStorageToken) {
  throw new Error('Set DATABASE_URL, PRODUCTION_DATABASE_URL, PRODUCTION_FILE_SERVICE_URL, and PRODUCTION_FILE_SERVICE_TOKEN.');
}
if (sourceStorageMode !== 'local' && sourceStorageMode !== 'http') {
  throw new Error(`Unsupported PDF_STORAGE_MODE: ${sourceStorageMode}`);
}
if (databaseLocation(sourceUrl) === databaseLocation(targetUrl)) throw new Error('Source and production database URLs must be different.');
if (targetStorageToken.length < 32) throw new Error('PRODUCTION_FILE_SERVICE_TOKEN must be at least 32 characters.');
const targetStorageOrigin = new URL(targetStorageUrl);
const isTargetLoopbackHttp = targetStorageOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(targetStorageOrigin.hostname);
if (targetStorageOrigin.protocol !== 'https:' && !isTargetLoopbackHttp) {
  throw new Error('PRODUCTION_FILE_SERVICE_URL must use HTTPS except for localhost.');
}
if (sourceStorageMode === 'http') {
  if (!sourceStorageUrl || !sourceStorageToken) throw new Error('Remote source PDF storage is not configured.');
  if (sourceStorageToken.length < 32) throw new Error('PDF_STORAGE_TOKEN must be at least 32 characters.');
  const sourceStorageOrigin = new URL(sourceStorageUrl);
  const isSourceLoopbackHttp = sourceStorageOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(sourceStorageOrigin.hostname);
  if (sourceStorageOrigin.protocol !== 'https:' && !isSourceLoopbackHttp) {
    throw new Error('PDF_STORAGE_API_URL must use HTTPS except for localhost.');
  }
}

const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });

const targetPdfTables = [
  'pdf_source_root',
  'pdf_book',
  'pdf_page_text',
  'pdf_thumb',
  'pdf_annotation',
  'pdf_mistake',
  'pdf_assignment',
  'pdf_assignment_stroke',
  'pdf_reading_progress',
  'pdf_book_favorite',
];

function safeLocalAsset(relPath) {
  const resolvedRoot = path.resolve(pdfRoot);
  const resolved = path.resolve(resolvedRoot, ...relPath.split(/[\\/]+/));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Invalid local PDF asset path: ${relPath}`);
  return resolved;
}

function objectUrl(baseUrl, key) {
  return `${baseUrl}/v1/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function checkTargetStorage() {
  const response = await fetch(`${targetStorageUrl}/v1/status`, {
    headers: { Authorization: `Bearer ${targetStorageToken}` },
  });
  if (!response.ok) throw new Error(`Production file service status failed (${response.status}).`);
  const { data } = await response.json();
  if (!data.initialized || !data.writable) throw new Error('Production file service is not initialized or is not writable.');
}

async function loadSourceFile(book) {
  if (book.rootPath === 'object://pdf') {
    const key = `pdf/${book.relPath}`;
    if (sourceStorageMode === 'http') {
      const response = await fetch(objectUrl(sourceStorageUrl, key), {
        headers: { Authorization: `Bearer ${sourceStorageToken}` },
      });
      if (!response.ok || !response.body) throw new Error(`Source PDF object unavailable: ${key}`);
      return { body: response.body, size: Number(response.headers.get('content-length') || book.fileSize || 0) };
    }
    const localPath = path.resolve(sourceStorageRoot, ...key.split('/'));
    if (!fs.existsSync(localPath)) throw new Error(`Source PDF object unavailable: ${key}`);
    return { path: localPath, size: fs.statSync(localPath).size };
  }

  const candidates = [
    book.filePath,
    path.resolve(book.rootPath, ...book.relPath.split('/')),
  ].filter((candidate) => candidate && !candidate.startsWith('object://'));
  const filePath = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!filePath) {
    if (book.missing) return null;
    throw new Error(`Source PDF file unavailable for book ${book.id}.`);
  }
  return { path: filePath, size: fs.statSync(filePath).size };
}

async function uploadAsset(key, sourceAsset) {
  let body;
  let size;
  if (sourceAsset.body) {
    body = sourceAsset.body;
    size = sourceAsset.size;
  } else {
    size = fs.statSync(sourceAsset.path).size;
    body = Readable.toWeb(fs.createReadStream(sourceAsset.path));
  }
  const response = await fetch(objectUrl(targetStorageUrl, key), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${targetStorageToken}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'X-Overwrite': 'true',
    },
    body,
    duplex: 'half',
  });
  if (!response.ok) throw new Error(`Upload failed for ${key} (${response.status}): ${await response.text()}`);
  return response.json();
}

async function insertManyInBatches(delegate, rows) {
  for (let offset = 0; offset < rows.length; offset += 400) {
    await delegate.createMany({ data: rows.slice(offset, offset + 400) });
  }
}

try {
  await Promise.all([source.$connect(), target.$connect()]);
  await checkTargetStorage();

  const occupiedTables = await target.$queryRaw`SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()`;
  const existingPdfTables = new Set(occupiedTables.map((row) => row.tableName).filter((name) => targetPdfTables.includes(name)));
  if (existingPdfTables.size > 0) {
    throw new Error(`Production PDF tables must be empty before initial sync. Found: ${[...existingPdfTables].join(', ')}`);
  }

  const books = await source.pdfBook.findMany({ orderBy: { id: 'asc' } });
  const bookIds = books.map((book) => book.id);
  const [pageTexts, allThumbs, annotations, mistakes, assignments, strokes, progress, favorites] = await Promise.all([
    source.pdfPageText.findMany({ where: { bookId: { in: bookIds } } }),
    source.pdfThumb.findMany({ where: { bookId: { in: bookIds } } }),
    source.pdfAnnotation.findMany({ where: { bookId: { in: bookIds } } }),
    source.pdfMistake.findMany({ where: { bookId: { in: bookIds } } }),
    source.pdfAssignment.findMany({ where: { bookId: { in: bookIds } } }),
    source.pdfAssignmentStroke.findMany({ where: { assignment: { bookId: { in: bookIds } } } }),
    source.pdfReadingProgress.findMany({ where: { bookId: { in: bookIds } } }),
    source.pdfBookFavorite.findMany({ where: { bookId: { in: bookIds } } }),
  ]);

  const referencedUserIds = new Set([
    ...annotations.map((row) => row.userId),
    ...mistakes.map((row) => row.userId),
    ...assignments.flatMap((row) => [row.userId, row.gradedBy]),
    ...progress.map((row) => row.userId),
    ...favorites.map((row) => row.userId),
  ].filter((id) => id !== null));
  if (referencedUserIds.size > 0) {
    const users = await target.user.findMany({ where: { id: { in: [...referencedUserIds] } }, select: { id: true } });
    const found = new Set(users.map((row) => row.id));
    const missingIds = [...referencedUserIds].filter((id) => !found.has(id));
    if (missingIds.length) throw new Error(`Production users must exist with matching IDs before sync. Missing user IDs: ${missingIds.join(', ')}`);
  }

  const assets = [];
  const missingFiles = [];
  const booksToUpdate = [];
  for (const book of books) {
    const sourceFile = await loadSourceFile(book);
    const relPath = `books/${book.id}/original.pdf`;
    const objectKey = `pdf/${relPath}`;
    if (sourceFile) {
      assets.push({ key: objectKey, source: sourceFile });
      booksToUpdate.push({ ...book, filePath: `object://pdf/${relPath}`, rootPath: 'object://pdf', relPath, rootId: null, missing: false, fileSize: sourceFile.size });
    } else {
      missingFiles.push(`PDF book ${book.id}: original file missing (record already marked missing)`);
      booksToUpdate.push({ ...book, filePath: `object://pdf/${relPath}`, rootPath: 'object://pdf', relPath, rootId: null, missing: true });
    }
    const coverPath = safeLocalAsset(`covers/${book.id}.jpg`);
    if (fs.existsSync(coverPath)) assets.push({ key: `pdf/covers/${book.id}.jpg`, source: { path: coverPath } });
  }

  const thumbs = [];
  for (const thumb of allThumbs) {
    const filePath = safeLocalAsset(thumb.relPath);
    if (fs.existsSync(filePath)) {
      assets.push({ key: `pdf/${thumb.relPath.replace(/\\/g, '/')}`, source: { path: filePath } });
      thumbs.push(thumb);
    }
  }

  for (const mistake of mistakes) {
    const filePath = safeLocalAsset(mistake.imagePath);
    if (!fs.existsSync(filePath)) throw new Error(`Missing PDF mistake image ${mistake.imagePath}; refusing an incomplete sync.`);
    assets.push({ key: `pdf/${mistake.imagePath.replace(/\\/g, '/')}`, source: { path: filePath } });
  }

  const counts = {
    books: books.length,
    pageTexts: pageTexts.length,
    thumbs: thumbs.length,
    annotations: annotations.length,
    mistakes: mistakes.length,
    assignments: assignments.length,
    strokes: strokes.length,
    progress: progress.length,
    favorites: favorites.length,
    assets: assets.length,
  };
  console.log(`${apply ? 'Applying' : 'Dry run'} PDF initial sync:`, counts);
  for (const warning of missingFiles) console.warn(warning);
  if (!apply) {
    console.log('No data or files were changed. Re-run with --apply to upload and copy into the empty production PDF tables.');
    process.exitCode = 0;
  } else {
    for (let index = 0; index < assets.length; index += 1) {
      await uploadAsset(assets[index].key, assets[index].source);
      if ((index + 1) % 25 === 0 || index + 1 === assets.length) console.log(`Uploaded ${index + 1}/${assets.length} PDF assets`);
    }

    await target.pdfSourceRoot.create({
      data: { label: '正式 PDF 对象存储', rootPath: 'object://pdf', enabled: true, bookCount: books.length },
    });
    await insertManyInBatches(target.pdfBook, booksToUpdate);
    await insertManyInBatches(target.pdfPageText, pageTexts);
    await insertManyInBatches(target.pdfThumb, thumbs);
    await insertManyInBatches(target.pdfAnnotation, annotations);
    await insertManyInBatches(target.pdfMistake, mistakes);
    await insertManyInBatches(target.pdfAssignment, assignments);
    await insertManyInBatches(target.pdfAssignmentStroke, strokes);
    await insertManyInBatches(target.pdfReadingProgress, progress);
    await insertManyInBatches(target.pdfBookFavorite, favorites);
    console.log('PDF metadata and resources synchronized to the empty production PDF tables.');
  }
} finally {
  await Promise.all([source.$disconnect(), target.$disconnect()]);
}
