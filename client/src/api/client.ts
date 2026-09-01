import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export async function getBooks() {
  const { data } = await api.get('/books');
  return data;
}

export async function getBook(id: number) {
  const { data } = await api.get(`/books/${id}`);
  return data;
}

export async function deleteBook(id: number) {
  const { data } = await api.delete(`/books/${id}`);
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

export function scanPdfUrl(targetPath: string, category: string, dpi: number = 200) {
  const params = new URLSearchParams({ targetPath, category, dpi: String(dpi) });
  return `/api/admin/scan-pdf?${params}`;
}

export function pageImageUrl(storagePath: string, pageNumber: number) {
  const padded = String(pageNumber).padStart(4, '0');
  return `${storagePath}page-${padded}.png`;
}

export default api;
