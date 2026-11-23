import 'dotenv/config';
import path from 'path';
import { createFileServiceApp } from './fileService.js';

const token = process.env.FILE_SERVICE_TOKEN || '';
const root = path.resolve(process.env.STORAGE_DIR || './storage');
const host = process.env.FILE_SERVICE_HOST || '127.0.0.1';
const port = Number(process.env.FILE_SERVICE_PORT || 4010);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('FILE_SERVICE_PORT must be a valid TCP port');
}

const app = createFileServiceApp({ root, token });
app.listen(port, host, () => {
  console.log(`[file-service] listening on ${host}:${port}`);
  console.log(`[file-service] root configured; run POST /v1/initialize to prepare directories`);
});
