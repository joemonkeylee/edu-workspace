import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type EnglishSort = 'default' | 'recent' | 'lessons' | 'difficulty_asc' | 'difficulty_desc';

interface EnglishLibraryState {
  search: string;
  category: string;
  sort: EnglishSort;
  expanded: Record<string, boolean>;
  setSearch: (v: string) => void;
  setCategory: (v: string) => void;
  setSort: (v: EnglishSort) => void;
  toggleExpanded: (key: string) => void;
  resetExpanded: () => void;
}

export const useEnglishLibraryStore = create<EnglishLibraryState>()(
  persist(
    (set) => ({
      search: '',
      category: 'all',
      sort: 'default',
      expanded: {},
      setSearch: (v) => set({ search: v }),
      setCategory: (v) => set({ category: v }),
      setSort: (v) => set({ sort: v }),
      toggleExpanded: (key) =>
        set((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } })),
      resetExpanded: () => set({ expanded: {} }),
    }),
    {
      name: 'english-library-filters',
      partialize: (s) => ({
        search: s.search,
        category: s.category,
        sort: s.sort,
        expanded: s.expanded,
      }),
    }
  )
);
