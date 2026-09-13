export interface TocNode {
  title: string;
  page: number;
  children?: TocNode[];
  ignored?: boolean;
}

export interface PairSummary {
  role: 'textbook' | 'answer' | null;
  partnerCount: number;
  partners: Array<{ id: number; title: string }>;
}

export interface Book {
  id: number;
  title: string;
  category: string;
  grade?: string;
  subject?: string;
  batchId?: string;
  /** 资源类型：book = 普通书籍；course = 带讲解视频的课程资源 */
  kind?: 'book' | 'course';
  coverPage?: number;
  totalPages: number;
  storagePath: string;
  fileHash?: string;
  sourcePaths?: string[];
  tocJson: TocNode[];
  attributes?: Record<string, any>;
  createdAt: string;
  annotations?: Annotation[];
  availableDpis?: number[];
  pdfFileName?: string | null;
  pdfUrl?: string | null;
  isFavorite?: boolean;
  pairSummary?: PairSummary | null;
  /** 关联的讲解视频数量（不含文件缺失的） */
  videoCount?: number;
}

export interface Annotation {
  id: number;
  bookId: number;
  pageNumber: number;
  type: 'note' | 'highlight' | 'crop';
  contentJson: any;
  tags: string | null;
  createdAt: string;
  /** Linked mistake records (crop annotations only) */
  mistakes?: Mistake[];
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
