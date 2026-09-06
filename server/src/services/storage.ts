import fs from 'fs';
import path from 'path';
import prisma from '../prisma.js';

const STORAGE_KEY = 'storageRoot';
const DEFAULT_ROOT = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');
let storageRoot = DEFAULT_ROOT;

export async function initializeStorageRoot() {
  const setting = await prisma.appSetting.findUnique({ where: { key: STORAGE_KEY } });
  if (setting?.value) storageRoot = path.resolve(setting.value);
  fs.mkdirSync(storageRoot, { recursive: true });
  return storageRoot;
}

export function getStorageRoot() {
  return storageRoot;
}

export function getBooksRoot() {
  return path.join(storageRoot, 'books');
}

export function getBookRoot(bookId: number) {
  return path.join(getBooksRoot(), String(bookId));
}

export function getCropsRoot() {
  return path.join(storageRoot, 'crops');
}

export function hasBookAssets(bookId: number, root = storageRoot) {
  const bookDir = path.join(root, 'books', String(bookId));
  if (!fs.existsSync(bookDir)) return false;
  try {
    return fs.readdirSync(bookDir, { withFileTypes: true }).some((entry) => {
      if (entry.isFile()) return entry.name.toLowerCase().endsWith('.pdf');
      return entry.isDirectory() && /^\d+$/.test(entry.name);
    });
  } catch {
    return false;
  }
}

export async function inspectStorageRoot(targetPath: string) {
  const resolvedPath = path.resolve(targetPath);
  const books = await prisma.book.findMany({ select: { id: true } });
  const matchedBookIds = books.filter((book) => hasBookAssets(book.id, resolvedPath)).map((book) => book.id);
  return {
    path: resolvedPath,
    exists: fs.existsSync(resolvedPath),
    matchedBooks: matchedBookIds.length,
    totalBooks: books.length,
    matchedBookIds,
  };
}

export async function setStorageRoot(targetPath: string) {
  const resolvedPath = path.resolve(targetPath);
  fs.mkdirSync(resolvedPath, { recursive: true });
  await prisma.appSetting.upsert({
    where: { key: STORAGE_KEY },
    create: { key: STORAGE_KEY, value: resolvedPath },
    update: { value: resolvedPath },
  });
  storageRoot = resolvedPath;
  return resolvedPath;
}

export function copyStorageRoot(sourcePath: string, targetPath: string) {
  if (!fs.existsSync(sourcePath)) return false;
  fs.mkdirSync(targetPath, { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: false });
  return true;
}