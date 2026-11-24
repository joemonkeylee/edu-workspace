import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createFileServiceApp } from '../storage/fileService.js';
import { deleteBackup, getBackupDownloadPath, listBackups, uploadBackup } from './dbBackup.js';

const TOKEN = 'test-backup-storage-token-at-least-32-chars';

test('database backups can be uploaded, listed, downloaded, and deleted remotely', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-backup-storage-'));
  const storageRoot = path.join(root, 'remote-storage');
  const server = createServer(createFileServiceApp({ root: storageRoot, token: TOKEN }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const env = {
    PDF_STORAGE_MODE: process.env.PDF_STORAGE_MODE,
    PDF_STORAGE_API_URL: process.env.PDF_STORAGE_API_URL,
    PDF_STORAGE_TOKEN: process.env.PDF_STORAGE_TOKEN,
  };
  process.env.PDF_STORAGE_MODE = 'http';
  process.env.PDF_STORAGE_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.PDF_STORAGE_TOKEN = TOKEN;

  const sourcePath = path.join(root, 'source.sql.gz');
  fs.writeFileSync(sourcePath, Buffer.from('backup contents'));

  t.after(async () => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const uploaded = await uploadBackup('backup-test.sql.gz', sourcePath);
  assert.equal(uploaded.size, 15);

  const backups = await listBackups();
  assert.equal(backups.length, 1);
  assert.equal(backups[0].filename, 'backup-test.sql.gz');

  const download = await getBackupDownloadPath('backup-test.sql.gz');
  assert.deepEqual(fs.readFileSync(download.filePath), Buffer.from('backup contents'));
  download.cleanup();

  await deleteBackup('backup-test.sql.gz');
  assert.deepEqual(await listBackups(), []);
});
