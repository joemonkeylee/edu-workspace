// Color palette for annotation markers — each annotation on a page gets a
// distinct color so the page marker matches the side panel card.
export const ANNOTATION_COLORS = [
  { hex: '#ef4444', bg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-300 dark:border-red-500/40', text: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },     // red
  { hex: '#f97316', bg: 'bg-orange-50 dark:bg-orange-500/10', border: 'border-orange-300 dark:border-orange-500/40', text: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500' }, // orange
  { hex: '#eab308', bg: 'bg-yellow-50 dark:bg-yellow-500/10', border: 'border-yellow-300 dark:border-yellow-500/40', text: 'text-yellow-600 dark:text-yellow-400', dot: 'bg-yellow-500' },  // yellow
  { hex: '#22c55e', bg: 'bg-green-50 dark:bg-green-500/10', border: 'border-green-300 dark:border-green-500/40', text: 'text-green-600 dark:text-green-400', dot: 'bg-green-500' },     // green
  { hex: '#06b6d4', bg: 'bg-cyan-50 dark:bg-cyan-500/10', border: 'border-cyan-300 dark:border-cyan-500/40', text: 'text-cyan-600 dark:text-cyan-400', dot: 'bg-cyan-500' },         // cyan
  { hex: '#8b5cf6', bg: 'bg-violet-50 dark:bg-violet-500/10', border: 'border-violet-300 dark:border-violet-500/40', text: 'text-violet-600 dark:text-violet-400', dot: 'bg-violet-500' }, // violet
  { hex: '#ec4899', bg: 'bg-pink-50 dark:bg-pink-500/10', border: 'border-pink-300 dark:border-pink-500/40', text: 'text-pink-600 dark:text-pink-400', dot: 'bg-pink-500' },         // pink
  { hex: '#14b8a6', bg: 'bg-teal-50 dark:bg-teal-500/10', border: 'border-teal-300 dark:border-teal-500/40', text: 'text-teal-600 dark:text-teal-400', dot: 'bg-teal-500' },         // teal
];

/**
 * Assigns a color index to each annotation on the same page.
 * Returns a map of annotation.id → color index.
 */
export function buildAnnotationColorIndex(annotations: { id: number; pageNumber: number }[]): Map<number, number> {
  const result = new Map<number, number>();
  const pageCounters = new Map<number, number>();
  for (const ann of annotations) {
    const idx = pageCounters.get(ann.pageNumber) || 0;
    result.set(ann.id, idx % ANNOTATION_COLORS.length);
    pageCounters.set(ann.pageNumber, idx + 1);
  }
  return result;
}

export function getAnnotationColor(colorIndex: number | undefined) {
  return ANNOTATION_COLORS[(colorIndex ?? 0) % ANNOTATION_COLORS.length];
}
