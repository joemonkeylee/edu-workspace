# PDF 原生模块 · 实施记录（P0–P3）

> 分支 `feature/pdf-native` ｜ 状态：服务端完成 + 前端可用，批注/作业/错题为下一阶段

---

## 一、两条原则的落实情况

### 原则 1：不影响原流程 —— 已用 git diff 验证

```
server/src/routes/*   改动：0 个文件
server/src/services/* 改动：0 个文件
```

全部改动都是**新增挂载点或纯增量导出**：

| 文件 | 改动 | 性质 |
|---|---|---|
| `server/prisma/schema.prisma` | +254 行 | 只新增 model，User 只加反向关系虚拟字段 |
| `server/src/index.ts` | +12 行 | 挂载 `/api/pdf` + 启动时建目录 |
| `client/src/App.tsx` | +25 行 | 新增 `/pdf`、`/pdf/book/:id` 两条 lazy 路由 |
| `client/src/api/client.ts` | +12 行 | 新增 `apiClient` 与 `getAccessToken` 两个导出 |
| `client/src/components/AppHeaderRight.tsx` | +8 行 | 导航加一个 PDF 入口 |

新增目录：`server/src/pdf/`、`client/src/pdf/`

### 原则 2：不影响原数据 —— 已在真实库上验证

```
✅ 10 张 pdf_* 表全部创建成功
✅ Book 原有 14665 条记录数不变
✅ 遗留表 assignment_copy1（20 行）、assignmentstroke_copy1（467 行）完好
✅ 既有接口 /api/books 正常返回（total 9123）
```

**⚠️ 过程中发现的一个真实隐患（务必注意）**

直接跑 `prisma db push` 会**删掉**这两张遗留表 —— Prisma 的 diff 里包含：

```sql
-- DropTable
DROP TABLE `assignment_copy1`;
DROP TABLE `assignmentstroke_copy1`;
```

因为这两张表不在 schema 里。它们分别有 **20 行和 467 行真实数据**。

所以本次没有用 `db push`，而是：
1. 用 `prisma migrate diff` 生成完整 DDL
2. **过滤掉所有非 `pdf_` 语句**
3. 用 `prisma db execute --file` 只执行 `pdf_*` 部分

DDL 已存档在 `server/prisma/pdf_module_init.sql`，内容只有 10 条 `CREATE TABLE` + 与之配套的 `ALTER TABLE`（外键）。

> 后续往 schema 里加新 model 时，同样**不要**直接 `db push`，否则这两张表会被清掉。

---

## 二、已完成的四个阶段

### P0 · 数据模型

10 张表，全部 `@@map("pdf_*")`：

| 表 | 用途 |
|---|---|
| `pdf_book` | 书籍。引用式存储（rootPath/relPath/missing）、pageSizes、searchable、textStats、tocJson |
| `pdf_source_root` | 资源根目录，换盘时整体 repoint |
| `pdf_page_text` | 每页文本层缓存（归一化坐标 + plainText） |
| `pdf_thumb` | 缩略图缓存记录 |
| `pdf_annotation` / `pdf_mistake` | 批注 / 错题 |
| `pdf_assignment` / `pdf_assignment_stroke` | 作业 / 笔迹（含 student·teacher 双图层） |
| `pdf_reading_progress` | 阅读进度（`scale` 替代原 DPI 概念） |
| `pdf_book_favorite` | 收藏 |

### P1 · 服务端基础能力

```
GET    /api/pdf/books                    列表（分页/书名/年级/学科/分类/可搜索性）
GET    /api/pdf/books/facets             筛选选项（服务端聚合，不把全量拉到前端）
GET    /api/pdf/books/:id                详情
PATCH  /api/pdf/books/:id                更新元信息
DELETE /api/pdf/books/:id                软删
GET    /api/pdf/books/:id/file           ★ PDF 流式返回，支持 Range
GET    /api/pdf/books/:id/meta           页数/每页尺寸/outline/可搜索性
GET    /api/pdf/books/:id/cover          封面（按需渲染 + 落盘缓存）
GET    /api/pdf/books/:id/thumb/:page    页缩略图（按需渲染 + 落盘缓存）
GET    /api/pdf/books/:id/text/:page     单页文本层（归一化坐标）
POST   /api/pdf/books/:id/text/extract   全书文本层抽取（可指定页范围）
GET    /api/pdf/books/:id/search         书内搜索（auto=1 时先抽后搜）
POST   /api/pdf/books/:id/rehash         重算 sha256（与旧 Book.fileHash 建立映射）
POST   /api/pdf/books/:id/relocate       重新登记引用路径
```

### P2 · 扫描与入库

```
POST /api/pdf/admin/scan/preview        dry-run，只解析不入库，返回建议元数据 + searchable 判定
POST /api/pdf/admin/scan/commit         批量入库（含封面生成）
GET  /api/pdf/admin/roots               资源根目录列表
POST /api/pdf/admin/roots               登记根目录
POST /api/pdf/admin/roots/:id/repoint   换盘后整体重定向
POST /api/pdf/admin/seed-from-books     从既有 Book 播种（只读旧库）
POST /api/pdf/admin/recheck-searchable  对已入库的书重跑文本层检测
```

`scan/preview` 复用了既有代码：`cleanPdfName`（文件名清洗）、`parseGradeSubjectFromPath`（年级/学科解析）。

### P3 · 前端

```
client/src/pdf/
├── api/pdfClient.ts              全部 /api/pdf/* 调用
├── lib/pdfjs.ts                  pdf.js 入口 + worker + 文档缓存 + 渲染封装
├── components/PdfBookCover.tsx   封面（懒加载 + 占位）
├── components/PdfPageCanvas.tsx  单页 canvas 渲染（含渲染取消）
├── pages/PdfHome.tsx             书库列表（搜索/筛选/分页）
└── pages/PdfBookViewer.tsx       阅读器（翻页/缩放/适宽适页/缩略图/书内搜索）
```

pdf.js 通过 `React.lazy` 路由级拆包，**只在进入 `/pdf` 时才下载**：

```
dist/assets/pdf.worker.min-*.mjs    1375 kB   ← 独立 worker chunk
dist/assets/PdfBookViewer-*.js       374 kB   ← 含 pdf.js 主体，按需加载
dist/assets/PdfHome-*.js             7.6 kB
dist/assets/index-*.js               824 kB   ← 主包体积未变
```

---

## 三、浏览器端到端验证（真实 Chrome，非模拟）

用 playwright-core 驱动本机 Chrome，对真实数据跑完整流程：

| 检查项 | 结果 |
|---|---|
| 书库列表 | 24 张卡片，24 张封面全部加载（300×424） |
| 阅读器 canvas | 1416×2002，非白像素 1345 → **确实渲染出了内容** |
| 翻页 | 输入 3 后正确跳转 |
| 缩放 | 100% → 125% 生效并重渲染 |
| 缩略图侧栏 | 17 张，首张 140×198 正常 |
| 书内搜索 | 「北京人」命中 4 条，点击可跳页 |
| PDF 文件请求 | 200（完整）+ 206（Range）均正常 |
| 控制台错误 | **0** |
| 既有 `/books` 页面 | 16 张卡片正常，导航新增 PDF 入口 |

### 验证中发现并修掉的三个真实缺陷

1. **画布永不渲染** —— 首次渲染时 `book` 还没到，容器 DOM 不存在；`useRef` + `[]` 依赖的 ResizeObserver 永远不会挂上，宽度恒为 0。
   改为 `useState` 存容器节点 + 依赖该 state。
2. **页缩略图 404** —— 播种时沿用了旧表不准的 `totalPages`（14），实际 PDF 有 17 页，服务端按旧值预判越界。
   改为交给 pdf.js 判断，同时播种时用 `inspectPdf` 实测页数。
3. **服务端渲染段错误（exit 139）** —— 见下节。

---

## 四、一个必须记住的坑：@napi-rs/canvas 不能有重复副本

服务端渲染封面/缩略图需要原生 canvas。踩了两个坑：

**坑 1：Node 22 没有全局 `Path2D`**，pdf.js 渲染字形时调 `ctx.fill(path)` 会报
`InvalidArg: Value is none of these types String, Path`。
pdf.js 会自动 `require('@napi-rs/canvas')` 做 polyfill，但只有能解析到才行。

**坑 2（更严重）：两份物理副本会直接段错误**

项目里同时存在 `node_modules/@napi-rs/canvas`（根，0.1.100，被其他依赖带入）和
`server/node_modules/@napi-rs/canvas`（1.0.9）时，pdf.js 用 A 副本的 Path2D、
我们用 B 副本的 ctx，两个原生模块同时加载 → **进程直接 SIGSEGV（exit 139）**。

**正确做法**：依赖声明在**根 workspace 的 package.json**（`@napi-rs/canvas@0.1.100`），
`server/package.json` 里**不要**声明它。代码里额外做了一次防御性 polyfill（`pdfRender.ts` 的 `getCanvasLib`）。

验证方式：
```bash
ls -d node_modules/@napi-rs/canvas server/node_modules/@napi-rs/canvas
# 只应有根目录那一条
```

---

## 五、下一阶段（P4–P6）

| 阶段 | 内容 |
|---|---|
| P4 | 批注 / 笔迹 / 阅读进度 / 收藏（表已建好） |
| P5 | 作业（布置·提交·批改·导出）+ 错题（表已建好） |
| P6 | 缩略图批量预热、跨库搜索（需 ngram parser） |

导出作业仍走图片方案（前端渲染 + `canvas.toBlob`），零新依赖。

---

## 六、本阶段定下的技术决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 存储方式 | **引用式**（rootPath + relPath + missing） | 照抄已验证的 BookVideo 范式；换盘只需 repoint |
| User 外键 | 加反向关系字段 | 纯虚拟字段，不产生任何列，支持级联删除 |
| PDF 寻址 | `/api/pdf/books/:id/file` | 库内文件名大量含中文与全角符号，按 id 寻址彻底规避编码问题 |
| 缩略图 | 导入时只生成封面，页缩略图**按需生成 + 落盘缓存** | 兼顾「导入时切一张」与页缩略图 tab 的性能 |
| 搜索范围 | 一期**只做书内搜索**（`LIKE`） | MySQL FULLTEXT 默认不分词中文；跨库需 ngram parser，二期再说 |
| 渲染 | 服务端 canvas（封面/缩略图）+ 浏览器 pdf.js（正文） | 服务端只做小图；正文交给浏览器，矢量清晰、可选中 |

---

## 七、P5-C 列表页 / 详情页与 books 界面功能对齐（2026-09-25）

目标：门户 PDF 前端与 books 界面「功能一模一样」（列表页 + 详情页）。
做法：用 Explore 子代理逐行通读 7 组对照文件，输出差距清单，按 P0/P1/P2 补齐。

### 已补齐（P0 数据安全 / 功能不可用）
- **PdfHome 删除无二次确认** → 改用 `useConfirm`：单本 / 批量删除均弹确认框（红按钮）。
- **PdfAssignmentMode 保存失败仍退出** → `handleExit` 改为 `if (!await saveCurrentPage()) { toast.error; return }`。
- **PdfAssignmentMode 空作业不清理** → 退出后 `cleanupEmptyAssignments()` 扫全书非 graded/submitted 作业，无笔迹即删。
- **PdfBookViewer 进入做题模式无去重** → 当前页有未批改作业弹「复用 / 新建」；`enteringAssignment` 置位并禁用按钮防连点。
- **PdfPageCanvas 反向拖框选失效** → 用 `startRef` + `Math.min/Math.abs` 归一化；命中测试从数组头部开始（与图片版一致）。

### 已补齐（P1 明显功能缺失）
- PdfHome：筛选 / 排序 / 每页行数变化后回到第 1 页；未保存守卫区分「退出编辑」与「改筛选/切 Tab」（保存后保留编辑态）；列表骨架屏补 colgroup + thead + 复选框占位；booksPerRow 默认 8。
- PdfBookViewer：缩放百分比可点击输入（回车提交 / Esc 取消）；非浏览工具强制单页（effectiveLayout）；下载原 PDF 在 `book.missing` 时禁用并提示「暂无 PDF」；批注列表显示创建时间；作业刷新后同步 currentAssignment 状态；翻页清除选中批注（点批注跳转保留，skipClearRef）。
- PdfAssignmentMode：翻页后自动切到该页已有作业（switchGuardRef 防止手动切换时被覆盖）。
- PdfAssignmentList：整张卡片可点击进入；`a.pages` 判空健壮性；提交/删除确认文案带标题与后果。
- PdfTocTree：缩略图改为单列大图（p-4 space-y-4）；目录选中项加左侧竖条高亮 + text-sm。
- PdfBookCover：contain 模式改白底（与图片版一致）。
- PdfCropTool：选区最小阈值 L75/L148 统一为 5px。

### 验证
- `client tsc --noEmit` 通过；`npm run build:server` / `VITE_APP_ENV=TEST npm run build:client` 均通过。

### 已知剩余差距（移动端 / 视觉微差，未阻塞）
- PdfAssignmentMode 缺双指捏合缩放 + 拖拽平移、触控笔默认行为拦截、移动端首屏自动旋转、旋转时标题逐字竖排渲染（图片版为桌面 + 触屏增强，体积较大，留待二期）。
- 配色（钢笔三色、高亮色透明度）、部分图标尺寸等与图片版存在视觉微差。

---

## 八、补齐二期剩余差距（2026-09-25）

把上一轮标记为「留二期」的差距全部完成。

### A. AssignmentMode 移动端增强（client/src/pdf/components/PdfAssignmentMode.tsx）
- **双指捏合缩放 / 拖拽平移**：移植图片版 `handleTouchStart/Move/End` + `updateViewport/resetViewport` + `gestureScale/panOffset` 状态；画布 div 的 transform 改为 `translate(...) rotate(...) scale(gestureScale)`，容器挂 pointer 手势监听，`touchAction: none`。`DrawingCanvas` 本身已 `if (e.pointerType === 'touch') return`，故触摸不会误触发画线，无冲突。
- **触控笔默认行为拦截**：移植 `blockPencilDefaults`（pointer）+ `blockPencilTouchDefaults`（touch，识别 stylus/pen touchType），拦截 selectstart/contextmenu/dragstart/copy/cut + selectionchange，作用域限定在 `modeRef` 容器内。
- **首屏自动旋转**：`ratio`（h/w）已知且非桌面浏览器时，按「页面长边对齐屏幕长边」自动 `setRotation(-90)`，`autoRotatedRef` 保证只触发一次；桌面浏览器排除（与图片版一致）。
- **旋转时标题逐字竖排**：移植 `renderTextByCharacter`，顶栏书名/作业名/状态/保存态/页码在 `isRotated` 时加 `writing-mode:vertical-rl` + 中文逐字 `rotate(chineseRotation)`；顶栏与工具栏按 `rotatedDir`/`toolbarRotationClass`/`iconRotationAll` 做竖排与图标旋转。

### B. 视觉微差对齐
- `PEN_COLORS` 由 `['#000000','#e11d48','#2563eb']` → 图片版 `['#1a1a1a','#2563eb','#dc2626']`（钢笔三色）。
- `HIGHLIGHT_COLOR` 由 `rgba(255,235,59,0.35)` → 图片版 `rgba(250,204,21,0.5)`；`drawStrokeFull` 高亮 `globalAlpha 0.35` 保持不变，与图片版有效透明度一致。
- 图标尺寸：X / 翻页箭头提到 18，其余工具图标 16，与图片版对齐。
- 验证：图片版 `PageCanvas` 阅读高亮本就用 `rgba(255,235,59,0.3)`，PDF 版已相同；批注标记色走共享 `utils/annotationColors`，本就一致 → 无需改动。

### 验证
- `client tsc --noEmit` 通过；`VITE_APP_ENV=TEST npm run build:client` 通过（仅一条与本次无关的字体 CSS 警告）。
