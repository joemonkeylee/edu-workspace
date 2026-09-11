import { create } from 'zustand';
import type { Book, Annotation, Mistake, ToolMode } from '../types';
import * as api from '../api/client';

interface StoreState {
  books: Book[];
  total: number;
  subjectOptions: string[];
  gradeOptions: string[];
  categoryOptions: { name: string; count: number }[];
  currentBook: Book | null;
  currentPage: number;
  zoom: number;
  tool: ToolMode;
  booksPerRow: number;
  pageSize: number;
  annotations: Annotation[];
  mistakes: Mistake[];
  loading: boolean;

  fetchBooks: (params?: { category?: string; grade?: string; subject?: string; search?: string; sort?: string; page?: number; pageSize?: number }) => Promise<void>;
  fetchBook: (id: number) => Promise<void>;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: ToolMode) => void;
  setBooksPerRow: (n: number) => void;
  fetchAnnotations: (bookId: number) => Promise<void>;
  fetchMistakes: (params?: Record<string, any>) => Promise<void>;
  removeBook: (id: number) => Promise<void>;
  removeAnnotation: (id: number) => Promise<void>;
  clearCurrent: () => void;
}

const STORAGE_KEY_BPR = 'edu-books-per-row';
function loadBooksPerRow(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BPR);
    if (raw) return Math.max(3, Math.min(10, parseInt(raw, 10) || 8));
  } catch { /* ignore */ }
  return 8;
}

export const useStore = create<StoreState>((set, get) => ({
  books: [],
  total: 0,
  subjectOptions: [],
  gradeOptions: [],
  categoryOptions: [] as { name: string; count: number }[],
  currentBook: null,
  currentPage: 1,
  zoom: 1,
  tool: 'view',
  booksPerRow: loadBooksPerRow(),
  pageSize: loadBooksPerRow() * 2,
  annotations: [],
  mistakes: [],
  loading: false,

  fetchBooks: async (params) => {
    set({ loading: true });
    try {
      const res = await api.getBooks(params);
      set({
        books: res.data,
        total: res.total,
        subjectOptions: res.options.subjects,
        gradeOptions: res.options.grades,
        categoryOptions: res.options.categories,
      });
    } catch (e) {
      console.error('fetchBooks failed:', e);
    } finally {
      set({ loading: false });
    }
  },

  fetchBook: async (id: number) => {
    set({ loading: true });
    try {
      const book = await api.getBook(id);
      set({ currentBook: book, currentPage: 1 });
    } catch (e) {
      console.error('fetchBook failed:', e);
    } finally {
      set({ loading: false });
    }
  },

  setCurrentPage: (page: number) => set({ currentPage: page }),
  setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(8, zoom)) }),
  setTool: (tool: ToolMode) => set({ tool }),
  setBooksPerRow: (n: number) => {
    const clamped = Math.max(3, Math.min(10, n));
    try { localStorage.setItem(STORAGE_KEY_BPR, String(clamped)); } catch { /* ignore */ }
    set({ booksPerRow: clamped, pageSize: clamped * 2 });
  },

  fetchAnnotations: async (bookId: number) => {
    try {
      const res = await api.default.get(`/annotations/book/${bookId}`);
      set({ annotations: res.data.data });
    } catch (e) {
      console.error('fetchAnnotations failed:', e);
    }
  },

  fetchMistakes: async (params?: Record<string, any>) => {
    try {
      const result = await api.getMistakes(params);
      set({ mistakes: result.data });
    } catch (e) {
      console.error('fetchMistakes failed:', e);
    }
  },

  removeBook: async (id: number) => {
    await api.deleteBook(id);
    set({ books: get().books.filter(b => b.id !== id) });
  },

  removeAnnotation: async (id: number) => {
    await api.deleteAnnotation(id);
    set({ annotations: get().annotations.filter(a => a.id !== id) });
  },

  clearCurrent: () => set({ currentBook: null, annotations: [], currentPage: 1, tool: 'view' }),
}));
