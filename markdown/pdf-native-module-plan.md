# PDF 原生模块（独立流程）方案讨论稿

> 分支：`feature/pdf-native`（从 `main` 拉出，当前与 main 完全一致，尚无代码改动）
> 目标：**新建一个与现有图片流程完全并行的 PDF 原生流程**，操作体验一致，但数据、接口、页面、存储全部独立。
> 本文件是讨论稿，不是实施记录。

---

## 零、技术预研结论（已用现有书籍 PDF 实测）

预研全部在 `server/storage/books/` 的真实 PDF 上完成，脚本跑完即删，未改动任何仓库文件。

### 1. 坐标体系可复用 —— 最关键的一条，已验证

```
storage/books/100/第1~12课（考点清单）.pdf  第 1 页
  pdf.js viewport@scale=1  : 595.300 × 841.900 pt   rot 0
  pdf.js viewport@300/72   : 2480.42 × 3507.92  → round 2480 × 3508
  现有 PNG page-0001.png   : 2481 × 3508
  偏差：1 px / 2480 = 0.04%
```

PDF 页面框与现有 PNG **严格等比**（A4 @300DPI）。批注/笔迹的坐标体系（页码 + 归一化 0-1）**无需任何换算或迁移**。
> 补充：上一轮抽样 60 本 296 页已确认 `Rotate` 全为 0、`CropBox == MediaBox`、同书内页面尺寸一致，本次再次印证。

### 2. 文本层：90% 的书可以直接做全文搜索

抽样 30 本：

| 指标 | 结果 |
|---|---|
| 有真实文本层的 PDF | **27 / 30（90%）** |
| 纯扫描件（0 text items） | 3 / 30（10%） |
| 自带 PDF outline（目录） | 9 / 30（30%） |
| 平均页数 | 27.2 页 |

文本层坐标可直接归一化（实测 `"第" nx=0.4394 ny=0.9553 h=9.0pt`）—— **全文搜索、按文字定位、AI 批改是真实可得的红利**，不是画饼。
但必须设计降级：**无文本层的书要标记 `hasTextLayer=false`，UI 上隐藏搜索入口**，否则用户会以为功能坏了。

### 3. 解析性能：不是问题

```
随机 150 本打开失败率：0 / 150
189.0 MB / 90 页  → 打开 33ms，取文本 +5ms
152.5 MB / 116 页 → 打开 45ms
145.3 MB / 60 页  → 打开 42ms，取文本 243ms
中位 0.53MB / 14 页 → 打开 2ms
```

pdf.js 只先读 xref，大文件打开是毫秒级；页面渲染依赖 HTTP Range 按需拉取，**189MB 那本不需要整体下载**。
唯一要确认的是服务端静态/流式返回必须支持 Range（见下文 §4）。

### 4. 流量账：PDF 模式 2.4 页后就赢

```
现有 PNG 平均 753 KB/页（82.6 GB ÷ 109681 张）
PDF 平均 1.8 MB/本
→ 翻到第 3 页起，PDF 模式总传输量已低于图片模式
```

---

## 一、隔离边界（两条原则怎么落地）

**原则 1：不影响原流程 —— 只新增，不修改。**

| 层 | 现有 | 新增（全部新文件/新挂载点） |
|---|---|---|
| 数据库 | `Book` / `Assignment` / `Annotation` / `Mistake` / `ReadingProgress` / `BookFavorite` / `BookVideo` | `pdf_book` / `pdf_assignment` / `pdf_annotation` / `pdf_mistake` / `pdf_reading_progress` / `pdf_book_favorite` 等 |
| 服务端路由 | `/api/books`、`/api/annotations`… | **`/api/pdf/*`**（独立 router，在 `index.ts` 末尾挂载） |
| 静态资源 | `express.static('/storage')` | **`/storage/pdf`**（独立目录 `server/storage/pdf/`） |
| 前端路由 | `/books`、`/book/:id`、`/admin/*` | **`/pdf`、`/pdf/book/:id`、`/pdf/admin/*`** |
| 前端代码 | `src/pages`、`src/components` | **`src/pdf/pages`、`src/pdf/components`、`src/pdf/api`** |
| 服务端代码 | `src/routes`、`src/services` | **`src/pdf/routes`、`src/pdf/services`** |
| 依赖 | — | 客户端新增 `pdfjs-dist`（与服务端同版本 `^4.10.38`），**按需 dynamic import**，不进主包 |

**原则 2：不影响原数据 —— 现有表一个字段都不动。**

- 只 `CREATE TABLE pdf_*`，不 `ALTER TABLE` 任何现有表；
- `prisma db push` 对现有表零 DDL（新增 model 只会建新表）；
- 唯一的"交叉"是 **User**：登录体系必须共用，新表需要 `userId`。
  - 方案 A（推荐）：在 `User` model 上加反向关系字段（`pdfBooks PdfBook[]` 等）。**这是纯虚拟字段，不会在 `user` 表产生任何列**，也不会影响现有查询。
  - 方案 B（更极端）：不加关系，`userId` 存裸 Int。完全不碰 `User` model，但删用户时会留孤儿数据。
  - 我倾向 A，见 §5 待确认。

---

## 二、表结构设计（Prisma，全部 `@@map("pdf_*")`）

### 核心：`pdf_book`

```prisma
model PdfBook {
  id         Int      @id @default(autoincrement())
  title      String
  category   String   @default("")
  grade      String   @default("")
  subject    String   @default("")
  batchId    String   @default("")

  /// pdf = 有文本层的正常 PDF；scan = 纯扫描件（无文本层，搜索不可用）
  pdfKind      String   @default("pdf") @db.VarChar(16)
  coverPage    Int      @default(1)
  totalPages   Int      @default(0)

  /// —— 引用式存储（照抄 BookVideo 已验证的范式）——
  filePath     String   @db.Text   // 当前绝对路径
  rootPath     String   @db.Text   // 导入时的根目录，换盘时整体替换
  relPath      String   @db.Text   // 相对路径，平台无关
  missing      Boolean  @default(false)
  fileSize     Int      @default(0)
  fileHash     String?  @db.VarChar(64)

  /// 页面尺寸快照（pt），用于坐标换算与首屏占位
  pageSizePt   Json?
  hasTextLayer Boolean  @default(false)
  /// toc 来源：outline（PDF 自带）| parsed（文本解析）| manual
  tocSource    String   @default("manual") @db.VarChar(16)
  tocJson      Json     @default("[]")
  attributes   Json     @default("{}")

  isDeleted  Boolean   @default(false)
  deletedAt  DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  annotations PdfAnnotation[]
  mistakes    PdfMistake[]
  assignments PdfAssignment[]
  readingProgress PdfReadingProgress[]
  favorites   PdfBookFavorite[]
  pageTexts   PdfPageText[]

  @@unique([title, category])
  @@index([category]) @@index([grade]) @@index([subject]) @@index([fileHash])
  @@map("pdf_book")
}
```

### 其余表

| 新表 | 对应现有表 | 差异 |
|---|---|---|
| `pdf_annotation` | `Annotation` | 结构一致，FK → `PdfBook` |
| `pdf_mistake` | `Mistake` | `imagePath` 指向**新目录** `storage/pdf/crops/`；裁图由前端渲染后上传 |
| `pdf_assignment` | `Assignment` | 结构一致 |
| `pdf_assignment_stroke` | `AssignmentStroke` | 结构一致（含 `layer` student/teacher） |
| `pdf_reading_progress` | `ReadingProgress` | 增加 `scale`（渲染倍率）、`renderMode` |
| `pdf_book_favorite` | `BookFavorite` | 结构一致 |
| `pdf_page_text` | **新增** | 每页文本层缓存：`{bookId, pageNumber, items Json, plainText Text}`，全文搜索索引 |
| `pdf_thumb` | **新增** | 缩略图缓存记录：`{bookId, pageNumber, path, w, h, bytes}`，封面记为 page 0 |
| `pdf_source_root` | **新增** | 资源根目录：`{label, rootPath, enabled, bookCount}`，换盘时 repoint |

> `pdf_book_video` 暂不做（视频关联二期再迁），一期专注书籍本体 + 批注 + 作业 + 错题。

---

## 三、新增 API（全部 `/api/pdf/*`，不动现有任何路由）

### 书籍
```
GET    /api/pdf/books                      列表（分页 / grade / subject / category / 搜索）
POST   /api/pdf/books                      创建（上传文件或登记引用）
GET    /api/pdf/books/:id                  详情
PATCH  /api/pdf/books/:id
DELETE /api/pdf/books/:id                  软删
```

### PDF 本体（★ 核心）
```
GET    /api/pdf/books/:id/file             流式返回 PDF，支持 Range、鉴权、按 id 寻址
GET    /api/pdf/books/:id/meta             页数 / 页面尺寸 / outline / hasTextLayer / 解析状态
GET    /api/pdf/books/:id/cover            封面 jpg（服务端缓存）
GET    /api/pdf/books/:id/thumb/:page      页缩略图 jpg（服务端缓存）
GET    /api/pdf/books/:id/text?page=N      某页文本层（归一化坐标）
GET    /api/pdf/books/:id/search?q=        全文搜索（走 pdf_page_text）
```

> **为什么用 `/file` 路由而不是 express.static**：现有 PDF 文件名大量含中文和全角符号
> （如 `第1~12课（考点清单）.pdf`），直接静态暴露会有编码坑；走 `/file` 按 id 寻址可
> 彻底规避，同时能挂鉴权中间件（复用 `cropsAuthMiddleware` 的思路）和统一的缓存头。

### 业务
```
/api/pdf/annotations ...
/api/pdf/mistakes ...
/api/pdf/assignments ...（含提交 / 批改 / 导出）
/api/pdf/reading-progress ...
```

### 管理端
```
POST   /api/pdf/admin/scan/preview         扫描目录 dry-run（只解析不入库，返回建议元数据）
POST   /api/pdf/admin/scan/commit          批量入库
POST   /api/pdf/admin/roots                登记资源根目录
POST   /api/pdf/admin/roots/:id/repoint    换盘后整体重定向
POST   /api/pdf/admin/seed-from-books      从现有 Book + PDF 文件「元数据播种」（只读旧库）
```

---

## 四、前端（拷贝一套，不改原页面）

```
client/src/pdf/
├── pages/
│   ├── PdfHome.tsx           ← 拷贝 Home.tsx
│   ├── PdfBookViewer.tsx     ← 拷贝 BookViewer.tsx（1781 行，改动集中在渲染层）
├── components/
│   ├── PdfPageCanvas.tsx     ← 拷贝 PageCanvas，底层改 canvas 渲染
│   ├── PdfCropTool.tsx
│   ├── PdfDrawingCanvas.tsx
│   ├── PdfTocTree.tsx
│   ├── PdfAssignmentMode.tsx
│   ├── PdfBookCover.tsx
│   ├── PdfResourceKindMenu.tsx
│   └── admin/（PdfScanImport / PdfBooksTable / ...）
├── api/pdfClient.ts          ← 拷贝 client.ts 的 PDF 相关方法
├── lib/pdfjs.ts              ← workerSrc 初始化 + 单例 document 缓存
└── lib/pageSource.ts         ← 页面渲染契约（canvas）
```

**因为是完全独立模块，可以直接上 canvas 渲染契约**，不用为了兼容老 `<img>` 而降级成位图 —— 这是独立带来的最大收益：矢量清晰度、缩放不糊、可选中文本。

pdf.js worker 集成（Vite）：
```ts
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
```
配合 `React.lazy` / dynamic import，pdf.js（~1MB）不进主包，只在进入 `/pdf/*` 时加载。

---

## 五、待确认的六个点（请拍板）

1. **存储方式**：引用式（`rootPath + relPath + missing`，照抄 `BookVideo`，换盘一键 repoint）
   还是拷贝进 `storage/pdf/books/{id}/source.pdf`？
   → 我建议**引用式为主、拷贝可选**。理由：14665 本里 8835 本"有记录无文件"说明换盘真实发生过；
   引用式还能顺带让这批孤儿书重插硬盘即恢复。

2. **User 外键**：在 `User` 上加反向关系字段（不产生任何列变化，支持级联删除），
   还是完全不碰 `User`、只存裸 `userId`？
   → 我建议**加反向关系**，级联删除更干净，且对现有数据零影响。

3. **种子数据**：要不要做 `seed-from-books`，把现有 5661 本有 PDF 的书「元数据」批量播种到 `pdf_book`？
   纯只读旧库 + 只读文件系统，几分钟就能建好库，能让新模块立刻有真实数据可测。
   → 我建议做，这是让新模块能马上跑起来的最快路径。

4. **缩略图**：服务端预生成缓存（`pdf_thumb` 表 + `storage/pdf/thumbs/`），还是前端懒渲染？
   → 我建议**服务端预生成**。页缩略图 tab 面对几十~几百页是性能风险最大的一处，
   服务端生成 100px 宽约 5KB/页，前端改动最小也最稳。

5. **一期范围**：
   - 最小闭环：书籍管理 + 阅读器 + 批注 + 进度
   - 完整闭环（推荐）：再加 作业（布置/提交/批改/导出）+ 错题
   → 我建议**完整闭环**，因为表都新建了，一起建成本更低；而且作业/错题的代码是纯拷贝 + 渲染层替换，没有新增技术风险。

6. **搜索**：`pdf_page_text` 表一期就建，还是二期？
   → 我建议**一期建表、二期做 UI**。建表只是导入时多一步抽取（实测取文本 1~243ms/页，可接受），
   后面做搜索时不用重跑全库。

---

## 六、已知风险与对策

| 风险 | 实测/判断 | 对策 |
|---|---|---|
| 10% 扫描件无文本层 | 3/30 实测 | `hasTextLayer=false`，UI 隐藏搜索，其余功能不受影响 |
| 189MB 大书首屏 | 打开仅 33ms，但依赖 Range | `/file` 路由必须支持 `Range`；首屏先渲封面+前 3 页 |
| 中文文件名编码 | 真实存在（全角括号、`~`） | 走 `/file?id=` 寻址，不暴露文件名 |
| 远程资源服务器 CORS | `deploy/Caddyfile` 已代理 `/data`、`/lt` | 若 PDF 走远程，需配 CORS；本地 storage 则无此问题 |
| pdf.js 打包体积 ~1MB | — | dynamic import + 路由级懒加载 |
| 缩略图 tab 卡顿 | 风险最高的一处 | 服务端缓存 + 前端虚拟化 |
| 双份数据心智负担 | 必然 | 导航上明确区分「图书（图片）」与「PDF 书库」入口；不做数据互通 |

---

## 七、建议的实施顺序

```
P0  分支 + Prisma 新增 pdf_* 模型 + db push（现有表零 DDL）
P1  服务端 /api/pdf/books CRUD + /file 流式 + /meta
P2  扫描 dry-run + 校正 UI + 入库（对应你提的「先解析目录再关联」）
P3  前端拷贝页面 + pdf.js 接入 + 阅读器跑通
P4  批注 / 进度 / 收藏
P5  作业 + 错题 + 导出
P6  缩略图缓存 + 全文搜索（可选）
```

每一阶段结束都是可独立验证的状态，且任何阶段回滚都只影响 `pdf_*`，原流程不受牵连。
