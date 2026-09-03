import { create } from 'zustand';
import type { Book, Annotation, Mistake, ToolMode } from '../types';
import * as api from '../api/client';

interface StoreState {
  books: Book[];
  currentBook: Book | null;
  currentPage: number;
  zoom: number;
  tool: ToolMode;
  annotations: Annotation[];
  mistakes: Mistake[];
  loading: boolean;

  fetchBooks: () => Promise<void>;
  fetchBook: (id: number) => Promise<void>;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: ToolMode) => void;
  fetchAnnotations: (bookId: number) => Promise<void>;
  fetchMistakes: (params?: Record<string, any>) => Promise<void>;
  removeBook: (id: number) => Promise<void>;
  removeAnnotation: (id: number) => Promise<void>;
  clearCurrent: () => void;
}

export const useStore = create<StoreState>((set, get) => ({
  books: [],
  currentBook: null,
  currentPage: 1,
  zoom: 1,
  tool: 'view',
  annotations: [],
  mistakes: [],
  loading: false,

  fetchBooks: async () => {
    set({ loading: true });
    const books = await api.getBooks();
    set({ books, loading: false });
  },

  fetchBook: async (id: number) => {
    set({ loading: true });
    const book = await api.getBook(id);
    set({ currentBook: book, currentPage: 1, loading: false });
  },

  setCurrentPage: (page: number) => set({ currentPage: page }),
  setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(8, zoom)) }),
  setTool: (tool: ToolMode) => set({ tool }),

  fetchAnnotations: async (bookId: number) => {
    const annotations = await (await import('../api/client')).default.get(`/annotations/book/${bookId}`).then(r => r.data);
    set({ annotations });
  },

  fetchMistakes: async (params?: Record<string, any>) => {
    const mistakes = await api.getMistakes(params);
    set({ mistakes });
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
