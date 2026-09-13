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
  /** 学习进度（由该书关联的多个视频聚合；无视频时为 null） */
  videoProgress?: BookVideoProgress | null;
}

/** 一本书的学习进度聚合：以视频为单位，书内取多个视频的综合 */
export interface BookVideoProgress {
  total: number;
  /** 手动标记完成的数量 */
  done: number;
  /** 已看完（未手动完成）的数量 */
  watched: number;
  /** 整本书完成度 0-100 */
  percent: number;
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
