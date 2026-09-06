import axios from 'axios';
import type { Book } from '../types';

const api = axios.create({ baseURL: '/api' });

export interface BooksResponse {
  books: Book[];
  total: number;
  page: number;
  pageSize: number;
  options: { subjects: string[]; grades: string[]; categories: string[] };
}

export async function getBooks(params?: { category?: string; grade?: string; subject?: string; page?: number; pageSize?: number }) {
  const { data } = await api.get('/books', { params });
  return data as BooksResponse;
}

export async function getBook(id: number) {
  const { data } = await api.get(`/books/${id}`);
  return data;
}

export async function deleteBook(id: number) {
  const { data } = await api.delete(`/books/${id}`);
  return data;
}

export async function updateBook(id: number, body: { title?: string; category?: string; grade?: string; subject?: string }) {
  const { data } = await api.put(`/books/${id}`, body);
  return data;
}

export async function saveAnnotation(formData: FormData) {
  const { data } = await api.post('/annotations', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deleteAnnotation(id: number) {
  const { data } = await api.delete(`/annotations/${id}`);
  return data;
}

export async function getMistakes(params?: Record<string, any>) {
  const { data } = await api.get('/mistakes', { params });
  return data;
}

export async function updateMistake(id: number, body: Record<string, any>) {
  const { data } = await api.patch(`/mistakes/${id}`, body);
  return data;
}

export async function deleteMistake(id: number) {
  const { data } = await api.delete(`/mistakes/${id}`);
  return data;
}

export function scanPdfUrl(targetPath: string, category: string, dpi: number = 200, concurrency?: number) {
  const params = new URLSearchParams({ targetPath, category, dpi: String(dpi) });
  if (concurrency) params.set('concurrency', String(concurrency));
  return `/api/admin/scan-pdf?${params}`;
}

export async function getStorageSettings() {
  const { data } = await api.get('/admin/storage');
  return data as { path: string; exists: boolean; matchedBooks: number; totalBooks: number };
}

export async function inspectStorageSettings(path: string) {
  const { data } = await api.post('/admin/storage/inspect', { path });
  return data as { path: string; exists: boolean; matchedBooks: number; totalBooks: number };
}

export async function updateStorageSettings(path: string) {
  const { data } = await api.put('/admin/storage', { path });
  return data as { path: string; matchedBooks: number; totalBooks: number };
}

export async function openStorageDirectory(path?: string) {
  const { data } = await api.post('/admin/storage/open', path ? { path } : {});
  return data;
}

// ===== Admin APIs =====

export async function adminGetBooks(params?: Record<string, any>) {
  const { data } = await api.get('/admin/books', { params });
  return data as { data: any[]; total: number; page: number; pageSize: number };
}

export async function adminGetBatches() {
  const { data } = await api.get('/admin/books/batches');
  return data as string[];
}

export async function adminUpdateBook(id: number, body: { title?: string; category?: string; grade?: string; subject?: string; coverPage?: number; tocJson?: any[]; attributes?: Record<string, any> }) {
  const { data } = await api.put(`/admin/books/${id}`, body);
  return data;
}

export async function adminDeleteBook(id: number) {
  const { data } = await api.delete(`/admin/books/${id}`);
  return data;
}

export async function adminDeleteBooksBatch(ids: number[]) {
  const { data } = await api.delete('/admin/books/batch', { data: { ids } });
  return data;
}

export async function adminGetAnnotations(params?: Record<string, any>) {
  const { data } = await api.get('/admin/annotations', { params });
  return data as { data: any[]; total: number; page: number; pageSize: number };
}

export async function adminDeleteAnnotation(id: number) {
  const { data } = await api.delete(`/admin/annotations/${id}`);
  return data;
}

export async function adminGetMistakes(params?: Record<string, any>) {
  const { data } = await api.get('/admin/mistakes', { params });
  return data as { data: any[]; total: number; page: number; pageSize: number };
}

export async function adminUpdateMistake(id: number, body: Record<string, any>) {
  const { data } = await api.put(`/admin/mistakes/${id}`, body);
  return data;
}

export async function adminDeleteMistake(id: number) {
  const { data } = await api.delete(`/admin/mistakes/${id}`);
  return data;
}

export function pageImageUrl(storagePath: string, pageNumber: number) {
  const padded = String(pageNumber).padStart(4, '0');
  return `${storagePath}page-${padded}.png`;
}

export function getBookCoverUrl(book: { id?: number; storagePath?: string; availableDpis?: number[]; coverPage?: number }, pageNumber?: number) {
  const storagePath = (book.storagePath || '').replace(/\/+$/, '');
  const bestDpi = Array.isArray(book.availableDpis) && book.availableDpis.length > 0 ? Number(book.availableDpis[0]) : 0;
  const resolvedPage = pageNumber ?? book.coverPage ?? 1;
  const page = String(resolvedPage).padStart(4, '0');

  if (storagePath) {
    const dir = bestDpi > 0 ? `${storagePath}/${bestDpi}/` : `${storagePath}/`;
    return `${dir}page-${page}.png`;
  }

  if (book.id && bestDpi > 0) {
    return `/storage/books/${book.id}/${bestDpi}/page-${page}.png`;
  }

  return `/storage/books/${book.id || 0}/page-${page}.png`;
}

export default api;
