# edu-workspace 系统全面评估报告

> **评估日期**：2026-10-09
> **分支 / HEAD**：`feature/pdf-native` · `39523c9`
> **评估方式**：静态只读分析（未启动服务、未发起网络请求、未修改任何文件）
> **覆盖范围**：`server/src/**`（57 文件 / 11,839 行）、`server/prisma/**`、`client/src/**`（164 文件 / 37,564 行）、`deploy/**`、`scripts/**`、根 `package.json`、`README.md`
> **基线对比**：`markdown/system-audit-2026-09-26.md`（HEAD `f1541be`，之后共 37 个提交）
> **标注约定**：未标注 = 已实际读到代码确认；标 **（推测）** = 需运行时/数据依赖才能坐实

---

## 0. 一句话结论

**安全面：2026-09-26 发现的 8 条 P0 全部未修复，且新增了 2 条暴露面；功能面：备份子系统"永不清理 + 每次启动全量 dump"这条必然发生的运维事故仍在；架构面：legacy 图片版 / PDF 原生版 / 专栏版三套同构模型并存，所有"一版对一版错"的 Bug 都由此再生。**

同时必须说明：**底层卫生依然很好** —— 无 SQL 注入（唯一裸 SQL 的 `pdfMaterials.ts` 参数化正确）、无命令注入、JWT 无 `alg=none`、refresh token 只存哈希且支持 `tokenVersion` 吊销、SSE 一次性票据、PDF 删除有二次确认。问题集中在**"边界缺失"（谁可以调什么）**和**"两版不同步"**。

> ⚠️ **一个必须前置说明的前提**：当前磁盘上的根 `.env` 与 `server/.env` 均写着 `AUTH_ENABLED=false`，而 `deploy/com.edu-workspace.server.plist` 写着 `CLIENT_ORIGIN=*`。也就是说 —— **本文中所有"需要登录才能触发"的漏洞，在当前实际部署下不需要登录即可触发。** 下文不再逐条重复这一点，请务必以此为前提阅读。

---

## 1. 风险总览

| 等级 | 数量 | 含义 |
|---|---|---|
| 🔴 **P0 致命** | 5 | 数据/主机可被完全接管，或服务必然不可用，且当前配置下无需登录 |
| 🟠 **P1 高危** | 17 | 越权读写、数据丢失、明确功能 Bug、必然的运维事故 |
| 🟡 **P2 中危** | 18 | 性能热点、一致性缺陷、规范偏离、部署脆弱点 |
| 🔵 **P3 技术债** | 14 | 死代码、重复实现、类型松散、文档与实现不符 |

**与 2026-09-26 基线的关系**

- 基线 P0-1 ~ P0-8：**8 条全部仍存在**（逐条核对见 §7）
- 基线 P1 中：仅 `multer` 一条实际已缓解（锁定版为 `1.4.5-lts.2`，见 SEC-17）
- 本轮**新增** P0/P1：`/doc/*` 匿名静态（SEC-18）、`/storage/pdf/**` 匿名可下载（SEC-01 附带）、自动发布 plist 的 DOCTYPE 损坏（OPS-01）、`{user}` 占位符无自动替换（OPS-02）、`.github` 无 CI 且无任何测试（ENG-01）

---

## 2. 系统现状概览

### 2.1 模块矩阵

| 模块 | 后端路由 | 前端入口 | 状态 |
|---|---|---|---|
| 图片版书籍（legacy） | `/api/books`、`/api/annotations`、`/api/mistakes`、`/api/assignments` | `/books`、`/book/:id` | 线下在用，与 PDF 版功能重复 |
| PDF 原生版 | `/api/pdf/*`（books / annotations / mistakes / assignments / admin / collect / materials） | `/pdf`、`/pdf/book/:id` | 主线，功能最全 |
| 英语学习 | `/api/english-study` | `/english` | 在用 |
| 单词打字 | `/api/typing` | `/typing` | 在用 |
| 泛型复习引擎 | `/api/review` | 内嵌于英语/打字 | 在用（`review_item_state` 表**尚未在线上库创建**） |
| 专栏（column） | `/api/pdf/admin/collect*`、`columnImport.ts`、10 张 `column_*` 表 | **无一级入口** | ⚠️ **后端就绪、前端未落地**（`App.tsx` 无 `/column` 路由） |
| 错题样本演示 | 静态资源 | `/wrong-demo` | 演示用 |
| 管理后台 | `/api/admin/*`、`/api/pdf/admin/*` | `/admin/*` | 在用 |

### 2.2 部署拓扑

```
局域网设备 ──HTTP:5173──▶ Caddy ──/api/*、/storage/*──▶ 127.0.0.1:4000 (Express)
                            │                              │
                            ├─ 静态 client/dist            └─ MySQL 182.92.129.222:16240 (公网 IP，root 账号)
                            ├─ /doc/* → <repo>/doc/
                            └─ /data/*、/lt/* → 182.92.129.222
```

- 后端由 macOS `launchd` 以**登录用户**身份运行（非 root），`KeepAlive=true`、`RunAtLoad=true`
- 后端 `app.listen(PORT)` **未指定 host → 监听 0.0.0.0**，绕过 Caddy 直接可达
- 无 HTTPS
- 自动发布由 `launchd` 每 5 分钟触发 `auto-deploy-main.sh`

---

## 3. 🔴 P0 致命问题

### SEC-01 `/storage` 整目录匿名静态托管 —— 数据库备份可被任何人下载

**证据**

```ts
// server/src/index.ts:121-122
app.use('/storage/crops', cropsAuthMiddleware);
app.use('/storage', (req, res, next) => express.static(getStorageRoot())(req, res, next));
```

只有 `/storage/crops` 挂了鉴权（该中间件本身写得不错，见 §8）。备份目录**就在静态根之下**：

```ts
// server/src/services/dbBackup.ts:128-130
export function getBackupsRoot(): string {
  return path.join(getStorageRoot(), 'db-backups');
}
```

Caddy 也把 `/storage/*` 原样转发到后端：

```
# deploy/Caddyfile:9-11
handle /storage/* {
    reverse_proxy 127.0.0.1:4000
}
```

备份文件名以字母数字开头（`backup-*.sql.gz` / `auto-*.sql.gz` / `pre-restore-*.sql.gz`），因此 `express.static` 不会按 dotfile 忽略，**可直接枚举下载**。

**⚠️ 一处需要修正的当前事实**：本机 `server/storage/db-backups/` **当前不存在**（`ls` 报 No such file），`du` 无输出。所以这条目前是**潜在**风险而非正在被利用 —— 但只要调度器在存储根可写的机器（例如生产机把 `storageRoot` 指到外置盘）上跑过一次备份，整库 dump 就立刻匿名可下载。备份内含 `user` 表（bcrypt 口令哈希、手机号）与全部业务数据。

**同时**：PDF 模块的封面/缩略图/裁图也在此静态根下（`getPdfRoot() = storage/pdf`，见 `server/src/pdf/services/pdfStorage.ts:24-25`，本机存在 `pdf/covers`、`pdf/thumbs`、`pdf/crops`），同样匿名可下载。PDF 原件本身不走这里（走鉴权的 `/api/pdf/books/:id/file`），这点是对的。

**修复**：删除 `index.ts:122` 的泛挂载；改为对白名单子目录分别挂 `express.static`（`books`、`pdf/covers`、`pdf/thumbs`、`pdf/crops`），并对 `db-backups` 显式 403；备份下载统一走已有鉴权的 `/api/admin/db-backups/:filename/download`。

---

### SEC-02 PDF 书籍路由整族缺权限 —— 任意登录用户可任意文件读取 + 改删全库书

**证据（权限缺失）**

```ts
// server/src/pdf/routes/pdfBooks.ts:14
router.use(authRequired);        // ← 整族只有 authRequired，无 adminRequired
```

**证据（任意文件读取链）**

```ts
// server/src/pdf/routes/pdfBooks.ts:666-683  POST /:id/relocate
const { rootPath, filePath } = req.body || {};
...
const abs = path.resolve(String(filePath));
if (!fs.existsSync(abs)) return res.status(400).json({ error: 'file not found', filePath: abs });
const book = await prisma.pdfBook.update({ where: { id }, data: { rootPath: root, relPath, filePath: abs, ... } });
```

`relocate` **没有调用** `assertInsidePdfRoot`（该函数在 `:64-70` 定义，只在 `:438` cover / `:458` thumb 被调用）。写入后经 `:370 GET /:id/file` 流出，而该端点走的是 `resolveBookFile`（`:31-56`，优先返回 `book.filePath`），**同样没有根目录校验**。

**攻击链（任意 student 账号，两步）**：
1. `POST /api/pdf/books/1/relocate` body `{"rootPath":"/","filePath":"<任意绝对路径>"}`
2. `GET /api/pdf/books/1/file` → 拿到该文件内容

配合 SEC-06 的明文密钥，可读 `.env` → 拿到 `JWT_SECRET` 与数据库口令。即使在 `AUTH_ENABLED=true` 的多用户部署下这也成立。

**证据（越权写）**

```ts
// pdfBooks.ts:686  PATCH /:id   —— 改任意书标题/分类/年级/学科/封面页/目录
// pdfBooks.ts:712  DELETE /:id  —— 软删任意书
```

**对照（同仓库中正确实现）**：`server/src/pdf/routes/pdfAdminBooks.ts:17` 用 `teacherOrAdminRequired`，且 `:130 patch`、`:160 delete`、`:170 restore`、`:212 batch-delete` 都额外加了 `adminRequired`。legacy 侧 `server/src/routes/books.ts:326 (DELETE)` 与 `:342 (PUT)` 也用了 `adminRequired`。

**这就是典型的"一版对、一版错"**：`pdfBooks.ts` 是漏写的那一版，且用户态与 admin 态两套端点并存，越权路径比 admin 路径更容易触发。

**前端放大了它**：`PdfHome.tsx` 的「编辑 / 删除选中 / 保存」入口**完全没有角色判断**（`grep isAdmin\|useAuthStore` 在该文件命中 0 次），并直接调用用户态接口 `updateBook` / `deleteBook`（`client/src/pdf/pages/PdfHome.tsx:3-6` 从 `../api/pdfClient` 导入），最终打到 `PATCH/DELETE /api/pdf/books/:id`。

**修复**：① `pdfBooks.ts:686/712` 加 `adminRequired`；② `relocate` 改 `adminRequired` 且强制 `assertInsidePdfRoot(path.resolve(filePath))`；③ `GET /:id/file` 输出前再次校验解析出的绝对路径仍在允许根内；④ 前端编辑入口加 `isAdmin` 判断。

---

### SEC-05 生产配置把鉴权整体旁路（`AUTH_ENABLED=false` + `CLIENT_ORIGIN=*` + 监听 0.0.0.0）

**证据**

```ts
// server/src/middleware/auth.ts:82-85
export function adminRequired(req, res, next) {
  if (!isAuthEnabled()) {
    return injectStandalone(req, next);   // 注入合成 admin 身份，直接放行
  }
```

```ts
// server/src/services/auth.ts:40-43   —— 默认其实是 true（fail-safe，这点很好）
export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED !== 'false';
}
```

但配置显式关掉了它，且生产注入 `CLIENT_ORIGIN=*`：

```
server/.env:7                AUTH_ENABLED=false
根 .env:4, 7                 CLIENT_ORIGIN=* / AUTH_ENABLED=false
deploy/com.edu-workspace.server.plist:20-21   <key>CLIENT_ORIGIN</key><string>*</string>
```

```ts
// server/src/index.ts:54-57
app.use(cors({ origin: CLIENT_ORIGINS.includes('*') ? true : CLIENT_ORIGINS, credentials: true }));
// server/src/index.ts:123
app.listen(PORT, async () => { ... });     // 未指定 host → 0.0.0.0
```

**影响**：这本身是 AGENTS.md 明确设计意图（单机版无鉴权），但当前部署把它直接放在局域网上，于是爆炸半径 = 全库读写删：

- `/api/admin/**` 全部匿名可达（用户管理、资源目录设置、`db-backups` 的 **restore**）
- `/api/pdf/admin/collect/purge`、`/fs/delete` 等破坏性端点匿名可达
- `origin: true` + `credentials: true` → 任意网页可对被访用户的浏览器发起带凭证的跨域请求

**修复**：生产必须 `AUTH_ENABLED=true`；`CLIENT_ORIGIN` 收敛为具体地址（代码层拒绝 `*` 与 `credentials:true` 并存）；`app.listen(PORT, '127.0.0.1')`，仅经 Caddy 暴露。

---

### SEC-06 明文生产凭据落在工作区（公网 MySQL root + JWT 密钥）

**证据**

```
根 .env:1     DATABASE_URL="mysql://root:<明文口令>@182.92.129.222:16240/edu_workspace"
root .env:10  JWT_SECRET=66f105c2...b09b7ßd0d4...        ← 注意夹了一个非 ASCII 字符 ß
root .env:11  JWT_REFRESH_SECRET=90e3da73...
server/.env:1,10-11   同一份凭据重复一份
```

**好消息**：`.gitignore:13` 已忽略 `.env`，`git ls-files` 确认**未提交**（这点是对的，不要改坏）。

**影响**：① 数据库以 **root** 账号暴露在**公网 IP**；② 本机任何文件读取路径（如 SEC-02 的任意文件读取）即可拿走库口令与 JWT 密钥；③ `JWT_SECRET` 中混入非 ASCII 字符 `ß`，一旦被不同编码环境读取/重写，签名校验会不稳定（**推测**，需实跑确认）。

**修复**：改最小权限专用账号 + 强随机口令；密钥轮换并改由环境注入；去掉非 ASCII 字符；数据库端口限制来源 IP。

---

### FUNC-01 备份子系统命名不匹配 —— 永不清理 + 每次启动强制全量 dump

**证据（生成端）**

```ts
// server/src/services/dbBackup.ts:316
const prefix = tag ? `${tag}-` : 'backup-';
```

调度端传入的 `tag` 是 `'auto'` / `'change'`：

```ts
// server/src/services/dbBackupScheduler.ts:129-130
const tag = kind === 'change' ? 'change' : 'auto';
const meta = await createBackup({ compress: true, tag, connection: conn });
```

→ 实际落盘文件名是 `auto-20261009-xxxxxx.sql.gz`、`change-xxxxxx.sql.gz`。

**证据（匹配端）**

```ts
// server/src/services/dbBackupScheduler.ts:54
const latestPeriodic = backups.find((b) => b.filename.startsWith('backup-auto-'));   // 永远匹配不上

// server/src/services/dbBackupScheduler.ts:142-143
const periodic = backups.filter((b) => b.filename.startsWith('backup-auto-'));
const change = backups.filter((b) => b.filename.startsWith('backup-change-'));
```

**影响**（两条，都是必然发生的运维事故）：
1. `cleanupOldBackups()` 永不命中 → 周期备份（每 6h）+ 变更备份（5min 去抖）无限堆积直到磁盘写满（`ENOSPC`）。
2. `latestPeriodic` 恒 `undefined` → **每次进程启动都会触发一次全量 mysqldump**（`:55-58`），配合 `KeepAlive=true` 的反复重启会形成 dump 风暴。

**附带**：`createBackup` 返回值的 `type` 对任何 tag 都写成 `'pre-restore'`（`dbBackup.ts:357` `type: tag ? 'pre-restore' : 'backup'`），`auto`/`change` 备份的即时返回值类型错误（`listBackups` 会按文件名重算，所以只有 create 的返回值受影响）。

**修复**：两侧字面统一（推荐把生成端改为 `backup-auto-` / `backup-change-`）；清理增加"按 mtime + 剩余磁盘空间"双保险；`type` 按 tag 正确映射。

---

## 4. 🟠 P1 高危问题

### 4.1 权限与越权（安全）

| 编号 | 位置 | 问题 |
|---|---|---|
| SEC-03 | `server/src/routes/auth.ts:230-248` | `POST /claim-anonymous` 仅 `authRequired`，一次调用把**全库** `userId=null` 的批注/错题/作业据为己有（`updateMany({ where: { userId: null } })`）。AGENTS.md:348 明确匿名数据只应由 admin 迁移。非幂等、不可逆、无审计 |
| SEC-08 | `adminAnnotations.ts`、`adminAssignments.ts`、`pdfAdminAnnotations.ts`（:17 + couldViewOthers）、`pdfAdminMistakes.ts`（:18）、`pdfAdminAssignments.ts`（:15）、`adminBookPairs.ts`（:50 用 `teacherOrAdminRequired`，但 `:755-933` 的 bind/unbind/bind-batch/unbind-batch **无 adminRequired**） | teacher 可读全体学生数据、可改全局教材↔答案配对。**对照正确实现**：`adminMistakes.ts:26-29` 明确加了 `where.userId = req.user.userId`；`adminBookPairs` 的写操作应加 `adminRequired` |
| SEC-04 | `server/src/services/auth.ts:9`（`'auth.access_token_expiry': '0'`）、`:45-48`、`:117-124` | access token **默认无 `exp`**，`'0'` 时直接不设 `expiresIn` → 泄露即永久有效，只能靠 `tokenVersion` 递增或改密失效 |
| SEC-09 | `server/src/services/dbBackup.ts:176-182` | `args.push(\`-p${db.password}\`)` → MySQL 口令出现在进程 argv，同机任意用户 `ps aux` 可见（`testConnection` 同样）。**注意：这里没有命令注入**，全部用参数数组，这点是对的，只是口令暴露 |
| SEC-10 | `server/src/services/auth.ts:237, 248-262` | 登录锁定以**手机号**为 key，`Map` 无容量上限、无 TTL（仅登录成功才 delete）→ 知道手机号即可定向锁定他人 5 分钟（DoS）；大量随机手机号可让 Map 无限增长 |
| SEC-11 | `server/src/index.ts:99-110`、`server/src/routes/auth.ts:121` | 全局错误中间件与若干 catch 把 `err.message` 原样回给客户端。DB 不可达时 Prisma 文案含 `Can't reach database server at 182.92.129.222:16240`，会泄露给匿名请求者 |
| SEC-12 | `server/src/index.ts:94-96` + `scripts/auto-deploy-main.sh:111` | `/api/health` 只返回常量，DB 断了仍 200，却被自动部署脚本当健康门禁 —— 会放过一个"服务活着但用不了"的版本 |
| SEC-13 | `server/src/pdf/routes/pdfCollect.ts:46-62`（`guardDeletable`） | 守卫只对**最后一段**做 `lstatSync` 符号链接判断，父目录若是符号链接可逃逸出允许根（**推测**，需构造验证）。正面：`:361 /fs/delete` 需 `echo=DELETE`、`:374 /purge` 需 `echo=PURGE` 二次确认，设计是对的 |
| SEC-14 | `pdfBooks.ts:528 /text/extract`、`:572 /search?auto=1`、`:640 /rehash` | 均仅 `authRequired` 且无限流 → 任意登录用户可反复对 189MB 级 PDF 触发整书解析 / sha256，占满 CPU 与 IO |
| SEC-15 | `server/src/index.ts:61-67`，全仓无 `trust proxy` | 经 Caddy 反代后 `req.ip` 恒为 127.0.0.1 或触发 `express-rate-limit` 的 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` 校验错误 → 登录限流要么全站共用一个桶、要么直接 500（**推测**，取决于 Express 默认值） |
| SEC-16 | `server/src/services/auth.ts:135-136` | `jwt.verify(token, secret)` 未显式 `{ algorithms: ['HS256'] }`。当前不可利用（jsonwebtoken@9 会拒绝 `none`），属纵深防御缺失 |
| SEC-17 | `server/package.json:24` vs `package-lock.json:4661-4662` | 声明 `^1.4.5-lts.1`，**锁定实际为 `1.4.5-lts.2`（已含 2025 系列 DoS 修复）** → 当前未中招。风险在于版本范围偏旧，未来重装可能解析到脆弱版本。另 `npm audit` 报告 critical/high（`proxy-addr`、`qs`/`body-parser`、`compression`、`@prisma/config`+`deepmerge-ts`、devDep `shell-quote`），建议逐条复核后统一升级 |
| SEC-18 | `deploy/Caddyfile:16-20` | `/doc/*` 由 Caddy `file_server` 匿名直出，`doc/java.html`（1.6 MB）即"放进即公开"。若内容含内部资料需改走应用层鉴权 |
| SEC-19 | `client/src/pages/Login.tsx:92` | 验证码 SVG 走 `dangerouslySetInnerHTML`（全仓唯一一处）→ 未登录上下文的存储型 XSS 入口，可窃取登录表单。改 `<img src="data:image/svg+xml;base64,...">` 或 DOMPurify |

### 4.2 进程稳定性

| 编号 | 位置 | 问题 |
|---|---|---|
| SEC-07 | `pdfBooks.ts:93`、`:124`、`routes/videos.ts:60`、`:84`、`pdf/routes/pdfMistakes.ts:88` | `fs.createReadStream(...).pipe(res)` 裸 pipe，**无 `error` 监听、无 `res.on('close')` destroy**。`statSync` 与 `createReadStream` 之间存在竞态（外置盘掉线 / 文件被删）→ `ReadStream` 抛 `'error'` 无人监听 → `uncaughtException` → **整个服务退出**。`index.ts:41-43` 目前只兜底 `unhandledRejection`，**没有兜底 `uncaughtException`** |
| FUNC-12 | `server/src/routes/admin.ts:355`、`:128`、`server/src/utils/concurrency.ts:50-51`、`:14` | `parseInt('abc')` → NaN 一路透传：`Math.max(1, Math.min(max, NaN)) = NaN` → `while (nextIndex < items.length && running < NaN)` 恒 false → worker 一个都不启动 → SSE 任务**永久挂起**（不 done 不 error，只能重启进程）；`runWithConcurrency` 则在 NaN 时静默返回空结果数组。修：`Number.isFinite` 兜底 |
| FUNC-13 | `server/src/services/dbBackupScheduler.ts:67`（`stopBackupScheduler` 定义了但**全仓零调用**）、`server/src/index.ts` 无 `SIGTERM/SIGINT` | 无优雅退出：`KeepAlive` 强杀时正在跑的 mysqldump 变孤儿、SSE 任务静默丢失、`prisma.$disconnect()` 从不调用 |

### 4.3 数据完整性与明确功能 Bug

| 编号 | 位置 | 问题 |
|---|---|---|
| FUNC-03 | `server/prisma/schema.prisma`（`Assignment:143`、`Annotation:188`、`Mistake:226`、`ReadingProgress:204`、`BookFavorite:243`、`VideoProgress:262`、`Pdf*` 各关系、`Column*` 各关系，**全仓无任何 `SetNull`**）+ `server/src/routes/adminUsers.ts:174-176` | 删除一个用户 = **物理级联删除**其全部批注/错题/作业/进度/收藏，不可恢复；而磁盘上的裁图（`Mistake.imagePath` / `PdfMistake.imagePath`）**不会被清理** → 变孤儿文件，占用只增不减。这些外键字段本身可空，语义上应 `SetNull` + 软删除 |
| FUNC-07 | `server/src/routes/books.ts:326-339`、`:353-359`、`server/src/routes/annotations.ts:115-119` | `catch { res.status(404).json({error:'不存在'}) }` 把 DB 故障/FK 冲突全部伪装成 404，误导排错；且 `books.ts:326` **先删磁盘文件（:332-334）再删库** → DB 删除失败留下"空壳记录" |
| FUNC-08 | `routes/annotations.ts:26-56`、`pdf/routes/pdfAnnotations.ts:88-120`（建批注 → 写文件 → 建错题，三步无事务）；`adminBookPairs.ts:779-785`、`:874-876`（批量 bind 逐条 update）；`pdfCollect.ts:388-401`（purge 顺序删 9 张表） | 多步写入任一步失败即留下半状态：无错题的批注、孤儿 PNG、单向配对（`bookIndex` 会据此把书误判为答案页而消失）。**正面对照**：`assignments.ts:399-418`、`pdfAssignments.ts:358-373` 的笔迹保存用了 `$transaction`，可直接照抄 |
| FUNC-04 | `server/src/pdf/services/pdfMeta.ts:197-204` | `resolveOutlinePage` **所有分支都 `return null`** → PDF 自带目录的全部条目页码为 null，前端目录跳转失效。**正面对照**：`server/src/services/pdfProcessor.ts:76-102` 的 `mapOutline` 实现是正确的，可直接复用 |
| FUNC-05 | `server/src/routes/videos.ts:64-66` | `bytes=-500`（最后 500 字节）被解析成 `start=0, end=500`（文件开头 501 字节）→ 播放器探测时长/seek 到尾部必出错。**正面对照**：`pdfBooks.ts:107-112` 有正确的 suffix 分支 |
| FUNC-06 | `server/src/pdf/routes/pdfBooks.ts:546-566`、`:601-604` | 逐页抽取循环里每页失败都被 `catch` 吞掉，循环结束后只要 `to >= totalPages` 就无条件 `textExtracted: true` → 即便 `extracted===0` 也标记"已抽取"，搜索永远搜不到且不再自动补抽，形成**永久性错误状态** |
| FUNC-15 | `server/prisma/schema.prisma:276-278`（`@@index([userId, videoKey])`，**不是 `@@unique`**）+ `server/src/services/videoProgress.ts:131-135`（先 findFirst 再 create/update，非原子） | 并发上报同一视频进度可插入重复行，破坏 `(userId, videoKey)` 语义 |
| FUNC-02 | `server/src/prisma.ts:32` | 变更触发的备份只挂钩 `['Assignment','Annotation','Mistake']` → **PDF 原生模块与专栏模块的写入完全不触发变更备份**（而它们已是主线数据） |

### 4.4 前端"假成功"与静默失败（可用性 + 功能）

| 编号 | 位置 | 问题 |
|---|---|---|
| UX-02 | `client/src/pdf/pages/PdfHome.tsx:455-483` | `saveAll` 内层两个 `catch` 吞掉**所有**单本失败，外层 `catch` 永不进入，末尾**无条件 `toast.success('已保存')`** → 全部失败也显示"已保存"。经典假成功 |
| UX-02b | `client/src/pages/Home.tsx:457-493` | 同类吞错，且**成功与失败都没有任何 toast**；而服务端 `PUT/DELETE /books/:id` 是 `adminRequired`，非 admin 用户操作必然失败却毫无感知 |
| UX-03 | `client/src/components/admin/BooksTable.tsx:157-176`（无 try/catch）、`:310-320`（仅 try/finally）、`:250-270`（无 catch 无成功 toast）、`client/src/components/admin/MistakesTable.tsx:44-47`（无 try/catch） | 管理端服务端写操作失败时抛未捕获 rejection，用户零反馈。`handleClearAll` 是危险操作却无成功反馈 |
| UX-03b | 静默吞错清单：`pages/BookViewer.tsx:380`、`pdf/pages/PdfBookViewer.tsx:257,268,543`（阅读进度保存静默失败）、`pdf/components/PdfAssignmentMode.tsx:535`、`components/admin/PdfScanImport.tsx:372,374`、`components/admin/pdf/PdfBooksTable.tsx:73,74`、`components/admin/BooksTable.tsx:141`、`components/admin/UsersTable.tsx:49,60`、`store/useStore.ts:75-78`（仅 console.error） | 云端请求失败无降级提示、用户无感知 |
| UX-06 | `client/src/store/authStore.ts:60-63` + `client/src/components/admin/AuthGuard.tsx:21-22` | `/auth/status` 一次网络抖动 → `authEnabled` 被设为 `false` → **前端所有路由守卫瞬间失效**（AuthGuard 直接放行）。多用户部署下这是安全降级。应区分"明确返回 false"与"请求失败" |

### 4.5 运维事故

| 编号 | 位置 | 问题 |
|---|---|---|
| OPS-01 | `deploy/com.edu-workspace.autodeploy.plist:2` | DOCTYPE 损坏：`...DTDs/PropertyList 1.0//EN`（缺 `-`、写成空格）且行尾多一个 `?`；已安装副本同样损坏。当前 launchd 靠容错加载，重装/升级可能拒载导致自动发布静默失效 |
| OPS-02 | `scripts/enable-autodeploy.sh:7`（直接 `cp` 模板，无替换）+ `deploy/*.plist` 中 3 处 `/Users/{user}/...` | plist 里是 `{user}` 占位符（供仓库脱敏），但**没有任何脚本做替换**（`scripts/`、`deploy/` 中 grep `sed`/`envsubst` 无命中）→ 照脚本操作会把字面量 `/Users/{user}/...` 装进 launchd，路径不存在、服务起不来。本机已安装副本是**人工**替换过的 |
| OPS-03 | 根 `package.json:13` `"setup:ssh": "./scripts/setup-github-ssh.sh"` | 该脚本**不存在**（`scripts/` 已核实）→ README §GitHub SSH 配置 的 `npm run setup:ssh` 直接失败 |
| OPS-04 | `scripts/start-lan-service.sh` vs `README.md:129-136` | 脚本只 `launchctl bootstrap` **已安装**的 plist，**不拷贝** `deploy/*.plist`；README 说"启动脚本会注册以下服务"，新机器照做会失败 |
| OPS-06 | `scripts/auto-deploy-main.sh:4-5`（注释明说不限制分支、无确认）、`:96-99`、`deploy/com.edu-workspace.autodeploy.plist:13-14`（`StartInterval 300`） | 每 5 分钟自动 `git pull --ff-only` + `npm install` + `npm run build` + 重启生产服务，**无人工闸门**，且脚本注释明示**任何分支都可部署** —— 与 `README.md:209` 宣称的"只有当前分支是 main 才发布"**直接矛盾**。（防呆面：目录锁、ff-only、脏工作区跳过，这部分是好的） |
| FUNC-16 | `dbBackupScheduler.ts:142-147` + `dbBackup.ts:363-368` | 清理规则只覆盖 `backup-auto-`/`backup-change-`，**`pre-restore-*` 与手工 `backup-*` 永不回收** → 每次还原都新增一份全库 dump 且永久保留。叠加 FUNC-01 后磁盘增长更快 |

---

## 5. 🟡 P2 中危问题

### 5.1 性能热点

| 编号 | 位置 | 问题 |
|---|---|---|
| FUNC-09 | `server/src/pdf/services/pdfMeta.ts:61-69` | `openPdf` 用 `fs.readFileSync(filePath)` **同步读整本 PDF**，而它被 `/cover`、`/thumb/:page`、`/text/:page`、`/search?auto=1`、`/meta?refresh`、`renderPageToJpg` 全部调用 → 每请求一张缩略图就同步阻塞事件循环重读一遍（库里有 189MB 的书）。**注意**：`pdfProcessor.ts:59` 抽目录时已用异步读，说明团队知道该风险，唯独这里漏了 |
| FUNC-10 | `server/src/pdf/routes/pdfBooks.ts:616-620` | 搜索 `plainText: { contains: q }` → `LIKE '%q%'`，`plainText` 为 `@db.Text` 无索引 → 全表扫；`findMany` **无 `take`**，一次把全部命中页的**整页文本**拉回内存（返回体才截 90 字符 snippet）。另 `.toLowerCase()` JS 过滤（`adminBookPairs.ts:378-384`）与 DB collation 大小写语义可能不一致（**推测**） |
| DATA-03 | `schema.prisma`：`Book.batchId:80`、`PdfBook.batchId:298`、`Annotation.type:190`、`Assignment.status:146`、`Mistake.reviewStatus:231`、三张 `isDeleted` | 这些字段**均无索引**，却出现在高频 `where` 中（`adminBooks.ts:33,45`、`pdfAdminBooks.ts:45,57`、`cropsAuth.ts:84-88`、`mistakes.ts:15`、各类列表 `isDeleted:false`）→ 数据量增长后列表/统计恒定全表扫描。对照 `pdfBooks.ts:202-203` 已有正确的分页夹紧，说明规范是存在的，只是没统一 |
| UX-11 | `client/src/review/repository.ts:106-114`、`client/src/typing/useDictWords.ts:68-72` | 每次 `persistDomain` 都全量 `readBlob()` + `JSON.stringify` 写回；词典 `public/dicts` 合计约 **69.4 MB**（单文件最大 1,309,181 B 同步 `resp.json()`）→ 主线程卡顿（**推测**，需真机 profiling） |
| UX-09 | `client/src/pdf/lib/pdfjs.ts:40`（`docCache` 无上限）、`:54-56`（`evictDocument` **定义了但零调用**）、全文件无 `.destroy()` | 浏览 N 本书 → N 个已解析文档常驻堆内存且从不释放 → 标签页内存持续上涨至崩溃 |
| UX-10 | `client/src/components/TocTree.tsx:94`、`client/src/pdf/components/PdfTocTree.tsx:127` | `Array.from({length: totalPages})` 全量渲染缩略图 DOM，400 页书 = 400 个复合节点瞬间挂载。**正面对照**：`english/components/VirtualizedLessonSelector.tsx:63-75` 做了正确的窗口化 |
| UX-13 | `client/src/components/admin/pdf/PdfAssignmentsTable.tsx:64`、`client/src/components/admin/AssignmentsTable.tsx:70` | 分组视图 `pageSize: 200` 一次拉全量、无虚拟化 |

### 5.2 健壮性与一致性

| 编号 | 位置 | 问题 |
|---|---|---|
| FUNC-11 | `server/src/routes/books.ts:49-50` | `pageSize` 无上限（`?pageSize=1000000` 可拖垮）、`page=-1` 时 `start=-16` → `skip: -16` 触发 Prisma 报错。对照 `pdfBooks.ts:202-203` 有 `Math.max(1, …)` / `Math.min(100, …)` |
| FUNC-14 | `server/src/routes/admin.ts:336`（`/scan-pdf` SSE） | 未挂 `asyncHandler`、无任务超时、未监听 `req.on('close')` → 客户端断开后渲染任务仍全量执行，写流可能抛 `ERR_STREAM_WRITE_AFTER_END` 二次抛错（**推测**）。另 `videoPlans` 的 TTL 只在新 plan 创建时 `pruneVideoPlans()`，长期不新建则不清理 |
| FUNC-17 | `server/src/pdf/routes/pdfCollect.ts:287,361,374` | `/fs/stat`、`/fs/delete`、`/purge` 全为**同步递归**遍历（`statRecursive`、`deletePaths`、walk/prune）→ 路径深/文件多时阻塞事件循环；`/scan` spawn python 无超时、无单实例锁，可并发写同一 `COLLECT_OUT`（**推测**） |
| DATA-04 | `schema.prisma:76-77`（`title`/`category`）、`:85`（`storagePath`）、`:190`（`type`）、`:228-229`（`imagePath`/`subject`） | 未标 `@db.*` 的 `String` 在 MySQL 下默认 `VARCHAR(191)`。`Book.storagePath` 存本机绝对路径（含中文书名）极易超 191 → 插入报错或截断。项目其它地方已显式用 `@db.Text`/`@db.VarChar(768)`，口径不统一 |
| DATA-06 | `server/src/prisma.ts:10` | `` url: `${process.env.DATABASE_URL}?connection_limit=10&pool_timeout=60` `` —— 若 `DATABASE_URL` 已带查询串会拼出两个 `?` 的非法 URL。当前无需，属隐患 |
| DATA-05 | `schema.prisma:542-598` | `ColumnBook` 无 `@@unique([title, category])`，而 `Book:101` / `PdfBook:347` 都有 → 口径不一致（专栏模块可能插入重复书） |
| OPS-05 | 三个 plist 的 `StandardOutPath`/`StandardErrorPath` 均为 `/tmp/edu-workspace-*.log` + `scripts/logs-lan-service.sh:7,10,13` `tail -f /tmp/...` | 日志无轮转、`/tmp` 无限增长、重启即丢历史、同机用户可读（含请求日志） |
| OPS-07 | `deploy/Caddyfile:1`（`:5173` 无 host）、`server/src/index.ts:123`（无 host） | 前端与后端**均监听 0.0.0.0**，后端 4000 绕过 Caddy 直接暴露；且**无 HTTPS** |

---

## 6. 🔵 P3 技术债与规范偏离

### 6.1 工程与质量

| 编号 | 说明 |
|---|---|
| ENG-01 | **仓库无任何测试、无 CI**：无 `.github/`、无 `test` 脚本、无 `*.test.ts`/`*.spec.ts`。`AGENTS.md` 用一整套约定（响应格式、角色权限、UI token）约束代码，但**没有任何自动化手段保证约定被遵守** —— 这正是"一版对一版错"能长期存在的根本原因 |
| ENG-02 | `client/vite.config.js` 与 `vite.config.ts` **双份并存**，Vite 优先加载 `.js`（由 `client/tsconfig.node.json` + `composite: true` 在 `tsc -b` 时生成）→ **改 `.ts` 而不重新 build 则不生效**，是典型排查黑洞。修：给 `vite.config.ts` 加 `noEmit` 或删除生成物 |
| ENG-04 | 死代码：`dbBackupScheduler.ts:67 stopBackupScheduler`（零调用）、`dbBackupScheduler.ts:84 restartPeriodicTimer`（无外部调用方）、`client/src/pdf/lib/pdfjs.ts:54 evictDocument`（零调用）、`api/client.ts` 中 `adminBooksDeleted:639`/`deleteStroke:818`/`migrateWordWrongs:1079`/`getReviewSummary:1073`/`clearTypingRecords:1008`（外部引用 0）、`store/useStore.ts:121 removeBook`/`:112 fetchMistakes`（组件未调用） |
| ENG-03 | 超长文件（>500 行共 13 个）：`pages/BookViewer.tsx` 1800、`pages/Home.tsx` 1446、`pdf/pages/PdfBookViewer.tsx` 1402、`pdf/pages/PdfHome.tsx` 1272、`components/admin/BookPairs.tsx` 1245、`components/AssignmentMode.tsx` 1152、`pdf/components/PdfAssignmentMode.tsx` 1052、`components/admin/PdfScanImport.tsx` 888、`components/admin/pdf/PdfCollectPreview.tsx` 835、`components/admin/BooksTable.tsx` 807、`components/ui/sidebar.tsx` 771 |
| ENG-05 | `tsconfig.json:15-16` 关闭 `noUnusedLocals/noUnusedParameters` → 未使用 import/变量无人发现（实例：`MistakesTable.tsx:5`、`AnnotationsTable.tsx:5` 都 import 了 `<Button>` 却未使用）。`any` 分布集中在 `BookPairs.tsx`、`api/client.ts`、`BookViewer.tsx`。**但 `@ts-ignore` 为 0，这点很好** |
| ENG-06 | ⚠️ **当前工作区有未提交改动**：`server/src/index.ts` 新增了 `process.on('unhandledRejection')` 兜底（只记日志不退出）。这段是有价值的，但它**尚未提交**，且只兜 `unhandledRejection`、**不兜 `uncaughtException`**（SEC-07 的崩溃路径仍在） |
| FUNC-18 | 专栏模块：后端 10 张 `column_*` 表 + `columnImport.ts` + `/admin/collect` 全套 + `pdfMaterials` 已就绪，但**前端没有任何一级入口**（`App.tsx` 无 `/column` 路由，只有 admin 下的 `pdf/materials`、`pdf/collect` 管理页）→ 已投入的后端能力目前无终端用户可达 |

### 6.2 前端规范偏离

| 编号 | 说明 |
|---|---|
| UX-01 | `PdfHome.tsx:1246`、`Home.tsx:1394` 的「编辑 / 完成」按钮、以及编辑模式下的「删除选中」，**对所有用户可见**（两文件 `isAdmin`/`useAuthStore` 命中 0 次）。配合 SEC-02 构成实际越权入口 |
| UX-04 | 残留 2 处原生 `confirm`：`components/admin/MistakesTable.tsx:50`、`components/admin/AnnotationsTable.tsx:40`（AGENTS.md 要求用 `useConfirm()`；其余约 50 处已合规） |
| UX-05 | 6 处 `window.open` **缺 `noopener`**：`pages/Home.tsx:966,1134`、`pdf/pages/PdfHome.tsx:895,1027`、`pdf/pages/PdfBookViewer.tsx:1015`、`components/admin/MyWorkspace.tsx:141`。对照：所有 `<a target="_blank">` 都带了 `rel="noopener noreferrer"`，`AssignmentsTable.tsx:113`、`PdfAssignmentsTable.tsx:103`、`EnglishPage.tsx:272` 的 `window.open` 也带了 —— 属遗漏 |
| UX-07 | 主题 token 不合规（统计命令见附录 A）：`bg-white` **70** 处、`text-gray-*` **32**、裸 hex **31**、`text-white` **156**（其中落在 `bg-primary` 上的应为 `text-primary-foreground`）。集中文件：`AssignmentMode.tsx`（41+30）、`PdfAssignmentMode.tsx`（25+8）、`english/components/RandomBg.tsx`（12 处裸 hex） |
| UX-08 | 原生 `<button>` **439** 处（非 `components/ui/` 内仅 1 处）vs shadcn `<Button>` **58** 处 ≈ **7.6 : 1**，违反 AGENTS.md「优先 `<Button>`」。Top：`PdfBookViewer.tsx` 37、`BookViewer.tsx` 32、`Home.tsx` 27、`PdfHome.tsx` 25 |
| UX-12 | 状态管理：`useStore()` 无选择器订阅 3 处（`Home.tsx:143`、`BookViewer.tsx:97`、`PdfScanImport.tsx:117`）；`useAuthStore()` 整体解构 13 处；`eslint-disable exhaustive-deps` **21** 处（`BookViewer.tsx:350,381,390`、`PdfAssignmentMode.tsx:321,424`、`TypingHome.tsx` 6 处…）→ 任意 store 字段变化触发全树重渲染，且存在陈旧闭包风险 |
| UX-14 | localStorage 配额失败**静默**：`typing/records.ts:66-77`、`review/repository.ts:84-86`、`english/progress.ts:34,43`。**正面对照**：`english/studyRecord.ts:132-148` 做了 `console.warn` + `toast.warning('学习记录存满了')`，可直接照抄 |
| UX-15 | `AUTH_ENABLED=false` 时仍展示登录/注册/后台入口：`App.tsx:73-75`（`/login`、`/register`、`/forgot-password` 无条件挂载）、`components/AppHeaderRight.tsx:60-63`（齿轮图标恒显），违反 AGENTS.md「不显示任何 auth 相关 UI」 |
| UX-P3 | 原生 `<input>` 缺 `bg-background text-foreground placeholder:text-muted-foreground`（`Login.tsx:64-88`、`AuthSettings.tsx:55-61`、`BooksTable.tsx:382-388,482-522`）；大量手写模态框未用 shadcn `Dialog`（`UsersTable.tsx`、`PdfBookViewer.tsx:1187-1213`、`PdfBooksTable.tsx:427-478`）；纯图标按钮缺 `aria-label`（约 35 处 `aria-*` 覆盖不足；**但 16 处 `<img>` 全部有 `alt`，这点很好**） |

### 6.3 文档与实现不符

| 编号 | 说明 |
|---|---|
| DATA-01 | **无迁移体系**：无 `server/prisma/migrations/`（且 `.gitignore:24` 明确忽略它），基础表（user/book/annotation/...）**没有任何 CREATE TABLE SQL**；`README.md:18` 却指引 `npx prisma db push`，而多个 `*_init.sql` 头部明确警告 `db push` 会 **DROP 遗留表** `assignment_copy1` / `assignmentstroke_copy1`。文档与实现直接矛盾，新环境照 README 操作有丢表风险 |
| DATA-02 | **SQL 与 schema 漂移**（⚠️ 此处修正子分析的一个过度结论）：`submittedAt`/`estimatedMinutes` 已由 `server/prisma/assignment_time_init.sql:5-10` 对 `assignment` 与 `pdf_assignment` 双表补齐；`gradeResult`/`gradeIssues`/`gradeComment` 已由 `server/prisma/assignment_grade_result_init.sql:5-11` 双表补齐；`column_*` 表在 `column_module_init.sql:149-154,187` 内已完整。**真正未记录的漂移是 `rotation`**：`schema.prisma:210`（`reading_progress`）与 `:513`（`pdf_reading_progress`）都有该列，但 8 个 SQL 文件中**只有** `column_module_init.sql:187` 有 `rotation` → 仅按仓库 SQL 建库的实例读写这两张表会报 `Unknown column 'rotation'`。另 `column_book.sourcePath` 依赖单独的 `column_book_sourcepath.sql`，漏跑同样 500 |
| OPS-06b | `README.md:209` 说"只有当前分支是 main 才自动发布"，`scripts/auto-deploy-main.sh:4-5` 注释明说"任何分支都可部署、无需确认" —— 二者矛盾，需统一 |
| OPS-09 | `MYSQL_BIN_DIR="D:\mysql-8.0.19-winx64\bin"` 写在 macOS 的 `.env`（根 `.env:13`、`server/.env:13`），`dbBackup.ts:67-68` 会优先尝试 → 功能上会回退到 PATH，但误导，且若某机存在同名目录会取错二进制 |
| OPS-10 | `server/.env.example:1-4` **缺少 `AUTH_ENABLED`、`JWT_SECRET`、`JWT_REFRESH_SECRET`**，且 `CLIENT_ORIGIN`/`STORAGE_DIR` 与真实 `.env` 不一致；仓库同时存在根 `.env` 与 `server/.env` 两份（生产实际加载**根** `.env`，因为 cwd 是仓库根）→ 容易被误改 |

---

## 7. 与 2026-09-26 基线的逐条对比

| 基线编号 | 基线问题 | 当前状态 | 证据 |
|---|---|---|---|
| P0-1 | 备份匿名可下载 | ❌ **未修复** | `index.ts:121-122` + `dbBackup.ts:128-130` + `Caddyfile:9-11`（见 SEC-01） |
| P0-2 | relocate 任意文件读取 | ❌ **未修复** | `pdfBooks.ts:14,666-683,370`（见 SEC-02） |
| P0-3 | `AUTH_ENABLED=false` + `CLIENT_ORIGIN=*` | ❌ **未修复** | `server/.env:7`、plist:20-21、`index.ts:54-57,123`（见 SEC-05） |
| P0-4 | access token 默认无 exp | ❌ **未修复** | `services/auth.ts:9,45-48,117-124`（见 SEC-04） |
| P0-5 | 备份清理前缀不匹配 | ❌ **未修复** | `dbBackup.ts:316` vs `dbBackupScheduler.ts:54,142-143`（见 FUNC-01） |
| P0-6 | 并发度 NaN → 任务挂起 | ❌ **未修复** | `admin.ts:355,128` + `concurrency.ts:50-51`（见 FUNC-12） |
| P0-7 | PDF 文档从不 destroy / 任务从不 cancel | ❌ **未修复** | `pdf/lib/pdfjs.ts:40,54-56`（见 UX-09） |
| P0-8 | 验证码 SVG `dangerouslySetInnerHTML` | ❌ **未修复** | `Login.tsx:92`（见 SEC-19） |
| P1-9 | multer CVE | ✅ **已缓解** | `package-lock.json:4662` 实际锁定 `1.4.5-lts.2` |
| P1-20 | `window.open` 缺 `noopener` | ❌ **未修复**（仍 6 处） | 见 UX-05 |
| P1-14 | `resolveOutlinePage` 恒 null | ❌ **未修复** | `pdfMeta.ts:197-204`（见 FUNC-04） |
| P1-15 | `bytes=-500` 解析错 | ❌ **未修复** | `videos.ts:64-66`（见 FUNC-05） |
| P1-16 | 抽取失败仍 `textExtracted=true` | ❌ **未修复** | `pdfBooks.ts:546-566,601-604`（见 FUNC-06） |
| P1-10 | `onDelete: Cascade` 物理级联 | ❌ **未修复** | 全仓无 `SetNull`（见 FUNC-03） |
| P1-19 | 批量保存假成功 | ❌ **未修复** | `PdfHome.tsx:455-483`（见 UX-02） |
| P2 备份触发表只含 3 张 | — | ❌ **未修复** | `prisma.ts:32`（见 FUNC-02） |
| — | （新增）`/doc/*` 匿名静态 | 🆕 **新增** | `Caddyfile:16-20`（见 SEC-18） |
| — | （新增）`/storage/pdf/**` 匿名可下载 | 🆕 **新增** | `pdfStorage.ts:24-25` + `index.ts:122` |
| — | （新增）autodeploy plist DOCTYPE 损坏 | 🆕 **新增** | `deploy/...autodeploy.plist:2`（见 OPS-01） |
| — | （新增）`{user}` 无自动替换 | 🆕 **新增** | `enable-autodeploy.sh:7`（见 OPS-02） |
| — | （新增）无测试无 CI | 🆕 **新增（此前未单列）** | 无 `.github/`、无 test 脚本（见 ENG-01） |

**结论：基线 8 条 P0 与绝大部分 P1 在 13 天内一条未修。** 期间新增的 37 个提交全部是功能/UI 迭代 —— 这不是批评功能推进，而是说明**功能迭代与安全治理需要并行**，否则每轮新增代码都在旧地基上加层。

---

## 8. 做得好的地方（不要改坏）

1. **零 SQL 注入**：唯一使用 `$queryRawUnsafe` 的 `pdf/routes/pdfMaterials.ts:23-33,70-101,128-142` 做了排序字段白名单 + 全部 `?` 占位符 + 表名常量，用法正确。
2. **零命令注入**：所有外部进程调用均为 `spawn`/`execFileSync` + **参数数组**，无 `shell: true`（`pdfProcessor.ts:41,123`、`dbBackup.ts:264,322,371`、`admin.ts:163`、`pdfCollect.ts:186`）。
3. **备份路径双重防护**：`SAFE_NAME` 正则（`dbBackup.ts:126`）+ `resolveSafePath` 的 `path.relative` 校验（`:167-174`）—— 这套机制本身是好的，问题在于静态托管绕过了它（SEC-01）。
4. **PDF 删除守卫**：`pdfCollect.ts:46-49` `isStrictlyInside`（严格在根内、不含根本身）+ `:52-62` 拒绝符号链接 + `:361-369` `/fs/delete` 需 `echo=DELETE` + `:374-380` `/purge` 需 `echo=PURGE` —— 破坏性操作有白名单根与二次确认，思路正确。
5. **PDF 静态资源鉴权中间件**：`middleware/cropsAuth.ts` 做了 filename 消毒（`:42-44`）、admin/teacher 放行（`:67-69`）、student 按 `mistake`/`annotation` 归属校验（`:72-109`）、文件存在性预检（`:112-115`）—— 这是最完整的一处授权实现，可作为修 SEC-01/SEC-02 的模板。
6. **认证 fail-safe**：`isAuthEnabled()` 默认 **true**、仅在显式 `'false'` 时关闭（`services/auth.ts:40-43`）；启用但缺密钥时 `getJwtSecret`/`getJwtRefreshSecret` 直接抛错（`:69-83`）—— 方向是对的。
7. **会话机制**：refresh token 只存 `sha256` 哈希（`services/auth.ts:151-167`）、`tokenVersion` 缓存式即时吊销（`:87-115`、`adminUsers.ts:138-141`）、SSE 一次性票据 30s TTL 防重放（`utils/sseTicket.ts:39-67`）—— 设计到位。
8. **口令与验证码**：bcrypt cost 10（`:195`）；验证码服务端校验 + 一次性 `delete` 消费 + 16 字节随机 key 不可枚举（`:211-228`）。
9. **PDF 侧正确的实现**（可作为修 legacy 的范本）：Range suffix 解析（`pdfBooks.ts:107-112`）、分页夹紧（`:202-203`）、笔迹保存用 `$transaction`（`pdfAssignments.ts:358-373`）、裁图目录 `bookId` 已 `parseInt`（`pdfAnnotations.ts:102,115`）。
10. **前端保存阻断导航**：`AssignmentMode.tsx:430-449,481-546`、`PdfAssignmentMode.tsx:338-416` 实现正确（失败阻塞退出 + 真实 toast），**未发现假成功** —— 说明"假成功"只集中在两个列表页的批量保存。
11. **前端小项**：16 处 `<img>` 全部有 `alt`；`alert`/`prompt` 使用为 **0**；`@ts-ignore` 为 **0**；所有 `<a target="_blank">` 都带 `rel`；词典/网络请求普遍有 `cancelled` 标记；`pageSizeStore.ts` 是 zustand persist 的规范范式。
12. **跨盘容错**：`dbBackup.tryEnsureBackupsDir` 对 `ENOENT/EACCES/EPERM/EROFS/ENOTDIR/ENODEV` 降级而非崩溃（`dbBackup.ts:133-155`），`initializeStorageRoot` 也只 warn 不阻塞启动（`storage.ts:10-18`）—— 对"外置盘未挂载"这个真实场景处理得很好。

---

## 9. 修复路线图（可直接当工作清单）

> 优先级原则：**先止血（P0）→ 再补权限与数据（P1）→ 再性能与规范（P2/P3）**。
> 列出的每条都带有可核查的证据位置，验收方式建议：修复后对同一文件行号复查 + 用一个非 admin 账号实测。

### 第 1 周：止血（5 条 P0，全部是"改动小、影响大"）

| # | 任务 | 涉及文件 | 工作量 |
|---|---|---|---|
| 1 | 删除 `/storage` 泛静态挂载，改为白名单子目录；`db-backups` 移出静态根或显式 403 | `server/src/index.ts:122`、`dbBackup.ts:128-130` | 小 |
| 2 | `pdfBooks.ts` 的 `patch/delete/relocate` 加 `adminRequired`；`relocate` 与 `GET /:id/file` 全链路强制 `assertInsidePdfRoot` | `server/src/pdf/routes/pdfBooks.ts:14,370,666,686,712` | 小 |
| 3 | 生产改 `AUTH_ENABLED=true` + `CLIENT_ORIGIN` 收敛为具体地址；代码层拒绝 `*` 与 `credentials:true` 并存；`app.listen(PORT,'127.0.0.1')` | `server/.env`、`deploy/*.plist:20-21`、`server/src/index.ts:54-57,123` | 小 |
| 4 | 备份命名前缀两侧统一（`backup-auto-`/`backup-change-`）；清理纳入 `pre-restore-*` 与手工 `backup-*`；`type` 按 tag 正确映射 | `dbBackup.ts:316,357`、`dbBackupScheduler.ts:54,142-147` | 小 |
| 5 | 轮换数据库口令与 JWT 密钥（去掉非 ASCII `ß`），改最小权限账号；DB 端口限制来源 IP | 根 `.env`、`server/.env` | 小 |

### 第 2 周：补权限与稳定性

| # | 任务 | 涉及文件 |
|---|---|---|
| 6 | 抽 `applyTeacherScope(req, where)` 统一补 teacher 的 `userId` 过滤；`claim-anonymous` 改 `adminRequired` + 限批次 | `adminAnnotations.ts`、`adminAssignments.ts`、`pdfAdminAnnotations.ts:17`、`pdfAdminMistakes.ts:18`、`pdfAdminAssignments.ts:15`、`auth.ts:230-248` |
| 7 | `adminBookPairs` 的 bind/unbind/bind-batch/unbind-batch 加 `adminRequired` | `adminBookPairs.ts:50,755-933` |
| 8 | access token 默认改非零（如 `2h`），删除"永不过期"分支 | `services/auth.ts:9,45-48,117-124` |
| 9 | 抽 `sendFileStream()`（`error` + `res.on('close')` destroy），替换全部裸 pipe；补 `process.on('uncaughtException')` | `pdfBooks.ts:93,124`、`videos.ts:60,84`、`pdfMistakes.ts:88`、`index.ts` |
| 10 | `concurrency` 全链路 `Number.isFinite` 兜底 | `admin.ts:128,355`、`utils/concurrency.ts:14,50-51` |
| 11 | 补 `SIGINT/SIGTERM` 优雅退出（调 `stopBackupScheduler` + `prisma.$disconnect` + `server.close`） | `index.ts`、`dbBackupScheduler.ts:67` |
| 12 | mysqldump 口令改 `MYSQL_PWD` 环境变量（或 `--defaults-extra-file`） | `dbBackup.ts:176-182,261` |
| 13 | 验证码改 `<img src="data:image/svg+xml;base64,...">` | `client/src/pages/Login.tsx:89-93` |
| 14 | 登录锁定改 IP + 账号双维度，存储加 TTL/容量上限 | `services/auth.ts:237-262` |
| 15 | 错误响应只回通用文案，详细错误仅入日志；`/api/health` 加轻量 DB 探活并失败返 503 | `index.ts:94-110`、`auth.ts:121` |
| 16 | 用户态重处理端点（`text/extract`、`search?auto=1`、`rehash`）改 `adminRequired` 或加节流 | `pdfBooks.ts:528,572,640` |

### 第 3-4 周：数据一致性与明确 Bug

| # | 任务 | 涉及文件 |
|---|---|---|
| 17 | 外键 `onDelete` 改 `SetNull`（或用户改软删除）；删除用户时清理磁盘裁图 | `schema.prisma`（全部 Cascade 关系）、`adminUsers.ts:174-176` |
| 18 | 关键多步写入加 `$transaction`（annotation+mistake、批量 bind、purge 顺序删） | `annotations.ts:26-56`、`pdfAnnotations.ts:88-120`、`adminBookPairs.ts:779-785,874-876`、`pdfCollect.ts:388-401` |
| 19 | 删除顺序改"先库后文件"；`catch {}` 按 Prisma 错误码区分，不再一律 404 | `books.ts:326-339,353-359`、`annotations.ts:115-119` |
| 20 | 修四个明确 Bug：`resolveOutlinePage`、`bytes=-500`、`textExtracted`、legacy 裁图目录 `parseInt` | `pdfMeta.ts:197-204`、`videos.ts:64-66`、`pdfBooks.ts:546-566,601-604`、`annotations.ts:38,43` |
| 21 | 批量保存改失败计数 + 真实 toast（两处列表页） | `PdfHome.tsx:455-483`、`Home.tsx:457-493` |
| 22 | 管理端写操作补 `try/catch + toast` | `BooksTable.tsx:157-176,250-270,310-320`、`MistakesTable.tsx:44-47` |
| 23 | `authStore.init` 区分"明确 authEnabled=false"与"请求失败"，失败时保持 loading/重试 | `authStore.ts:60-63`、`AuthGuard.tsx:16-23` |
| 24 | 编辑入口加 `isAdmin` 判断；6 处 `window.open` 补 `noopener,noreferrer`；2 处 `confirm` 改 `useConfirm()` | `PdfHome.tsx:1246`、`Home.tsx:1394`、6 处 `window.open`、`MistakesTable.tsx:50`、`AnnotationsTable.tsx:40` |
| 25 | `VideoProgress` 加 `@@unique([userId, videoKey])` 并改 `upsert` | `schema.prisma:276-278`、`videoProgress.ts:131-135` |

### 第 1-2 月：性能、架构与工程化

| # | 任务 |
|---|---|
| 26 | 补索引：`Book.batchId`、`PdfBook.batchId`、`Annotation.type`、`Assignment.status`、`Mistake.reviewStatus`、三张 `isDeleted`（复合索引优先） |
| 27 | `pdfMeta.openPdf` 改异步读 + 文档 LRU 缓存（或 `PDFDataRangeTransport` 惰性读取） |
| 28 | 搜索改 FULLTEXT/ngram 索引 + 加 `take` 上限 + 统一大小写语义 |
| 29 | 统一分页参数解析工具（`page≥1`、`1≤pageSize≤max`），替换所有手写 parseInt |
| 30 | 抽公共 `useReaderNavigation()` / store，**明确模块收敛路线**（推荐以 PdfBook 为主线、Book 只读迁移，加 `PdfBook.legacyBookId` 显式关联替代 `fileHash` 模糊匹配） |
| 31 | 前端 pdf.js `docCache` 加 LRU 上限 + 切换书时 `evictDocument` + `doc.destroy()` |
| 32 | 缩略图栏虚拟滚动；分组视图改服务端聚合 |
| 33 | 建**迁移体系**：`prisma migrate` 基线（用 `migrate diff --from-empty` 生成初始迁移），收编散装 `*.sql`；README 改用迁移命令、移除 `db push` 指引；补齐 `rotation` 的 DDL 记录 |
| 34 | 引入测试与 CI：至少覆盖响应格式契约、权限矩阵（admin/teacher/student × 关键路由）、备份命名/清理、Range 解析、分页夹紧 |
| 35 | 修 autodeploy plist DOCTYPE；安装脚本加 `{user}`→真实用户名替换（或改用 `$HOME`）；补 `setup-github-ssh.sh` 或从 README 移除；plist `{user}` 说明补全 |
| 36 | 日志迁出 `/tmp` 并配轮转；`CLIENT_ORIGIN` 生产收敛；`vite.config.js` 遮蔽问题修复 |
| 37 | 清理死代码（`stopBackupScheduler`、`evictDocument`、未引用 API/action）；`String` 路径字段显式 `@db.VarChar(512)`/`@db.Text`；`ColumnBook` 补唯一约束；`prisma.ts:10` 用 `URL` 追加参数 |
| 38 | 前端规范批量收敛：主题 token（`bg-white`→`bg-background` 等）、原生 button→shadcn `Button`、图标按钮补 `aria-label`、localStorage 配额失败补 toast |
| 39 | 专栏模块前端一级入口（`/column`）落地或明确下线，避免"后端已投入但无用户可达" |
| 40 | 处理未提交改动：`server/src/index.ts` 的 `unhandledRejection` 兜底要么提交、要么连同 `uncaughtException` 一起完善 |

---

## 10. 给决策者的三句话

1. **当前部署等于"公网 root 数据库 + 无鉴权管理面 + 任意文件读取"三条同时成立。** 只要这台 Mac 所在的网络里有任何一个不可信设备，SEC-01/02/05/06 就能组成完整攻击链。建议**本周内完成第 1 周的 5 条**，它们全部是小改动。
2. **即使不发生安全事故，FUNC-01（备份永不清理 + 每次启动全量 dump）与 FUNC-12（任务挂死）也会周期性造成运维事故** —— 这两条是"必然发生"，不是"可能发生"。
3. **所有"一版对、一版错"的 Bug 都指向同一个根因**：legacy 图片版 / PDF 原生版（/ 未来的专栏版）三套同构模型并行。不收敛，Bug 就会持续以"修好这版、漏了那版"的形式再生 —— 本次 4.3 与 4.4 里几乎每一条都是这个模式的产物。

---

## 附录 A：统计与复核命令

```bash
# —— 前端主题 token 合规 ——
cd client/src
grep -rno "bg-white"             --include="*.tsx" . | wc -l   # 70
grep -rno "text-gray-[0-9]"      --include="*.tsx" . | wc -l   # 32
grep -rnoE "#[0-9a-fA-F]{6}"     --include="*.tsx" . | wc -l   # 31
grep -rno "text-white"           --include="*.tsx" . | wc -l   # 156
grep -rno "<button" --include="*.tsx" . | grep -v "./components/ui/" | wc -l  # 439
grep -rno "<Button" --include="*.tsx" . | wc -l                # 58
grep -rn "eslint-disable.*exhaustive-deps" --include="*.tsx" --include="*.ts" . | wc -l  # 21
grep -rn "dangerouslySetInnerHTML" --include="*.tsx" .         # 1（Login.tsx:92）

# —— 未提交改动 ——
git status --porcelain                                          # M server/src/index.ts

# —— 依赖实际锁定版本 ——
grep -n -A3 '"node_modules/multer"' package-lock.json           # 1.4.5-lts.2
```

## 附录 B：本次评估的局限（请知悉）

1. **全程静态只读**：未启动服务、未连数据库、未发起请求。因此"运行期才可见"的结论（限流是否真的 500、符号链接逃逸是否可利用、字典解析的卡顿程度）均标注为**（推测）**，需实机验证。
2. **数据库现有数据无法核对**：例如 `reading_progress.rotation` 列在**线上库**是否真的存在（很可能是当年手工执行的），我只确认了"仓库 SQL 文件里没有记录"。若线上库已有该列，则 DATA-02 属"文档缺失"而非"运行故障"。
3. **本机未跑过备份调度器**：`server/storage/db-backups` 当前不存在，所以 SEC-01 是**潜在**而非正在发生的数据暴露。生产机是否已有备份文件，需到该机器上确认。
4. **`npm audit` 的 CVE 编号未逐条与官方公告比对**，只核对了 multer 的实际锁定版本。建议对 critical/high 条目单独复核后再升级。
5. **`isAdmin` 缺失的判断基于 grep**（在 `PdfHome.tsx`/`Home.tsx` 中命中 0 次），若存在通过父组件传入的隐式权限控制，需再确认一遍。
