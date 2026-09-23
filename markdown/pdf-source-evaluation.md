# 页面数据源改造评估：从「预切 PNG」到「原始 PDF 直读」

> 目标：评估在不破坏现有功能的前提下，新增一套「数据源 = 原始 PDF」的处理链路，与现有「数据源 = 预渲染 PNG」双轨并存。

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| 用原始 PDF 能完成现有全部功能吗？ | **能，且没有一项功能在原理上做不到** |
| 现有业务数据要迁移吗？ | **不用**。批注/笔迹/错题全部是 `pageNumber + 归一化 0-1 坐标`，与渲染方式解耦 |
| 值不值得做？ | **值得**。存储 82.6G → 9.6G（省 88%），导入从小时级降到分钟级，且额外解锁矢量清晰度与文本层 |
| 能一刀切替掉图片模式吗？ | **不建议**。169 本书没有 PDF 原件，双轨是刚需 |
| 改造面多大？ | 集中在「页面位图的产出方式」这一层。抽象位置选对，**业务组件可以一行不改** |

---

## 1. 现状实测数据（基于本机 storage）

```
server/storage/books：5830 本书目录，总计 92 GB
  ├─ PDF 原件   5661 个    9.6 GB   （中位数 0.53MB，P90 2.6MB，最大 189MB）
  └─ PNG 页面图 109681 张  82.6 GB  （全部 300 DPI 单档，无其它档位）

每本平均：PDF 1.8MB  vs  PNG 15.2MB   →  PNG 是原文的 8.6 倍
每本平均页数：约 19 页
无 PDF 原件的书：169 本（5830 - 5661）
```

关键推论：

1. **省磁盘 73 GB**，且备份/迁移/换硬盘的成本同样按 8.6 倍下降。
2. **导入耗时的瓶颈是渲染**，不是扫描。`admin.ts` 里预估 `0.3s/页 × (dpi/150)`，300 DPI 下约 0.6s/页 → 一本 19 页约 11s，5830 本约 18 小时（还不算并发上限）。改成「拷贝 PDF + pdfinfo + 提取目录」后，单本降到 1~3 秒。
3. **97% 的书已经有 PDF 原件躺在 `books/{id}/` 里**（`admin.ts:753` 导入时 `copyFile` 存了一份），所以老书可以直接切到 PDF 模式，不需要重新扫盘。只有 169 本例外 —— 这就是必须保留图片轨的直接理由。

---

## 2. 数据兼容性（最关键的技术风险）

现有所有用户数据都长这样：

| 数据 | 存储内容 | 是否依赖图片 |
|---|---|---|
| `Annotation.contentJson` | `{x, y, w, h}` 或 `{x, y, text}`，**归一化 0-1** | 否 |
| `AssignmentStroke.points` | `[{x, y, p}]`，**归一化 0-1** | 否 |
| `Annotation.pageNumber` / `pageNumber` | 页码整数 | 否 |
| `Mistake.imagePath` | 裁剪出的 PNG 文件（crops 目录） | 间接（前端生成） |
| `Book.tocJson` / `totalPages` / `coverPage` | 元数据 | 否 |

只要 **PDF 页面宽高比 == 现 PNG 宽高比**，归一化坐标就是同一套坐标系，老批注直接可用，零迁移。

实测抽样 60 本 / 296 页：

```
Page rot 取值分布：{0: 296}          → 无页面旋转
CropBox != MediaBox 的书：0 本        → 无裁剪框差异
同一本书内页面尺寸不一致：0 本        → 页内尺寸统一
```

即：PNG 尺寸 = MediaBox(pt) / 72 × 300，pdf.js 的 viewport 尺寸 = MediaBox / 72 × scale，两者严格等比。**坐标体系可以安全复用。**

> 注意：这只覆盖 60 本样本。正式切换前建议跑一次全量校验脚本（pdfinfo 取页面尺寸，与现有 PNG 像素尺寸 ÷ 300 × 72 比对），把少量异常书单独标记、留在图片轨。

---

## 3. 功能逐项可行性

| 功能 | 现状依赖 | PDF 模式怎么做 | 难度 |
|---|---|---|---|
| 阅读器翻页 / 缩放 / 旋转 / 双页 | `imgNatural`（`new Image()` 预加载取尺寸） | 用 `page.getViewport()` 拿尺寸，**比现在更快**（不用加载整张图） | 低 |
| 批注（高亮 / 便签 / 点击命中） | 上层 canvas 按归一化坐标画 | 完全不变，只换底层画布 | 低 |
| 裁剪错题 | `react-image-crop` + `ctx.drawImage(img)` | 高 scale 离屏渲染该页 → `toBlob` 喂 `<img>`，或直接渲染裁剪区 | 中 |
| 作业模式笔迹 | `DrawingCanvas` 叠加在 `<img>` 上 | 底图换成渲染结果即可，笔迹数据不动 | 中 |
| 导出 JPG | 服务端拼 `pageImage` 路径，前端合成 | 高 scale 重渲染整页 + 叠加笔迹 | 中 |
| 左侧缩略图 tab | 每页一张 PNG 小图 | **性能风险点**：几百页要懒渲染 / 服务端缓存 | 中 |
| 首页 / 管理台封面 | `getBookCoverUrl()` 拼 PNG 路径 | **强烈建议服务端生成封面缩略图**（一屏 16 本，不能让前端各下一份 PDF） | 中 |
| 下载原 PDF | 已有 `pdfUrl` | 不变 | 无 |
| 目录 TOC | pdf.js 已在服务端提取 | 不变 | 无 |
| 视频关联 / 教材答案配对 / 备份 | 与图片无关 | 不变 | 无 |

额外红利（图片模式做不到）：
- **矢量无限清晰**：放大不糊，不再受 300 DPI 上限约束。
- **文本层与搜索**：可选开启，教材全文检索、批注吸附到文字。
- **按需渲染**：不必一次性加载整页大图，移动端内存更可控。

---

## 4. 需要改造的代码清单

### 4.1 服务端

| 文件 | 位置 | 现状 | 改造 |
|---|---|---|---|
| `services/pdfProcessor.ts` | `renderPages()` :112 | pdftoppm 批量渲染 | 保留（图片轨），新增 PDF 轨不走这里 |
| 同上 | `getAvailableDpis()` :177 / `getBestDpiPath()` :346 / `isDpiComplete()` :201 | DPI 目录语义 | PDF 轨下返回空；`isDpiComplete` 增加 `hasPdf()` 判断 |
| `routes/admin.ts` | :599 跳过判断、:753 拷贝 PDF、:761 渲染、:786-794 写 storagePath | 渲染为主，拷贝为辅 | PDF 轨：只做「拷贝 + pdfinfo + extractOutline + 写库」，进度按文件数而非页数 |
| `routes/books.ts` | :312-324 | 返回 `storagePath`(DPI 目录) / `availableDpis` / `pdfUrl` | 增加 `sourceType: 'image' \| 'pdf'`；PDF 轨返回 PDF 直链 + 页面尺寸表 |
| 同上 | :194-201 列表接口 | 逐本 `getAvailableDpisAsync` 读磁盘 | PDF 轨省掉这次 IO（顺带提速列表） |
| `routes/assignments.ts` | :327-329 导出 | 服务端拼 `pageImage` | 前端自行渲染，服务端只回笔迹 |
| `routes/adminBooks.ts` | :58-59 DPI 列 | 展示 DPI 列表 | PDF 轨显示「PDF」标识 |
| `services/storage.ts` | `hasBookAssets()` :73 | 已同时认 PDF 与数字目录 | 无需改 |
| **新增** | — | — | 封面/缩略图生成与缓存服务；`GET /api/books/:id/page-sizes`（可选） |

### 4.2 前端

| 文件 | 位置 | 改造 |
|---|---|---|
| `api/client.ts` | `pageImageUrl()` :773 / `getBookCoverUrl()` :778 | 抽象成 `PageSource`，按 `sourceType` 分派 |
| `components/PageCanvas.tsx` | `src` :40、`img.complete` :51、`canvas.width = img.clientWidth` :56 | **核心改动点**：底层从 `<img>` 换成渲染画布 |
| `components/CropTool.tsx` | `src` :25、`drawImage` :30-41 | 换成高 scale 渲染结果 |
| `components/AssignmentMode.tsx` | `imgNatural` :344-347、导出 :601-624、底图 :820 | 同上三处 |
| `components/TocTree.tsx` | `pageUrl()` :36-37 | 缩略图改为懒渲染或走服务端缩略图 |
| `pages/BookViewer.tsx` | `effectiveStoragePath` :393-397、`imgNatural` :404-410、渲染区 :1190-1237 | 把「DPI 下拉」换成「渲染清晰度」或直接去掉；`imgNatural` 来源换成 viewport |
| `pages/Home.tsx` / `BookCover.tsx` / `admin/BooksTable.tsx` | 封面 | 若服务端出缩略图，则几乎不用改 |
| `components/admin/PdfScanImport.tsx` | DPI 参数 | PDF 轨下隐藏 DPI 选项 |
| **新增** | — | `client/src/pdf/`（worker、文档加载器、页面渲染器、缓存）、`client/src/lib/pageSource.ts` 抽象层 |

### 4.3 数据模型

`Book` 表建议只加一个字段：

```prisma
/// 页面数据源：image = 预渲染 PNG；pdf = 原始 PDF 直读
sourceType  String  @default("image") @db.VarChar(8)
```

`storagePath` 语义扩展：image 轨 = `/storage/books/{id}/`，pdf 轨 = `/storage/books/{id}/{file}.pdf`。
`availableDpis` 在 pdf 轨下返回空数组，前端据此隐藏 DPI 下拉。
**批注 / 笔迹 / 错题 / TOC / 阅读进度表全部不动。**

---

## 5. 双轨架构：抽象层放哪一层，决定了改造量

三种选法，越往下改动越大、上限越高：

### 方案 A — 位图契约（最小改动）
```
PageSource.getPageBitmap(page, scale) → { url, width, height }
```
PDF 轨内部用 pdf.js 渲染成离屏 canvas → `toBlob()` → 交给现有 `<img>`。
- ✅ `PageCanvas` / `CropTool` / `AssignmentMode` / `TocTree` / `BookCover` **业务逻辑一行不改**
- ✅ 改造集中在新增文件，风险可控，可灰度、可回滚
- ❌ 失去矢量清晰度（放大后要按新 scale 重渲染，等于「按需 DPI」）
- ❌ 每页首次渲染有延迟，需要预取前后页 + 缓存

### 方案 B — 画布契约（推荐终态）
```
PageSource.renderPage(page, canvas, scale) → { width, height }
```
组件直接拿 canvas，缩放变化时重渲染而非拉伸位图。
- ✅ 矢量清晰、可加文本层、内存可控
- ❌ `PageCanvas` 要拆成「底图画布 + 批注画布」双层，`CropTool` 需自绘裁剪框（或仍走 A 的位图兜底）

### 方案 C — 全量重写阅读器
直接做成 pdf.js 完整阅读器（文本层、搜索、缩略图虚拟化）。
- 收益最大，但回归风险与工期都最大，不建议一步到位。

**建议路径：A 起步 → 稳定后主视图升级到 B → C 作为长期选项。**
A 和 B 可以共存：阅读器主视图走 B，裁剪/导出/缩略图走 A 的位图兜底。

---

## 6. 服务端必须新增的能力

1. **封面缩略图服务**：首页一屏 16 本，若让前端各自下载 PDF 再渲染首页，流量与延迟都不可接受。服务端按需生成 `books/{id}/cover.jpg`（约 50KB）并缓存，总计约 300MB —— 前端 `BookCover` 组件几乎不用改。
2. **页面缩略图**：`TocTree` 的缩略图 tab 会一次面对几十~几百页。两条路：服务端生成 `thumbs/page-xxxx.jpg`（100px 宽，约 5KB/页，500 页 ≈ 2.5MB），或前端懒渲染 + IntersectionObserver。前者更稳，后者更省服务端。
3. **Range 请求**：`/storage` 走 `express.static`，本身支持 Range，pdf.js 可流式加载（189MB 的大书尤其受益）。需确认 `compression` 中间件不会干扰 Range 响应。
4. **按需生成的并发控制**：首次访问会触发渲染，要有一个渲染队列避免打满 CPU。

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 缩放后模糊（用户感知最强） | 体验倒退 | zoom 变化 debounce ~150ms 后按新 scale 重渲染；渲染中保留上一帧 |
| 首页 / 缩略图变慢 | 列表卡顿 | 服务端预生成缩略图；前端 LRU 缓存 + 预取前后 1~2 页 |
| iPad canvas 面积上限（约 16.7M 像素） | 大页渲染失败 | 按容器尺寸算 scale，限制像素上限；必要时分块渲染 |
| 裁剪错题画质下降 | 错题图变糊 | 裁剪用 scale ≈ 300/72 ≈ 4.2 的高清渲染，只渲染裁剪区域 |
| 大 PDF 内存 | 189MB 那本 | `disableAutoFetch` + Range 分块；切书时 `doc.destroy()` |
| pdfjs-dist 进客户端包 | 包体增大 | 动态 `import()` 懒加载，只在进入阅读器时加载；worker 用 Vite `?url` |
| 双轨长期维护成本 | 代码分叉 | 统一走 `PageSource` 接口，业务组件只认接口不认实现 |
| 169 本无 PDF 原件的书 | 无法切轨 | 留在 image 轨；后续重扫时补 PDF 再切 |

---

## 8. 建议的落地顺序

1. **阶段 0（不改功能）**：加 `Book.sourceType` 字段 + 服务端返回；前端引入 `PageSource` 接口，image 实现包一层现有逻辑，跑通全量回归。
2. **阶段 1（方案 A）**：`client/src/pdf/` 渲染器 + worker；`PageCanvas` / `CropTool` / `AssignmentMode` 改走位图契约；服务端封面 + 缩略图服务。此时已可省磁盘、导入加速。
3. **阶段 2（灰度）**：服务端提供「按书切换数据源」的管理入口，先切一批书验证老批注坐标无偏移。
4. **阶段 3（方案 B）**：阅读器主视图换 canvas 契约，做到矢量清晰；可选开启文本层与搜索。
5. **阶段 4（清理，可选）**：确认无异常后，批量删除 PNG 目录，回收 73GB。

---

## 9. 待决策

1. 抽象层级选 A / B / 直接 C？
2. 缩略图与封面：服务端预生成缓存，还是前端懒渲染？
3. 是否要顺带做文本层与全文搜索（PDF 独占红利，但也带来坐标语义的复杂度）？
4. 老书是否要批量切换到 PDF 轨（先切一小批灰度，还是一次性全切）？
