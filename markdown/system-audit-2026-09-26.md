# edu-workspace 系统全面审计报告

> 审计日期：2026-09-26 · 分支 `feature/pdf-native` · HEAD `f1541be`
> 审计方式：静态只读分析（未启动服务、未发起网络请求、未修改任何文件）
> 覆盖范围：`server/src/**`（42 文件 / 9801 行）、`server/prisma/schema.prisma`、`client/src/**`（128 文件 / 28182 行）、`deploy/**`、`package.json`

---

## 0. 一句话结论

**当前系统处于"能跑但随时可能出事"的状态**：2 个可导致**数据库与服务器凭据完全失陷**的严重漏洞、4 个可导致**服务不可用**的阻断级缺陷（备份无限堆积撑爆磁盘、扫描任务永久挂起、文件流异常退出进程）、以及一套长期未收敛的**双模块并存架构债**（legacy 图片版 vs PDF 原生版两套同构数据模型）。

好消息是：底层卫生做得不错——**没有 SQL 注入、没有命令注入、没有路径穿越、没有 alg=none、没有 `@ts-ignore`**。问题集中在"边界缺失"和"两版实现不同步"。

---

## 一、风险总览

| 等级 | 数量 | 一句话 |
|---|---|---|
| 🔴 P0 致命 | 6 | 数据/主机可被完全接管，或服务必然不可用 |
| 🟠 P1 高危 | 14 | 越权读取、数据丢失、明确功能 Bug |
| 🟡 P2 中危 | 22 | 性能热点、一致性缺陷、规范偏离 |
| 🔵 P3 技术债 | 12 | 死代码、重复实现、类型松散 |

---

## 二、🔴 P0 致命问题（本周必修）

### P0-1 数据库备份可被匿名下载 —— 整库用户密码哈希泄露

**证据**：`server/src/index.ts:107-109`

```ts
app.use('/storage/crops', cropsAuthMiddleware);
app.use('/storage', (req, res, next) => express.static(getStorageRoot())(req, res, next));
```

只有 `/storage/crops` 挂了鉴权，其余全部裸奔。而备份目录 `server/src/services/dbBackup.ts:127-129`：

```ts
export function getBackupsRoot(): string {
  return path.join(getStorageRoot(), 'db-backups');
}
```

**后果**：`GET /storage/db-backups/auto-20260926-101500.sql.gz` 直接下载整库 dump，含全部 `User.password`（bcrypt 哈希）与手机号。文件名是纯时间戳、可枚举、无需目录列表。`adminDbBackups.ts` 里那套 `adminRequired` + `resolveSafePath` 被完全架空。

**修复**：备份目录移出 static 根（或至少放到 `storage` 之外）；static 挂载前对 `db-backups` 显式 403；备份下载统一走已鉴权的 `/api/admin/db-backups/:filename/download`。

---

### P0-2 PDF relocate 接口 = 任意文件读取 → 拿 `.env` → 伪造管理员

**证据**：`server/src/pdf/routes/pdfBooks.ts:616-633`（仅 `authRequired`，无 admin/owner 校验）

```ts
const { rootPath, filePath } = req.body || {};
const abs = path.resolve(String(filePath));
if (!fs.existsSync(abs)) return res.status(400)...   // 唯一校验只是"文件存在"
```

读取侧 `pdfBooks.ts:320-331` 的 `GET /:id/file` **漏掉了 `assertInsidePdfRoot`**（该函数只在 `:388` 封面、`:408` 缩略图被调用）。

**攻击链**（任意学生账号，两步）：
1. `POST /api/pdf/books/1/relocate` → `{"rootPath":"/…/server","filePath":"/…/server/.env"}`
2. `GET /api/pdf/books/1/file` → 明文拿到 `DATABASE_URL`、`JWT_SECRET`
3. 由于 access token 默认**无 `exp`**（P0-4），可离线签发永久有效的 admin token → 完全接管

**修复**：`relocate` 改 `adminRequired`；`resolveBookFile → streamFile` 全链路强制根目录白名单校验；`.env` chmod 600。

---

### P0-3 `AUTH_ENABLED=false` + `CLIENT_ORIGIN=*` —— 当前线上配置即"裸奔"

**证据**：`server/.env:7` `AUTH_ENABLED=false`；`deploy/com.edu-workspace.server.plist:20-21` `CLIENT_ORIGIN=*`

- `middleware/auth.ts:45-48`：`adminRequired` 在 `!isAuthEnabled()` 时**直接 `next()` 放行** → `/api/admin/users`、`/api/admin/db-backups/:f/restore`、`PUT /api/admin/storage` 全部匿名可达。
- `index.ts:37-47`：`origin: CLIENT_ORIGINS.includes('*') ? true : …` + `credentials: true` → 任意站点可携带凭证跨域调用。

**修复**：standalone 模式强制绑定 `127.0.0.1`；plist 的 `CLIENT_ORIGIN` 改为实际域名，代码层拒绝 `*`。

---

### P0-4 Access Token 默认永不过期

**证据**：`server/src/services/auth.ts:10` `'auth.access_token_expiry': '0'` + `:117-124`

```ts
if (expiry && expiry !== '0') { options.expiresIn = expiry as any; }   // '0' → 不设 exp
```

默认配置下签发的 JWT **没有 `exp` 字段**，任何泄露都是永久有效的管理员会话。配合 P0-2 可离线伪造。

**修复**：默认改 `'2h'`，删除"永不过期"分支。

---

### P0-5 备份清理规则与命名规则不匹配 → 磁盘必然被打满

**证据**：`services/dbBackup.ts:315-317` vs `services/dbBackupScheduler.ts:54,142-143`

```ts
const prefix = tag ? `${tag}-` : 'backup-';        // tag='auto' → "auto-20260926-120000.sql.gz"
// 但清理时用：
backups.filter((b) => b.filename.startsWith('backup-auto-'));   // 永远匹配不上
```

**后果**：① `cleanupOldBackups()` 永不删除任何文件，自动备份（6h）+ 变更备份（5min 去抖）无限堆积；② `latestPeriodic` 恒为 `undefined`，**每次进程启动都强制触发一次全量 mysqldump**。

**修复**：统一命名前缀（`"backup-${tag}-"`），并给清理加"按 mtime + 剩余磁盘空间"双保险。

---

### P0-6 并发度可被设为 NaN → 扫描任务永久挂起

**证据**：`routes/admin.ts:128` + `utils/concurrency.ts:50-51`

```ts
task.value = Math.max(1, Math.min(maxConcurrency, Math.floor(requested)));  // requested=NaN → NaN
// concurrency.ts:
while (nextIndex < items.length && running < limit) { ... }                 // running < NaN 恒 false
```

`POST /api/admin/scan-pdf/concurrency` 传一个非数字（或 `?concurrency=abc`），整本书的导入任务**永久挂起**：SSE 不关闭、任务不清理、客户端既不 done 也不 error，只能重启进程。

**修复**：`Number.isFinite` 校验 + 默认值兜底 + `run()` 超时。

---

### P0-7（前端）PDF 文档从不 `destroy()`，渲染任务从不 `cancel()`

**证据**：`client/src/pdf/lib/pdfjs.ts:40-56` 的 `docCache`，配合全仓库 grep —— `.destroy()` / `evictDocument` / `task.cancel` **零调用**（`evictDocument` 定义了却从未被 import）。

`PdfPageCanvas.tsx:66-82` 的 `cancelled` 只挡 `setState`，**不挡渲染本身**，旧任务继续往同一 canvas 上画。

**后果**：浏览 N 本书 → N 个已解析文档常驻堆内存（库里有 189MB 的大书），标签页涨到数百 MB 直至崩溃；快速翻页出现残影。

---

### P0-8（前端）登录页验证码 SVG 直接 `dangerouslySetInnerHTML`

**证据**：`client/src/pages/Login.tsx:89-93`（全仓库唯一的 `dangerouslySetInnerHTML`，已 grep 确认）

SVG 是可执行脚本的活跃文档格式。这是**未登录上下文**的存储型 XSS 入口，可直接窃取登录表单的手机号+密码。

**修复**：改 `<img src="data:image/svg+xml;base64,…">`（img 上下文中的 SVG 不执行脚本），或 DOMPurify 消毒。

---

## 三、🟠 P1 高危问题

### 权限体系（3 条，均与 AGENTS.md 三级权限约定不符）

| # | 位置 | 问题 |
|---|---|---|
| P1-1 | `routes/adminAnnotations.ts:15`、`adminAssignments.ts:18` | `where` 无 userId 过滤，teacher 可看**全体学生**批注/作业。对照 `adminMistakes.ts:27-29` 是正确实现了过滤的 —— 三处同构接口两条漏了，属遗漏 |
| P1-2 | `adminBookPairs.ts:50`（bind/unbind/batch） | teacher 可改写教材↔答案配对关系，违反"teacher 只能查看不能改" |
| P1-3 | `pdfAnnotations.ts:134,154`、`pdfMistakes.ts:26-30` | teacher 可**删改**任意学生的批注与错题（legacy 模块只放 admin，两版不一致） |

### 任意登录用户的破坏性操作

| # | 位置 | 问题 |
|---|---|---|
| P1-4 | `pdfBooks.ts:636-668` | `PATCH/DELETE /api/pdf/books/:id` 仅 `authRequired` → 学生遍历 id 即可把全库书软删（`isDeleted=true` 后对所有人不可见）。legacy `books.ts` 用了 `adminRequired`，两版不一致 |
| P1-5 | `routes/auth.ts:230-248` | `POST /claim-anonymous` 一次调用把**全库** `userId=null` 的批注/错题/作业据为己有，无角色限制、不可逆、无审计 |
| P1-6 | `routes/videos.ts:28-60` | `GET /:id/stream` 无归属校验（IDOR），且直出 `video.filePath` 绝对路径 |

### 进程稳定性

| # | 位置 | 问题 |
|---|---|---|
| P1-7 | `middleware/cropsAuth.ts:18`（async 中间件） | Express 4 不捕获 async reject，DB 抖动 → unhandled rejection → **进程退出** |
| P1-8 | `videos.ts:60/84`、`pdfBooks.ts:91/122`、`pdfMistakes.ts:88` | `createReadStream().pipe(res)` 裸 pipe，无 `error` 监听、无 `res.on('close')` destroy → 磁盘抖动即崩进程，客户端频繁拖进度条 → fd 泄漏至 EMFILE |
| P1-9 | `package.json` multer `1.4.5-lts.2` | 3 个已披露 CVE（CVE-2025-48997 CVSS 8.7 等），无需认证即可崩溃进程 → 升 `^2.4.0` |

### 数据完整性

| # | 位置 | 问题 |
|---|---|---|
| P1-10 | `schema.prisma:169/207/133` `onDelete: Cascade` | 删除用户 → 该用户全部批注/错题/作业/练习记录**物理删除**，而磁盘裁图文件无任何清理（变孤儿）。应为 `SetNull` + 软删除 |
| P1-11 | `routes/annotations.ts:26-55`、`pdfAnnotations.ts:88-121` | 建批注 → 写文件 → 建错题，三步无事务，任一步失败留下孤儿记录或无主 PNG |
| P1-12 | `routes/books.ts:329-340`、`adminBooks.ts:288-298` | **先删文件后删库**，顺序反了；且 `catch {}` 把 P2003/P2024 全部伪装成 404 |
| P1-13 | `adminBookPairs.ts:779-785` | 批量 bind 逐个 `await update` 无事务，中途失败 → 半配对状态，`bookIndex` 据此把书误判为答案页而消失 |

### 明确功能 Bug

| # | 位置 | 问题 |
|---|---|---|
| P1-14 | `pdf/services/pdfMeta.ts:197-204` | `resolveOutlinePage` **所有分支都返回 `null`** → 目录页码永远为 null，目录点击全失效。对照 `pdfProcessor.ts:76-102` 有正确实现（`getPageIndex`） |
| P1-15 | `routes/videos.ts:64-66` | `bytes=-500`（结尾 500 字节）被解析成 `start=0,end=500` → 返回**文件开头**。浏览器探测视频时长必触发。对照 `pdfBooks.ts:105-110` 已正确处理 |
| P1-16 | `pdfBooks.ts:496-516` | 文本抽取失败时仍标记 `textExtracted=true` → 搜索永远搜不到且不再自动补抽 |
| P1-17 | `routes/annotations.ts:38-43` | 裁图目录用未 `parseInt` 的原始 `bookId` 字符串 → `bookId="012"` 时路径与 DB 不一致 → 图片 403 永远加载不出（pdf 版做对了，两版不一致） |
| P1-18 | `client/src/typing/dictionaries.ts` | 309 条词库，**2 组重复 id**（`Oxford5000`、`frequently_used_words03`）+ 1 组重复 url。点「超频单词 level 2」实际加载 level 3 的文件 |
| P1-19 | `client/src/pdf/pages/PdfHome.tsx:453-468` | 批量保存逐条 `catch {}` 吞掉，**最后无条件 `toast.success('已保存')`** → 用户改 20 本书看到"成功"、刷新后全没了 |

### 前端其他

| # | 位置 | 问题 |
|---|---|---|
| P1-20 | `Home.tsx:946/1114`、`PdfHome.tsx:890/1022`、`PdfBookViewer.tsx:886`、`MyWorkspace.tsx:121` | 6 处 `window.open(url,'_blank')` **无 `noopener`** → 反向标签劫持。对照：所有 `<a target="_blank">` 都正确带了 `rel="noopener noreferrer"`，仅 `window.open` 漏了 |
| P1-21 | `components/TocTree.tsx:93-115` | 缩略图栏 `Array.from({length: totalPages})` 全量渲染 DOM，400 页书 = 400 个复合节点瞬间挂载；且加载的是**原图**而非缩略图端点。对照 `english/components/VirtualizedLessonSelector.tsx:63-75` 做了正确窗口化 |
| P1-22 | `api/client.ts:384-389,500-503` | access token 明文拼进图片/视频 URL → 落入浏览器历史、Referer、代理日志。同文件 `scanPdfUrl` 已改用一次性 ticket，这两处没跟上 |
| P1-23 | `api/client.ts:15-26` | refresh token 明文存 localStorage → 任何 XSS（如 P0-8）可直接窃取并长期冒充 |

---

## 四、🟡 P2 中危问题（摘要）

**性能热点**
- `schema.prisma`：所有软删除表缺 `isDeleted` 复合索引 → 2 万本书库上列表接口恒定全表扫描（`Book`/`PdfBook`/`Annotation.type`/`Assignment.status`/`Mistake.reviewStatus`/`Book.batchId` 均无索引）。
- `adminBookPairs.ts` 7 处各拉一次**全表 `attributes` JSON**（2.4w 本 × 数百 MB 峰值），完全没用上已存在的 `bookIndex` 缓存。
- `pdfBooks.ts:566-580` 搜索用 `LIKE '%q%'` 全表扫 + 返回每页**整页 plainText**（只为截 90 字符 snippet）；且 MySQL 大小写不敏感而 `indexOf` 敏感 → `matchIndex = -1`。
- `pdfMeta.ts:63` `readFileSync` 整本 PDF 读入内存，**每请求一张缩略图就重读一遍 189MB 的书**。

**健壮性**
- `services/auth.ts:237-262` 登录锁定仅按手机号 → 知道手机号即可对任意账号发起**锁定 DoS**；失败计数 Map 无上限、无 TTL。
- `index.ts:48` `express.json({limit:'50mb'})`；`assignments.ts:345` `strokes` 数组无长度校验。
- 无 graceful shutdown（`stopBackupScheduler` 定义了但**全仓库从未调用**）→ launchd KeepAlive 强杀时 mysqldump 子进程变孤儿、SSE 任务静默丢失。
- `/api/health` 只返回常量，DB 断了仍 200。
- 日志写 `/tmp` 无轮转、无分级、无告警。

**一致性**
- `schema.prisma:485` 有 `rotation` 字段，但 `pdf_module_init.sql:157-172` 建表语句**没有该列** → 按 SQL 手工建库的实例全线 500。仓库**无 migrations 目录**，只有裸 SQL。
- 备份触发表只有 `['Assignment','Annotation','Mistake']`（`prisma.ts:32`）→ `Pdf*`、`Typing*`、`BookVideo`、`User` 的写入完全不触发备份。
- 响应格式 7 种形态并存（`{data,total,page,pageSize}` / `{data,counts,books,limit}` / 裸对象 / `{success:true}` / 失败也返回 200 …），完整清单见原文附录 A。
- `catch {}` 把一切错误伪装成 404：`books.ts:338`、`annotations.ts:117`、`mistakes.ts:58/73`、`auth.ts:167`（DB 挂了也返回 401）。

**信息泄露**
- `routes/auth.ts:121` 未认证可达，DB 不可达时把 `Can't reach database server at 182.92.129.222:16240` 原文返回给匿名请求者。
- `services/dbBackup.ts:176-181` MySQL 密码以 `-p<password>` 出现在命令行 → 同机 `ps aux` 可见（**但无命令注入**，全部用参数数组，这点是对的）。
- `admin.ts:143-150` `PUT /storage` 允许把静态根设为 `/etc`、`/` 等任意路径。

---

## 五、🔵 P3 架构与技术债

### 最大的债：两套同构模块并存

`schema.prisma:64-97`（`Book`/`Annotation`/`Mistake`/`Assignment`）与 `:273-507`（`PdfBook`/`PdfAnnotation`/`PdfMistake`/`PdfAssignment`/`PdfPageText`/`PdfThumb`）是**两套几乎相同的模型**，唯一桥梁是 `fileHash` 运行时模糊匹配（`pdfBooks.ts:607-610`）。

由此产生的后果（本次审计发现的所有"两版不一致"都源于此）：
- 同一本实体书可能有两条记录，批改/错题/进度数据**分裂在两个空间且永不同步**
- 前端 `Home.tsx`(1426行) 与 `PdfHome.tsx`(1267行)、`BookViewer.tsx`(1783行) 与 `PdfBookViewer.tsx`(1268行)、`AssignmentMode.tsx`(1036行) 与 `PdfAssignmentMode.tsx`(953行) **逐块复制**，然后各自漂移
- 权限校验、参数校验、错误处理在两版里各写一遍 → 本次发现的 P1-3/P1-4/P1-17、P2 的 Range 解析、文本抽取标记等 bug，**全部是"一版对、一版错"**

**建议**：明确收敛路线（以 PdfBook 为准，Book 只读迁移），加 `PdfBook.legacyBookId` 显式关联替代 fileHash 匹配，阅读器逻辑抽 `useReaderNavigation()` hook 共用。

### 其他债

- **死代码**：`components/ui/sidebar.tsx`（771 行，全仓库第 8 大文件）+ `use-mobile.tsx` + `sheet/skeleton/tooltip/separator` + `english/components/Background.tsx`(212行) + `RandomBg.tsx` —— 基于完整 import 依赖图（含 `@/` 别名）确认**零引用**，约 1100 行 + 4 个无用 radix 依赖。
- **超长文件** 13 个 >500 行，最大 `BookViewer.tsx` 1783 行（14 个 useState / 12 个 useRef）。
- **`any` 196 处 / 40 文件**，Top：`BookPairs.tsx`(31)、`api/client.ts`(22)、`BookViewer.tsx`(17)。结构性放大点：`types.ts:59` 的 `contentJson: any`。**但 `@ts-ignore` 0 处**，这点很好。
- `tsconfig.json:15-16` 关闭 `noUnusedLocals/noUnusedParameters` → 17 处未使用 import/变量无人发现。
- 原生 `<button>` 342 处 vs shadcn `<Button>` 39 处（约 9:1），违反 AGENTS.md:201。
- `client/vite.config.js` 与 `.ts` **双份并存**，Vite 优先加载 `.js` → **改 `.ts` 不生效**，典型排查黑洞。两份都硬编码外网 IP `182.92.129.222`。
- `client/public/dicts` 68MB / 311 个 json（其中 3 个是孤儿文件：`ChuZhongluan_2_T`、`GaoZhongluan_2_T`、`IELTSLiuHongbo538`），`coca20000.json` 单文件 4.5MB 同步解析。
- 12 处 zustand 订阅**全部无选择器**（`useStore()` 无参返回整个 state）→ 任意 `set()` 触发全树重渲染。

---

## 六、修复路线图

### 第 1 周：止血（可直接导致失陷或不可用）

1. **P0-1** 备份目录移出 static 根，static 挂载前对 `db-backups` 显式 403
2. **P0-2** `relocate` 改 `adminRequired`；`resolveBookFile → streamFile` 全链路强制 `assertInsidePdfRoot`；`.env` chmod 600
3. **P0-3** plist 的 `CLIENT_ORIGIN` 改实际域名，代码层拒绝 `*`；standalone 模式限制监听回环
4. **P0-4** access token 默认 `2h`，删掉"永不过期"分支
5. **P0-5** 统一备份命名前缀 + 加磁盘空间兜底清理
6. **P0-6** 并发度 `Number.isFinite` 校验
7. **P0-8** 验证码 SVG 改 `<img>` 或 DOMPurify
8. **P1-9** multer 升 `^2.4.0`
9. **P1-7/P1-8** async 中间件包 `.catch(next)`；文件流统一 `streamFile` 封装（error + close destroy）

### 第 2-3 周：补权限与一致性

10. **P1-1/2/3** 抽 `applyTeacherScope(req, where)` 统一三处；teacher 写操作收权
11. **P1-4** pdfBooks 写/删接口加 `adminRequired`
12. **P1-10** 外键 `onDelete` 改 `SetNull`；删除 Mistake 统一走"先删文件再删记录"
13. **P1-11/12/13** 关键多步写入加 `$transaction`；删除顺序改为先库后文件；`catch {}` 按 Prisma 错误码区分
14. **P1-14/15/16/17** 四个明确 Bug（outline 页码、Range 后缀、textExtracted、bookId parseInt）
15. **P1-19** 批量保存失败计数 + 真实 toast

### 第 1-2 月：性能与架构

16. 补索引（见原文附录 B，重点是 `isDeleted` 复合索引）；`VideoProgress` 加 `@@unique([userId, videoKey])`
17. `adminBookPairs` 全表 JSON 加载改读 `bookIndex` 缓存
18. 搜索改 FULLTEXT 或独立搜索表，限制返回字段与条数
19. PDF 文档缓存复用 + `destroy()`；`openPdf` 改异步 + 大小上限
20. **模块收敛**：明确 PdfBook 为主线，抽公共 hook/store，删除 legacy 重复实现
21. 统一响应格式 `{ data, meta? }` / `{ error: { code, message } }`
22. 清理死代码（~1100 行）+ 删除 `vite.config.js` + 词库移 CDN + 修重复 id

---

## 七、做得好的地方（不要改坏）

- ✅ **零 SQL 注入**：全仓库无 `$queryRaw` / `$executeRaw`，全部走 Prisma 类型化查询
- ✅ **零命令注入**：所有外部进程调用均为 `spawn`/`execFileSync` + 参数数组，无 `shell: true`
- ✅ **零路径穿越**：备份文件名 `SAFE_NAME` 正则 + `resolveSafePath` 双重校验；`send` 的 `..` 防护生效
- ✅ **JWT 算法安全**：无 alg=none，无 RS→HS 混淆风险
- ✅ **验证码设计正确**：服务端校验 + 一次性 `delete` 消费 + 16 字节随机 key 不可枚举
- ✅ **SSE ticket 机制**：`utils/sseTicket.ts` 一次性、30s TTL、防重放，设计到位
- ✅ **pdf.js 安全开关**：`isEvalSupported: false` + `disableFontFace: true`，已关闭最危险的 eval 路径
- ✅ **`@ts-ignore` 0 处**，`cn()` 只有一份定义，所有 `<a target="_blank">` 都带 `rel="noopener noreferrer"`
- ✅ **REFRESH token 轮换机制、tokenVersion 吊销**均已实现（只是默认关闭/未校验）
- ✅ 日志中**未发现**打印明文密码或 token

---

## 八、给决策者的三句话

1. **如果这台机器暴露在公网或不可信局域网**，P0-1 到 P0-4 构成一条完整攻击链（下载备份 → 或读 `.env` → 伪造永久 admin token），**建议本周内完成第 1 周止血清单**。
2. **即使不出安全事故**，P0-5（备份永不清理）也会在数周内把磁盘写满，P0-6（任务挂死）会周期性让导入功能失效 —— 这两条是必然发生的运维事故。
3. **所有"两版不一致"的 bug 都指向同一个根因**：legacy 图片版与 PDF 原生版双轨运行。继续双轨，bug 会持续以"修好这版、漏了那版"的方式再生。建议尽快确定收敛路线。
