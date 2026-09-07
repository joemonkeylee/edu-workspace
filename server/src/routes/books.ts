import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';
import { getBestDpiPath, getAvailableDpisAsync } from '../services/pdfProcessor.js';
import { getBookRoot, getCropsRoot } from '../services/storage.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const category = req.query.category as string;
  const grade = req.query.grade as string;
  const subject = req.query.subject as string;
  const search = req.query.search as string;
  const page = parseInt(req.query.page as string, 10) || 1;
  const pageSize = parseInt(req.query.pageSize as string, 10) || 16;

  const where: any = {};
  if (category && category !== 'all') where.category = category;
  if (grade && grade !== 'all') where.grade = grade;
  if (subject && subject !== 'all') where.subject = subject;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { category: { contains: search } },
      { grade: { contains: search } },
      { subject: { contains: search } },
    ];
  }

  const skip = (page - 1) * pageSize;

  // Paginated books (without tocJson to keep payload small)
  const [books, total] = await Promise.all([
    prisma.book.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        title: true,
        category: true,
        grade: true,
        subject: true,
        coverPage: true,
        totalPages: true,
        storagePath: true,
        createdAt: true,
      },
    }),
    prisma.book.count({ where }),
  ]);

  // Async compute availableDpis for the current page only (16 books)
  const booksWithDpi = await Promise.all(books.map(async (b) => {
    const bookDir = getBookRoot(b.id);
    const dpis = await getAvailableDpisAsync(bookDir);
    return { ...b, availableDpis: dpis };
  }));

  // Distinct filter options, filtered by all active filters except the one being computed
  // Subjects: filtered by grade + category + search (excluding subject itself)
  const subjectWhere: any = {};
  if (grade && grade !== 'all') subjectWhere.grade = grade;
  if (category && category !== 'all') subjectWhere.category = category;
  if (search) subjectWhere.OR = [
    { title: { contains: search } },
    { category: { contains: search } },
    { grade: { contains: search } },
    { subject: { contains: search } },
  ];
  const subjectBooks = await prisma.book.findMany({ where: subjectWhere, select: { subject: true } });
  const subjects = [...new Set(subjectBooks.map(b => b.subject).filter(Boolean))] as string[];

  // Grades: filtered by subject + category + search (excluding grade itself)
  const gradeWhere: any = {};
  if (subject && subject !== 'all') gradeWhere.subject = subject;
  if (category && category !== 'all') gradeWhere.category = category;
  if (search) gradeWhere.OR = [
    { title: { contains: search } },
    { category: { contains: search } },
    { grade: { contains: search } },
    { subject: { contains: search } },
  ];
  const gradeBooks = await prisma.book.findMany({ where: gradeWhere, select: { grade: true } });
  const grades = [...new Set(gradeBooks.map(b => b.grade).filter(Boolean))] as string[];

  // Category options: filtered by subject + grade + search (excluding category itself), with counts
  const categoryWhere: any = {};
  if (subject && subject !== 'all') categoryWhere.subject = subject;
  if (grade && grade !== 'all') categoryWhere.grade = grade;
  if (search) categoryWhere.OR = [
    { title: { contains: search } },
    { category: { contains: search } },
    { grade: { contains: search } },
    { subject: { contains: search } },
  ];
  const categoryBooks = await prisma.book.findMany({
    where: categoryWhere,
    select: { category: true },
  });
  const categoryCountMap = new Map<string, number>();
  for (const b of categoryBooks) {
    if (b.category) {
      categoryCountMap.set(b.category, (categoryCountMap.get(b.category) || 0) + 1);
    }
  }
  const categories = [...categoryCountMap.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ books: booksWithDpi, total, page, pageSize, options: { subjects, grades, categories } });
});

router.get('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) {
    return res.status(404).json({ error: '书籍不存在' });
  }
  const annotations = await prisma.annotation.findMany({
    where: { bookId: id },
    orderBy: { pageNumber: 'asc' },
  });
  const bookDir = getBookRoot(id);
  const best = getBestDpiPath(bookDir);
  const storagePath = best ? `/storage/books/${id}/${best.dpi}/` : book.storagePath;
  const dpis = await getAvailableDpisAsync(bookDir);
  const pdfFileName = fs.existsSync(bookDir)
    ? fs.readdirSync(bookDir).find((name) => name.toLowerCase().endsWith('.pdf')) || null
    : null;
  const pdfUrl = pdfFileName
    ? `/storage/books/${id}/${encodeURIComponent(pdfFileName)}`
    : null;
  res.json({ ...book, annotations, storagePath, availableDpis: dpis, pdfFileName, pdfUrl });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const bookDir = getBookRoot(id);
    const cropDir = path.join(getCropsRoot(), String(id));
    const { rmSync } = await import('fs');
    try { rmSync(bookDir, { recursive: true, force: true }); } catch { /* files may not exist in dev */ }
    try { rmSync(cropDir, { recursive: true, force: true }); } catch { /* files may not exist in dev */ }
    await prisma.book.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { title, category, grade, subject } = req.body;
  const data: any = {};
  if (typeof title === 'string') data.title = title;
  if (typeof category === 'string') data.category = category;
  if (typeof grade === 'string') data.grade = grade;
  if (typeof subject === 'string') data.subject = subject;
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: '没有可更新的字段' });
  }
  try {
    const updated = await prisma.book.update({ where: { id }, data });
    res.json(updated);
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

export default router;
