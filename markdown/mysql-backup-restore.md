# MySQL 数据库备份/还原功能方案

## Context（背景）

项目 `edu-workspace` 使用 MySQL(`edu_workspace` 库)+ Prisma + Express。当前缺少数据库备份能力,管理员无法在系统内做整库导出/导入。需要新增一个仅管理员可用的备份/还原模块:服务器端可整库导出,文件可下载到本地;本地备份可上传回服务器;任意备份可一键还原(还原前自动先备份当前库,作为安全网)。

### 备份范围(重要)

**备份内容严格限定为 MySQL 数据库本身(schema + data)。`storage/` 资源目录(PDF、页面图片、裁剪图、封面等文件资产)在任何时候都不参与备份/还原流程。**

理由:`storage/` 是独立的文件资产目录,体量大且已有 `/admin/storage` 页面单独管理其路径与迁移;数据库与文件资产的生命周期、备份手段、体积都完全不同,混在一起会让备份文件膨胀且无意义地重复存储 PDF 原件。本功能只管数据库,storage 资产的管理交给现有的资源目录功能。

### 备份文件存储位置(明确)

**备份文件存放在 `{storageRoot}/db-backups/` 子目录下,不是 MySQL 安装目录。**

- `storageRoot` 默认为 `./storage`(即服务器项目目录下的 `storage/` 文件夹),可通过 `STORAGE_DIR` 环境变量配置,也可在后台「资源目录」页(`AppSetting.storageRoot`)动态修改。
- 备份子目录:`{storageRoot}/db-backups/`,首次使用时自动创建。
- 跨平台兼容:全程使用 Node.js `path.join()` 拼接路径,Windows(反斜杠)和 Linux(正斜杠)都能正常工作;`mysqldump`/`mysql` CLI 调用通过 `spawn` 并依赖系统 PATH,无需硬编码安装路径。
- 服务器当前是 Windows,未来可能迁 Linux:代码不假设任何 OS 特定路径,不依赖 shell 管道(`|`),而是用 Node stream 在进程间传递数据(`dump.stdout.pipe(gzip).pipe(file)` / `file.pipe(gunzip).pipe(mysql.stdin)`),确保两种系统都可用。

核心依赖已就位:服务端已装 `multer`(`server/src/routes/annotations.ts` 有 memoryStorage 用法),客户端 axios 实例带 token 拦截器,`adminRequired` 中间件可直接复用。

## 设计决策

| 项 | 选择 | 理由 |
|---|---|---|
| 备份工具 | `mysqldump` / `mysql` CLI | 标准、可靠、完整支持所有 MySQL 特性;服务端 macOS/生产机已装 MySQL |
| 压缩格式 | **默认 gzip (`.sql.gz`)**,同时支持纯 `.sql` | 用户确认:两种都支持,默认前一种;gzip 显著省空间 |
| 文件命名 | `backup-YYYYMMDD-HHmmss.sql.gz`;还原前自动备份:`pre-restore-YYYYMMDD-HHmmss.sql.gz` | 时间戳排序,前缀区分用途 |
| 还原前自动备份 | **是** | 用户确认;覆盖前先生成 pre-restore 备份,失败可回滚 |
| 备份目录 | `{storageRoot}/db-backups/` | 复用可配置 storageRoot,不引入新根目录 |
| 文件名安全 | 严格正则 `^[a-zA-Z0-9._-]+\.(sql\|sql\.gz)$` + `path.resolve` 防 traversal | 上传/下载/删除/还原全部校验 |
| 权限 | `adminRequired` 全局挂在 router 上 | AUTH_ENABLED=false 时直通;=true 时仅 admin |
| 响应格式 | 列表 `{ data: [...] }`,创建/上传 `{ data: meta }`,删除/还原 `{ success: true }` 或 `{ data: result }` | 遵循 AGENTS.md API 约定 |

## 后端实现

### 1. 新增 `server/src/services/dbBackup.ts`

核心服务,职责:

- `parseDatabaseUrl()` — 用 `new URL(process.env.DATABASE_URL)` 解析出 `{ host, port, user, password, database }`;`decodeURIComponent` 处理密码中的特殊字符。
- `getBackupsRoot()` / `ensureBackupsDir()` — 返回 `{storageRoot}/db-backups`,自动 mkdir。
- `resolveSafePath(filename)` — 校验正则 + `path.resolve` 后检查必须以 `getBackupsRoot()` 开头,否则抛 `invalid filename`。
- `listBackups()` — `fs.readdirSync` + `fs.statSync` 收集 meta(`filename/size/createdAt/compressed/type`),按 `createdAt` 降序。
- `createBackup({ compress=true, tag? })` — `spawn('mysqldump', ['-h', host, '-P', port, '-u', user, `-p${password}`, db])`;compress 时 `dump.stdout.pipe(zlib.createGzip()).pipe(writeStream)`,否则直接 pipe;收集 stderr;Promise 在 `close` 事件 resolve,失败时删除半成品文件并抛错(含 stderr)。
- `restoreBackup(filename)` — **先调 `createBackup({ compress:true, tag:'pre-restore' })`**,再 `spawn('mysql', [...])`;`readStream.pipe(zlib.createGunzip() 或直接).pipe(mysql.stdin)`;返回 `{ preRestoreFile }`。
- `deleteBackup(filename)` — `fs.unlink(resolveSafePath(filename))`,缺失文件不报错(幂等)。

注意: `-p` 与密码间**无空格**(MySQL CLI 约定);密码为空时不加 `-p` 参数。

### 2. 新增 `server/src/routes/adminDbBackups.ts`

参考 `server/src/routes/adminBookPairs.ts` 的结构:

```typescript
const router = Router();
router.use(adminRequired);          // 全局仅 admin(AUTH_ENABLED=false 时直通)

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, _f, cb) => cb(null, ensureBackupsDir()),
    filename: (_r, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (_r, file, cb) => {
    if (!/^[a-zA-Z0-9._-]+\.(sql(\.gz)?)$/.test(file.originalname))
      return cb(new Error('文件名仅允许字母数字及 .sql/.sql.gz 后缀'));
    cb(null, true);
  },
});
```

路由(全部 `asyncHandler` 包裹):

| Method | Path | 作用 |
|---|---|---|
| GET | `/api/admin/db-backups` | 列出全部备份 → `{ data: BackupMeta[] }` |
| POST | `/api/admin/db-backups` | 创建备份, body `{ compress?: boolean }`(默认 true) → `{ data: BackupMeta }` |
| POST | `/api/admin/db-backups/upload` | 上传文件(multipart `file` 字段) → `{ data: BackupMeta }` |
| GET | `/api/admin/db-backups/:filename/download` | `res.download(resolveSafePath(filename))` |
| DELETE | `/api/admin/db-backups/:filename` | 删除 → `{ success: true }` |
| POST | `/api/admin/db-backups/:filename/restore` | 还原(自动先备份) → `{ data: { preRestoreFile } }` |

`download` 路由要放在 `:filename` 前缀路由中,Express 按 `/:filename/download` 精确匹配不会被 `:filename` 兜底(因为有 `/download` 二级段)。

### 3. 修改 `server/src/index.ts`

加两行:import + mount。

```typescript
import adminDbBackupsRouter from './routes/adminDbBackups.js';
// ...
app.use('/api/admin/db-backups', adminDbBackupsRouter);
```

放在其他 `app.use('/api/admin/*')` 之后即可。

## 前端实现

### 4. 修改 `client/src/api/client.ts`

在文件末尾(admin API 区)追加导出接口与类型:

```typescript
export interface DbBackupMeta {
  filename: string;
  size: number;
  createdAt: string;
  compressed: boolean;
  type: 'backup' | 'pre-restore';
}

export async function listDbBackups() {
  const { data } = await api.get('/admin/db-backups');
  return data.data as DbBackupMeta[];
}
export async function createDbBackup(compress = true) {
  const { data } = await api.post('/admin/db-backups', { compress });
  return data.data as DbBackupMeta;
}
export async function uploadDbBackup(file: File, onProgress?: (pct: number) => void) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/admin/db-backups/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => { if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100)); },
  });
  return data.data as DbBackupMeta;
}
export async function downloadDbBackup(filename: string) {
  const resp = await api.get(`/admin/db-backups/${encodeURIComponent(filename)}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export async function deleteDbBackup(filename: string) {
  const { data } = await api.delete(`/admin/db-backups/${encodeURIComponent(filename)}`);
  return data;
}
export async function restoreDbBackup(filename: string) {
  const { data } = await api.post(`/admin/db-backups/${encodeURIComponent(filename)}/restore`);
  return data.data as { preRestoreFile?: string };
}
```

复用现有 `api` 实例 → 自动带 Bearer token、401 自动刷新。下载用 `responseType: 'blob'`,token 走拦截器,两种 AUTH 模式都可用。

### 5. 新增 `client/src/components/admin/DbBackup.tsx`

参考 `BooksTable.tsx` 的列表/操作模式与 `StorageSettings.tsx` 的设置页布局。页面结构:

```
┌──────────────────────────────────────────────────────────┐
│ 数据库备份                                                │
├──────────────────────────────────────────────────────────┤
│ [创建备份 format=gzip ▼]  [上传备份]                       │  ← 顶部操作区
├──────────────────────────────────────────────────────────┤
│ 文件名                    格式    大小    创建时间   操作    │
│ backup-20260912-...      .sql.gz  2.3MB   ...   下载 还原 删除│
│ pre-restore-20260912-... .sql.gz  2.1MB   ...   下载 还原 删除│
│ ...                                                       │
├──────────────────────────────────────────────────────────┤
│ 共 N 条                                                   │  ← 底部计数(列表通常不大,不设分页)
└──────────────────────────────────────────────────────────┘
```

要点:
- **创建备份**:按钮旁下拉选格式(默认 `gzip (.sql.gz)` / 可选 `SQL (.sql)`);点击 → `toast.loading('正在备份...')` → `createDbBackup(compress)` → 成功 toast + 刷新列表。
- **上传备份**:隐藏 `<input type="file" accept=".sql,.gz">`;触发后 `uploadDbBackup(file, onProgress)`;用 `toast.loading` 显示百分比;成功后刷新列表。文件名重复时后端 multer 会覆盖同名(可接受,或后续增量加去重)。
- **下载**:`downloadDbBackup(filename)`,无确认。
- **还原**(危险):`useConfirm()` 弹 ConfirmDialog,文案「还原将用 `<filename>` 覆盖当前数据库,系统会先自动备份当前数据。确定继续?」,确认按钮蓝色;确认后 `toast.loading` → `restoreDbBackup(filename)` → 成功 toast 提示已还原 + 已生成 `pre-restore-...` 备份。
- **删除**(危险):ConfirmDialog 红色按钮「确定删除 `<filename>`?不可撤销」 → `deleteDbBackup`。
- **加载态**:`listDbBackups` 进行中时表格区显示半透明遮罩 + 居中旋转圈(遵用户偏好:loading 不隐藏分页区,用骨架/遮罩)。
- **空状态**:无备份时显示空提示 + 引导创建第一份。
- 文件大小用 `KB/MB/GB` 友好格式化;时间用本地化 `toLocaleString`。
- `pre-restore-*` 行在「格式」或单独列加个灰色 tag 标识「还原前」,便于识别。

### 6. 修改 `client/src/components/admin/AdminLayout.tsx`

在「系统管理」组追加菜单项(`Database` icon from lucide-react):

```typescript
{ path: '/admin/db-backup', label: '数据库备份', icon: Database, roles: ['admin'] },
```

import: `import { ..., Database } from 'lucide-react';`

### 7. 修改 `client/src/App.tsx`

加 import + route(在 `storage` 路由后):

```typescript
import DbBackup from './components/admin/DbBackup';
// ...
<Route path="db-backup" element={<AuthGuard allowedRoles={['admin']} redirectTo="/admin/books"><DbBackup /></AuthGuard>} />
```

## 待修改文件清单

| 文件 | 操作 |
|---|---|
| `server/src/services/dbBackup.ts` | 新增(备份/还原核心服务) |
| `server/src/routes/adminDbBackups.ts` | 新增(REST 路由 + multer 上传) |
| `server/src/index.ts` | 修改(import + mount 路由) |
| `client/src/api/client.ts` | 修改(追加 6 个 API 函数 + 类型) |
| `client/src/components/admin/DbBackup.tsx` | 新增(备份管理页) |
| `client/src/components/admin/AdminLayout.tsx` | 修改(加菜单项 + Database icon import) |
| `client/src/App.tsx` | 修改(加路由) |

## 验证

后端编译: `cd server && npx tsc --noEmit`(确保新文件无类型错误)
前端编译: `cd client && npx tsc --noEmit`(API + 组件类型正确)

功能验证(由用户在 dev 环境跑,本 agent 不启动 dev server):
1. 登录 admin,进入「系统管理 → 数据库备份」
2. 默认 gzip 创建一份备份 → 列表出现 `backup-*.sql.gz`,大小合理
3. 切到 SQL 格式再创建一份 → 出现 `backup-*.sql`
4. 点下载 → 浏览器下载对应文件;用 `gunzip -t` 验证 gzip 完整性
5. 上传刚才下载的文件 → 列表多出该文件
6. 对某备份点「还原」→ 弹确认 → 确认后出现 `pre-restore-*.sql.gz`,数据库内容被覆盖(可改一条数据验证)
7. 删除一份 → 列表移除
8. 故意用 URL 访问 `/api/admin/db-backups/../../etc/passwd/download` → 应 400/404(路径校验拦截)
9. AUTH_ENABLED=false 时教师/学生角色应仍可访问(直通);=true 时仅 admin 可见菜单与接口
