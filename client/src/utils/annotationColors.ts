// Color palette for annotation markers — each annotation on a page gets a
// distinct color so the page marker matches the side panel card.
export const ANNOTATION_COLORS = [
  { hex: '#ef4444', bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-600', dot: 'bg-red-500' },     // red
  { hex: '#f97316', bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-600', dot: 'bg-orange-500' }, // orange
  { hex: '#eab308', bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-600', dot: 'bg-yellow-500' },  // yellow
  { hex: '#22c55e', bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-600', dot: 'bg-green-500' },     // green
  { hex: '#06b6d4', bg: 'bg-cyan-50', border: 'border-cyan-300', text: 'text-cyan-600', dot: 'bg-cyan-500' },         // cyan
  { hex: '#8b5cf6', bg: 'bg-violet-50', border: 'border-violet-300', text: 'text-violet-600', dot: 'bg-violet-500' }, // violet
  { hex: '#ec4899', bg: 'bg-pink-50', border: 'border-pink-300', text: 'text-pink-600', dot: 'bg-pink-500' },         // pink
  { hex: '#14b8a6', bg: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-600', dot: 'bg-teal-500' },         // teal
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
