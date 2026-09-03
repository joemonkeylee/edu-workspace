export interface TocNode {
  title: string;
  page: number;
  children?: TocNode[];
}

export interface Book {
  id: number;
  title: string;
  category: string;
  totalPages: number;
  storagePath: string;
  tocJson: TocNode[];
  createdAt: string;
  annotations?: Annotation[];
  availableDpis?: number[];
}

export interface Annotation {
  id: number;
  bookId: number;
  pageNumber: number;
  type: 'note' | 'highlight' | 'crop';
  contentJson: any;
  tags: string | null;
  createdAt: string;
}

export interface Mistake {
  id: number;
  annotationId: number;
  bookId: number;
  pageNumber: number;
  imagePath: string;
  subject: string;
  tags: string | null;
  reviewStatus: number;
  createdAt: string;
  book?: { title: string; category: string };
}

export type ToolMode = 'view' | 'note' | 'highlight' | 'crop';
