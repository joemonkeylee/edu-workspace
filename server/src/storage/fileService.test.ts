import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createFileServiceApp, resolveObjectPath } from './fileService.js';

const TOKEN = 'test-file-service-token-at-least-32-chars';

test('object keys remain inside the configured root on all platforms', () => {
  const root = path.resolve(os.tmpdir(), 'file-service-root');
  assert.equal(resolveObjectPath(root, 'pdf/books/42/original.pdf'), path.join(root, 'pdf', 'books', '42', 'original.pdf'));
  for (const key of ['../outside', 'pdf/../../outside', '/absolute/path', 'pdf\\books\\file.pdf', 'C:/outside']) {
    assert.throws(() => resolveObjectPath(root, key), { status: 400 });
  }
});

test('file service authenticates and supports upload, HEAD, Range, listing, and delete', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-file-service-'));
  const server = createServer(createFileServiceApp({ root, token: TOKEN, maxUploadBytes: 1024 }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${TOKEN}` };

  const denied = await fetch(`${baseUrl}/v1/status`);
  assert.equal(denied.status, 401);

  const initialized = await fetch(`${baseUrl}/v1/initialize`, { method: 'POST', headers });
  assert.equal(initialized.status, 200);

  const content = Buffer.from('0123456789');
  const uploaded = await fetch(`${baseUrl}/v1/objects/pdf/books/42/original.pdf`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/pdf' },
    body: content,
  });
  assert.equal(uploaded.status, 201);

  const duplicate = await fetch(`${baseUrl}/v1/objects/pdf/books/42/original.pdf`, {
    method: 'PUT',
    headers,
    body: content,
  });
  assert.equal(duplicate.status, 409);

  const head = await fetch(`${baseUrl}/v1/objects/pdf/books/42/original.pdf`, { method: 'HEAD', headers });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');

  const ranged = await fetch(`${baseUrl}/v1/objects/pdf/books/42/original.pdf`, {
    headers: { ...headers, Range: 'bytes=3-6' },
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 3-6/10');
  assert.equal(await ranged.text(), '3456');

  const listed = await fetch(`${baseUrl}/v1/objects?prefix=pdf/books&limit=10`, { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).data.map((item: any) => item.key), ['pdf/books/42/original.pdf']);

  const removed = await fetch(`${baseUrl}/v1/objects/pdf/books/42/original.pdf`, { method: 'DELETE', headers });
  assert.equal(removed.status, 200);
  const missing = await fetch(`${baseUrl}/v1/objects/pdf/books/42/original.pdf`, { headers });
  assert.equal(missing.status, 404);
});
