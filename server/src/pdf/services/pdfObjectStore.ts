import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getStorageRoot } from '../../services/storage.js';

export const REMOTE_PDF_ROOT = 'object://pdf';

function remoteConfig() {
  const baseUrl = process.env.PDF_STORAGE_API_URL?.trim().replace(/\/+$/, '');
  const token = process.env.PDF_STORAGE_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new Error('PDF_STORAGE_MODE=http requires PDF_STORAGE_API_URL and PDF_STORAGE_TOKEN');
  }
  const parsed = new URL(baseUrl);
  const isLoopbackHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
    throw new Error('PDF storage API must use HTTPS except for localhost development');
  }
  return { baseUrl, token };
}

export function isRemotePdfStorage(): boolean {
  const mode = (process.env.PDF_STORAGE_MODE || 'local').trim().toLowerCase();
  if (mode !== 'local' && mode !== 'http') {
    throw new Error(`Unsupported PDF_STORAGE_MODE: ${mode}`);
  }
  return mode === 'http';
}

export function isRemotePdfRef(rootPath: string): boolean {
  return rootPath === REMOTE_PDF_ROOT;
}

export function pdfObjectKey(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new Error('Invalid PDF storage object key');
  }
  return `pdf/${normalized}`;
}

function objectUrl(key: string): string {
  const { baseUrl } = remoteConfig();
  return `${baseUrl}/v1/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function requestObject(key: string, init: RequestInit = {}): Promise<globalThis.Response> {
  const { token } = remoteConfig();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(objectUrl(key), { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`PDF storage request failed (${response.status}): ${body || response.statusText}`);
  }
  return response;
}

export async function initializeRemotePdfStorage() {
  const { baseUrl, token } = remoteConfig();
  const response = await fetch(`${baseUrl}/v1/initialize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`PDF storage initialization failed (${response.status}): ${body || response.statusText}`);
  }
  return response.json();
}

export async function getPdfStorageStatus() {
  if (isRemotePdfStorage()) {
    const { baseUrl, token } = remoteConfig();
    const response = await fetch(`${baseUrl}/v1/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`PDF storage status failed (${response.status})`);
    return { mode: 'http' as const, ...(await response.json() as { data: { initialized: boolean; writable: boolean } }).data };
  }

  const root = path.join(getStorageRoot(), 'pdf');
  let writable = false;
  try {
    await fs.promises.mkdir(root, { recursive: true });
    const probe = path.join(root, `.write-check-${process.pid}-${Date.now()}`);
    await fs.promises.writeFile(probe, '');
    await fs.promises.unlink(probe);
    writable = true;
  } catch (error) {
    console.warn(`[pdf-storage] local storage status check failed: ${root}`, error);
  }
  return { mode: 'local' as const, initialized: fs.existsSync(root), writable };
}

export async function initializePdfStorage() {
  if (isRemotePdfStorage()) return initializeRemotePdfStorage();
  const root = path.join(getStorageRoot(), 'pdf');
  for (const relative of ['books', 'covers', 'thumbs', 'crops']) {
    await fs.promises.mkdir(path.join(root, relative), { recursive: true });
  }
  return getPdfStorageStatus();
}

export async function uploadPdfObject(key: string, filePath: string, overwrite = false) {
  const body = Readable.toWeb(fs.createReadStream(filePath)) as unknown as BodyInit;
  const response = await requestObject(key, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fs.statSync(filePath).size),
      ...(overwrite ? { 'X-Overwrite': 'true' } : {}),
    },
    body,
    duplex: 'half',
  } as RequestInit);
  return response.json() as Promise<{ data: { key: string; size: number; sha256: string } }>;
}

export async function uploadPdfBuffer(key: string, content: Buffer, contentType = 'application/octet-stream') {
  const response = await requestObject(key, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(content.length) },
    body: new Blob([new Uint8Array(content)]),
  });
  return response.json() as Promise<{ data: { key: string; size: number; sha256: string } }>;
}

export async function downloadPdfObject(key: string, targetPath: string) {
  if (!isRemotePdfStorage()) {
    const sourcePath = localPdfObjectPath(key);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.copyFile(sourcePath, targetPath);
    return (await fs.promises.stat(targetPath)).size;
  }
  const response = await requestObject(key);
  if (!response.body) throw new Error('PDF storage returned an empty response body');
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await pipeline(Readable.from(response.body as AsyncIterable<Uint8Array>), fs.createWriteStream(targetPath, { flags: 'w' }));
  return Number(response.headers.get('content-length') || 0);
}

export async function getPdfObjectResponse(key: string, range?: string) {
  const { token } = remoteConfig();
  const headers = range ? { Range: range } : undefined;
  const authenticatedHeaders = new Headers(headers);
  authenticatedHeaders.set('Authorization', `Bearer ${token}`);
  return fetch(objectUrl(key), { headers: authenticatedHeaders });
}

export async function getPdfObjectMetadata(key: string): Promise<{ size: number; lastModified: string | null } | null> {
  if (!isRemotePdfStorage()) {
    try {
      const stat = await fs.promises.stat(localPdfObjectPath(key));
      if (!stat.isFile()) return null;
      return { size: stat.size, lastModified: stat.mtime.toUTCString() };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
  const { token } = remoteConfig();
  const response = await fetch(objectUrl(key), {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`PDF storage metadata request failed (${response.status})`);
  return {
    size: Number(response.headers.get('content-length') || 0),
    lastModified: response.headers.get('last-modified'),
  };
}

export async function deletePdfObject(key: string) {
  const { token } = remoteConfig();
  const response = await fetch(objectUrl(key), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`PDF storage delete failed (${response.status}): ${body || response.statusText}`);
  }
}

export function localPdfObjectPath(key: string): string {
  const root = path.resolve(getStorageRoot());
  const target = path.resolve(root, ...key.split('/'));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('PDF object path is outside storage root');
  return target;
}

export async function pdfObjectExists(key: string): Promise<boolean> {
  if (isRemotePdfStorage()) return Boolean(await getPdfObjectMetadata(key));
  return fs.existsSync(localPdfObjectPath(key));
}

export async function putPdfObjectFromFile(key: string, sourcePath: string, overwrite = false) {
  if (isRemotePdfStorage()) return uploadPdfObject(key, sourcePath, overwrite);
  const target = localPdfObjectPath(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  if (overwrite) await fs.promises.copyFile(sourcePath, target);
  else await fs.promises.copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
  const stat = await fs.promises.stat(target);
  return { data: { key, size: stat.size, sha256: null as string | null } };
}

export async function putPdfObjectFromBuffer(key: string, content: Buffer, contentType?: string) {
  if (isRemotePdfStorage()) return uploadPdfBuffer(key, content, contentType);
  const target = localPdfObjectPath(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, content, { flag: 'wx' });
  return { data: { key, size: content.length, sha256: null as string | null } };
}

export async function removePdfObject(key: string) {
  if (isRemotePdfStorage()) return deletePdfObject(key);
  await fs.promises.rm(localPdfObjectPath(key), { force: true });
}
