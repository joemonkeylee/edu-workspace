import axios from 'axios';
import type { Book } from '../types';

const api = axios.create({ baseURL: '/api' });

// ── Token management ──────────────────────────────────────────────

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onAuthExpired: (() => void) | null = null;

const REFRESH_KEY = 'edu_refresh_token';

export function initAuth() {
  refreshToken = localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh?: string) {
  accessToken = access;
  if (refresh) {
    refreshToken = refresh;
    localStorage.setItem(REFRESH_KEY, refresh);
  }
}

export function setAuthExpiredHandler(handler: () => void) {
  onAuthExpired = handler;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(REFRESH_KEY);
}

// Attach access token to all requests
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Auto-refresh on 401
let refreshing = false;
let pendingQueue: Array<() => void> = [];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Normalize error message from server response
    const serverMsg = error.response?.data;
    if (serverMsg) {
      if (serverMsg instanceof Blob) {
        // Blob responses (e.g. file download) — read text and try to parse JSON error
        try {
          const text = await serverMsg.text();
          const json = JSON.parse(text);
          error.message = json.error || json.message || error.message;
        } catch {
          // not JSON, keep default message
        }
      } else if (typeof serverMsg === 'object') {
        error.message = serverMsg.error || serverMsg.message || error.message;
      }
    }

    if (error.response?.status === 401 && !original._retry && refreshToken) {
      if (refreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push(() => {
            if (accessToken) original.headers.Authorization = `Bearer ${accessToken}`;
            api(original).then(resolve).catch(reject);
          });
        });
      }
      original._retry = true;
      refreshing = true;
      try {
        const { data } = await axios.post('/api/auth/refresh', { refreshToken });
        setTokens(data.accessToken, data.refreshToken);
        pendingQueue.forEach((fn) => fn());
        pendingQueue = [];
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        clearTokens();
        pendingQueue = [];
        onAuthExpired?.();
        return Promise.reject(error);
      } finally {
        refreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth API ──────────────────────────────────────────────────────

export interface LoginUser {
  id: number;
  phone: string;
  email: string | null;
  isAdmin: boolean;
  role: string;
  roles: string[];
  nickName: string;
  avatar: string;
  status: string;
  maxDevices: number;
}

export async function getCaptcha() {
  const { data } = await api.get('/auth/captcha');
  return data as { key: string; svg: string };
}

export async function login(phone: string, password: string, captchaKey: string, captchaText: string) {
  const { data } = await api.post('/auth/login', { phone, password, captchaKey, captchaText });
  setTokens(data.accessToken, data.refreshToken);
  return data as { accessToken: string; refreshToken: string; user: LoginUser };
}

export async function logout() {
  if (refreshToken) {
    try { await api.post('/auth/logout', { refreshToken }); } catch { /* ignore */ }
  }
  clearTokens();
}

export async function getAuthStatus() {
  const { data } = await api.get('/auth/status');
  return data as { authEnabled: boolean };
}

export async function getMe() {
  const { data } = await api.get('/auth/me');
  return data as { userId: number; phone: string; email: string | null; isAdmin: boolean; role: string; roles: string[]; nickName: string; avatar: string; status: string; maxDevices: number };
}

// ── Admin user API ────────────────────────────────────────────────

export async function adminGetUsers(params?: Record<string, any>) {
  const { data } = await api.get('/admin/users', { params });
  return data as { data: any[]; total: number; page: number; pageSize: number };
}

export async function adminCreateUser(body: { phone: string; password: string; email?: string; isAdmin?: boolean; nickName?: string; maxDevices?: number; role?: string }) {
  const { data } = await api.post('/admin/users', body);
  return data.data;
}

export async function adminUpdateUser(id: number, body: Record<string, any>) {
  const { data } = await api.put(`/admin/users/${id}`, body);
  return data.data;
}

export async function adminResetPassword(id: number, password: string) {
  const { data } = await api.put(`/admin/users/${id}/password`, { password });
  return data;
}

export async function adminDeleteUser(id: number) {
  const { data } = await api.delete(`/admin/users/${id}`);
  return data;
}

export async function adminGetUserDevices(id: number) {
  const { data } = await api.get(`/admin/users/${id}/devices`);
  return data.data as any[];
}

export async function adminKickDevice(id: number, tokenId: number) {
  const { data } = await api.delete(`/admin/users/${id}/devices/${tokenId}`);
  return data;
}

export async function adminGetAuthSettings() {
  const { data } = await api.get('/admin/users/settings/auth');
  return data as Record<string, string>;
}

export async function adminUpdateAuthSettings(body: Record<string, string>) {
  const { data } = await api.put('/admin/users/settings/auth', body);
  return data;
}

// ── Book Pairs API ────────────────────────────────────────────────

export interface BookPairCandidate {
  key: string;
  baseTitle: string;
  category: string;
  textbooks: Array<{ id: number; title: string; category: string; totalPages: number }>;
  answers: Array<{ id: number; title: string; category: string; totalPages: number }>;
  hasDuplicate: boolean;
  bound: boolean;
}

export interface PairStats {
  totalBooks: number;
  candidatePairs: number;
  boundPairs: number;
  unboundPairs: number;
  duplicateGroups: number;
  orphanTextbooks: number;
  orphanAnswers: number;
  noVersionKeyword: number;
}

export async function bookPairsScan(params?: { page?: number; pageSize?: number; unbound?: boolean; duplicates?: boolean; search?: string }) {
  const { data } = await api.get('/admin/book-pairs/scan', { params });
  return data as { data: BookPairCandidate[]; total: number; page: number; pageSize: number; stats: PairStats };
}

export async function bookPairsList(params?: { page?: number; pageSize?: number; search?: string }) {
  const { data } = await api.get('/admin/book-pairs', { params });
  return data as { data: Array<{ textbook: { id: number; title: string; category: string; totalPages: number }; answers: Array<{ id: number; title: string; category: string; totalPages: number }> }>; total: number; page: number; pageSize: number };
}

export async function bookPairsOrphans(params?: { page?: number; pageSize?: number; search?: string; role?: 'textbook' | 'answer' | 'none' }) {
  const { data } = await api.get('/admin/book-pairs/orphans', { params });
  return data as { data: Array<{ id: number; title: string; category: string; totalPages: number; role: string }>; total: number; page: number; pageSize: number };
}

export async function bookPairsBind(textbookId: number, answerIds: number[]) {
  const { data } = await api.post('/admin/book-pairs/bind', { textbookId, answerIds });
  return data;
}

export async function bookPairsUnbind(bookId: number) {
  const { data } = await api.post('/admin/book-pairs/unbind', { bookId });
  return data;
}

export async function bookPairsBindBatch(pairs: Array<{ textbookId: number; answerIds: number[] }>) {
  const { data } = await api.post('/admin/book-pairs/bind-batch', { pairs });
  return data;
}

export interface PairRules {
  textbookKeywords: string[];
  answerKeywords: string[];
  bracketPatterns: Array<{ pattern: string; desc: string }>;
  rule: string;
  examples: string[];
}

export async function bookPairsRules() {
  const { data } = await api.get('/admin/book-pairs/rules');
  return data.data as PairRules;
}

export interface BooksResponse {
  data: Book[];
  total: number;
  page: number;
  pageSize: number;
  options: { subjects: string[]; grades: string[]; categories: { name: string; count: number }[] };
}

export async function getBooks(params?: { category?: string; grade?: string; subject?: string; search?: string; sort?: string; page?: number; pageSize?: number; favoritesOnly?: boolean }) {
  const { data } = await api.get('/books', { params });
  return data as BooksResponse;
}

export async function getBook(id: number) {
  const { data } = await api.get(`/books/${id}`);
  return data.data;
}

export async function deleteBook(id: number) {
  const { data } = await api.delete(`/books/${id}`);
  return data;
}

export async function updateBook(id: number, body: { title?: string; category?: string; grade?: string; subject?: string }) {
  const { data } = await api.put(`/books/${id}`, body);
  return data;
}

export async function toggleFavorite(bookId: number): Promise<{ isFavorite: boolean }> {
  const { data } = await api.post(`/books/${bookId}/favorite`);
  return data.data;
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
  return data as { data: any[]; total: number; page: number; pageSize: number };
}

export async function updateMistake(id: number, body: Record<string, any>) {
  const { data } = await api.patch(`/mistakes/${id}`, body);
  return data;
}

export async function deleteMistake(id: number) {
  const { data } = await api.delete(`/mistakes/${id}`);
  return data;
}

export function scanPdfUrl(targetPath: string, category: string, dpi: number = 200, concurrency?: number, taskId?: string, grade?: string, subject?: string, skipDb?: boolean, ticket?: string) {
  const params = new URLSearchParams({ targetPath, category, dpi: String(dpi) });
  if (concurrency) params.set('concurrency', String(concurrency));
  if (taskId) params.set('taskId', taskId);
  if (grade) params.set('grade', grade);
  if (subject) params.set('subject', subject);
  if (skipDb) params.set('skipDb', 'true');
  // Use one-time ticket instead of raw token in URL (avoids log/referer/history leaks)
  if (ticket) params.set('ticket', ticket);
  return `/api/admin/scan-pdf?${params}`;
}

// Get a one-time SSE ticket for scan-pdf (replaces putting token in URL)
export async function getScanPdfTicket() {
  const { data } = await api.post('/admin/scan-pdf/ticket');
  return data.data.ticket;
}

// Append auth token to crop image URLs when auth is enabled
// <img> tags can't send Authorization headers, so token goes in query string
export function withAuthToken(url: string): string {
  if (!accessToken) return url;
  if (!url.startsWith('/storage/crops/')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(accessToken)}`;
}

export interface PreviewFile {
  fileName: string;
  fullPath: string;
  category: string;
  grade: string;
  subject: string;
  title: string;
}

export async function previewScanPdf(path: string, grade?: string, subject?: string, category?: string) {
  const { data } = await api.post('/admin/scan-pdf/preview', { path, grade, subject, category });
  return data as { files: PreviewFile[]; total: number };
}

export async function getScanCapacity() {
  const { data } = await api.get('/admin/scan-pdf/capacity');
  return data as { cores: number; maxConcurrency: number };
}

export async function updateScanConcurrency(taskId: string, concurrency: number) {
  const { data } = await api.post('/admin/scan-pdf/concurrency', { taskId, concurrency });
  return data as { concurrency: number; active: boolean };
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
  return data.data as string[];
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

export async function adminClearBooks(onProgress: (progress: { current: number; total: number; title: string }) => void) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch('/api/admin/books/all/stream', { method: 'DELETE', headers });
  if (!response.ok || !response.body) throw new Error('清空书籍失败');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { success: boolean; deleted: number } | null = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const dataLine = event.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      const data = JSON.parse(dataLine.slice(6));
      if (event.startsWith('event: progress')) onProgress(data);
      if (event.startsWith('event: done')) result = data;
      if (event.startsWith('event: error')) throw new Error(data.error || '清空书籍失败');
    }
    if (done) break;
  }
  if (!result) throw new Error('清空书籍未完成');
  return result;
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

export async function adminGetAssignments(params?: Record<string, any>) {
  const { data } = await api.get('/admin/assignments', { params });
  return data as { data: any[]; total: number; page: number; pageSize: number; books: { id: number; title: string }[] };
}

export async function adminDeleteAssignment(id: number) {
  const { data } = await api.delete(`/admin/assignments/${id}`);
  return data;
}

export async function adminDeleteAssignmentsBatch(ids: number[]) {
  const { data } = await api.post('/admin/assignments/batch-delete', { ids });
  return data as { success: boolean; count: number };
}

// ── Assignment API ────────────────────────────────────────────────

export interface Assignment {
  id: number;
  bookId: number;
  userId: number | null;
  title: string;
  subject: string;
  status: string;
  gradedBy: number | null;
  createdAt: string;
  updatedAt: string;
  gradedAt: string | null;
  _count?: { strokes: number };
  pages?: number[];
  user?: { id: number; nickName: string; phone: string } | null;
}

export interface AssignmentStroke {
  id: number;
  assignmentId: number;
  pageNumber: number;
  layer: string;
  tool: string;
  color: string;
  width: number;
  points: { x: number; y: number; p?: number }[];
  createdAt: string;
}

export async function getAssignments(bookId: number, params?: { page?: number; pageSize?: number }) {
  const { data } = await api.get('/assignments', { params: { bookId, ...params } });
  return data as { data: Assignment[]; total: number; page: number; pageSize: number };
}

export async function getAssignment(id: number) {
  const { data } = await api.get(`/assignments/${id}`);
  return data.data as Assignment & { book: any };
}

export async function createAssignment(bookId: number, title?: string, subject?: string) {
  const { data } = await api.post('/assignments', { bookId, title, subject });
  return data.data as Assignment;
}

export async function updateAssignment(id: number, body: { title?: string; subject?: string; status?: string }) {
  const { data } = await api.put(`/assignments/${id}`, body);
  return data.data as Assignment;
}

export async function deleteAssignment(id: number) {
  const { data } = await api.delete(`/assignments/${id}`);
  return data;
}

export async function getStrokes(assignmentId: number, pageNumber?: number) {
  const params: Record<string, any> = {};
  if (pageNumber) params.pageNumber = pageNumber;
  const { data } = await api.get(`/assignments/${assignmentId}/strokes`, { params });
  return data as { strokes: AssignmentStroke[] };
}

export async function saveStrokes(assignmentId: number, pageNumber: number, layer: string, strokes: any[]) {
  const { data } = await api.post(`/assignments/${assignmentId}/strokes`, { pageNumber, layer, strokes });
  return data;
}

export async function deleteStroke(assignmentId: number, strokeId: number) {
  const { data } = await api.delete(`/assignments/${assignmentId}/strokes/${strokeId}`);
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

// ── Reading progress (cloud sync) ───────────────────────────────────

export async function getReadingProgress(bookId: number) {
  const { data } = await api.get(`/reading-progress/${bookId}`);
  return data.data;
}

export async function saveReadingProgress(bookId: number, progress: { pageNumber?: number; pageLayout?: string; fitMode?: string; rotation?: number }) {
  const { data } = await api.put(`/reading-progress/${bookId}`, progress);
  return data.data;
}

// ── DB Backup API ────────────────────────────────────────────────

export interface DbBackupMeta {
  filename: string;
  size: number;
  createdAt: string;
  compressed: boolean;
  type: 'backup' | 'pre-restore';
}

export interface DbConnection {
  id: string;
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export interface ConnectionConfig {
  connections: DbConnection[];
  defaultConnectionId: string | null;
  hasEnvFallback?: boolean;
}

export async function listDbBackups() {
  const { data } = await api.get('/admin/db-backups');
  return data.data as DbBackupMeta[];
}

export async function createDbBackup(compress = true, connectionId?: string | null) {
  const { data } = await api.post('/admin/db-backups', { compress, connectionId: connectionId ?? null });
  return data.data as DbBackupMeta;
}

export async function uploadDbBackup(file: File, onProgress?: (pct: number) => void) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/admin/db-backups/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => { if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100)); },
  });
  return data.data as DbBackupMeta;
}

export async function downloadDbBackup(filename: string) {
  const resp = await api.get(`/admin/db-backups/${encodeURIComponent(filename)}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteDbBackup(filename: string) {
  const { data } = await api.delete(`/admin/db-backups/${encodeURIComponent(filename)}`);
  return data;
}

export async function restoreDbBackup(filename: string, connectionId?: string | null) {
  const { data } = await api.post(`/admin/db-backups/${encodeURIComponent(filename)}/restore`, { connectionId: connectionId ?? null });
  return data.data as { preRestoreFile?: string };
}

// ── DB Connection management ────────────────────────────────────

export async function listDbConnections() {
  const { data } = await api.get('/admin/db-backups/connections/list');
  return data.data as ConnectionConfig;
}

export async function saveDbConnections(config: ConnectionConfig) {
  const { data } = await api.put('/admin/db-backups/connections', config);
  return data;
}

export async function testDbConnection(conn: Partial<DbConnection>) {
  const { data } = await api.post('/admin/db-backups/connections/test', conn);
  return data.data as { ok: boolean; version?: string; error?: string };
}

export default api;
