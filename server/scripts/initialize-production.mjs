import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const schemaPath = path.join(serverDir, 'prisma', 'schema.prisma');
const productionUrl = process.env.PRODUCTION_DATABASE_URL?.trim();
const fileServiceUrl = process.env.FILE_SERVICE_URL?.trim().replace(/\/+$/, '');
const fileServiceToken = process.env.FILE_SERVICE_TOKEN?.trim();

function databaseLocation(value) {
  const url = new URL(value);
  const host = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'loopback' : url.hostname.toLowerCase();
  const port = url.port || (url.protocol === 'mysql:' ? '3306' : '');
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  return `${url.protocol}//${host}:${port}/${database}`;
}

if (process.argv.includes('--help')) {
  console.log('Usage: npm run db:init:production --workspace=server -- --confirm-empty');
  console.log('Initializes the schema only after confirming the dedicated production database is empty.');
  process.exit(0);
}
if (!process.argv.includes('--confirm-empty')) {
  throw new Error('Refusing to initialize production. Re-run with --confirm-empty only after verifying the target database is dedicated and empty.');
}
if (!productionUrl || !fileServiceUrl || !fileServiceToken) {
  throw new Error('Set PRODUCTION_DATABASE_URL, FILE_SERVICE_URL, and FILE_SERVICE_TOKEN before initialization.');
}
if (process.env.DATABASE_URL && databaseLocation(productionUrl) === databaseLocation(process.env.DATABASE_URL.trim())) {
  throw new Error('PRODUCTION_DATABASE_URL matches DATABASE_URL; refusing to run schema initialization against the configured application database.');
}
if (fileServiceToken.length < 32) {
  throw new Error('FILE_SERVICE_TOKEN must be at least 32 characters.');
}
const fileServiceOrigin = new URL(fileServiceUrl);
const isLoopbackHttp = fileServiceOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(fileServiceOrigin.hostname);
if (fileServiceOrigin.protocol !== 'https:' && !isLoopbackHttp) {
  throw new Error('FILE_SERVICE_URL must use HTTPS except for localhost.');
}

const target = new PrismaClient({ datasources: { db: { url: productionUrl } } });
try {
  await target.$connect();
  const tables = await target.$queryRaw`SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()`;
  if (tables.length > 0) {
    throw new Error(`Production database is not empty (${tables.length} tables found); no schema changes were made.`);
  }
} finally {
  await target.$disconnect();
}

const storageResponse = await fetch(`${fileServiceUrl}/v1/initialize`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${fileServiceToken}` },
});
if (!storageResponse.ok) {
  throw new Error(`PDF file service initialization failed (${storageResponse.status}): ${await storageResponse.text()}`);
}

const prismaCli = require.resolve('prisma/build/index.js');
for (const args of [
  ['db', 'push', '--schema', schemaPath],
  ['generate', '--schema', schemaPath],
]) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: productionUrl },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Prisma ${args[0]} failed with exit code ${result.status}`);
}

console.log('Production PDF storage directories and empty-database schema initialized.');
