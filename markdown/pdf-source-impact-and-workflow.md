# PDF 数据源：影响面复评、未来场景与导入流程建议

> 第二轮评估（2026-09-24）。技术底稿见 `pdf-source-evaluation.md`，本文聚焦三个新问题：
> 更新代码后影响面是否变化、未来场景是否受影响、操作流程应该怎么设计。

---

## 1. 代码更新后：影响面没有变化

从上一轮评估提交（`062502c`）到 `HEAD` 共 12 个提交、**26 个文件、+1778/-308**：

| 类别 | 文件 | 与 PDF 数据源的关系 |
|---|---|---|
| shadcn 组件引入 | `ui/sidebar.tsx`(771) `ui/sheet.tsx` `ui/alert-dialog.tsx` `ui/skeleton.tsx` `ui/tooltip.tsx` `hooks/use-mobile.tsx` | 无关 |
| 管理台 UI 重构 | `AdminLayout.tsx` `BooksTable.tsx` `BookPairs.tsx` `DbBackup.tsx` `StorageSettings.tsx` `UsersTable.tsx` `AssignmentsTable.tsx` `VideoMatchReview.tsx` | 无关（Dialog / Button / 暗色 token 替换） |
| 阅读器相关（轻微） | `CropTool.tsx`(6 行) `TocTree.tsx`(2 行) `Home.tsx`(8 行) `PdfScanImport.tsx`(76 行) | **仅样式与 Dialog 替换，数据流未变** |
| 部署 | `deploy/Caddyfile` | 相关（见 §3.3） |
| 服务端 | **0 个文件** | — |

**结论：上一轮的技术结论与改造点清单全部有效，无需修订。** `pdfProcessor.ts` / `books.ts` / `admin.ts` / `assignments.ts` 一行未动。

---

## 2. 新增实测数据（改变了风险判断）

| 指标 | 数值 | 含义 |
|---|---|---|
| 数据库书籍 | **14665 本** | — |
| storage 目录 | 5830 个，**全部能在 DB 命中** | — |
| **有记录但无文件** | **8835 本（60%）** | 换盘 / 多 storage 是真实痛点 |
| 批注 / 错题 / 笔迹 | **6 条 / 2 条 / 1578 条** | 用户数据极少，坐标迁移风险很低 |
| 分类数 | 247 个（29 个 ≥100 本，26 个 ≤2 本） | 分类大体可用，有长尾 |
| 学期污染 | 234 本 grade = `20260908190618` | 历史遗留（代码已修，数据待洗） |
| crops 目录 | 空 | 错题裁剪几乎未使用 |

### 元数据质量实证（决定流程设计）

```
category=朱涛老师 的样例书名：  "10"   "10练习"   "11--整除上"
category=单元测试卷 的样例书名："第1单元史前时期：（单元测试）（原卷版）"
```

课程讲义类（文件名是讲次号）**靠路径解析救不了**，必须人工或规则补；
试卷类（文件名自带结构）解析质量很好。
这直接支持「导入前需要一次可见、可改的校正环节」。

---

## 3. 对现有功能的影响（逐项结论）

### 3.1 完全不受影响（无需改动）

| 功能 | 原因 |
|---|---|
| 批注 / 便签 / 高亮 | `pageNumber` + 归一化 0-1 坐标，与渲染方式无关 |
| 作业笔迹（1578 条） | 同上，`points` 已是归一化 |
| 错题裁剪 | crop 仍是前端生成图片，存 `crops/{bookId}/`，与底图无关 |
| 目录 TOC、视频关联、教材答案配对 | 元数据层面，与图片无关 |
| 阅读进度、收藏、DB 备份 | 与图片无关（备份只含 DB） |
| 删除书籍、软删除归档 | 按 `books/{id}` 整体删除，PDF 同样命中 |

### 3.2 需要适配（功能等价，代码要动）

| 位置 | 现状 | 适配 |
|---|---|---|
| `admin.ts:599` `isDpiComplete()` | 用作「是否已导入」判断 | PDF 轨必须换成 PDF 存在性判断，否则每次扫描都重复处理 |
| `admin.ts:761` `renderPages()` | 导入主耗时 | PDF 轨跳过 |
| `assignments.ts:327` | 服务端拼 PNG 路径给前端合成 | 前端自行渲染，服务端只回笔迹 |
| `books.ts:194` 列表 | 每本 `getAvailableDpisAsync` 读一次磁盘 | PDF 轨省掉 → **列表反而更快** |
| `pdfProcessor.getBestDpiPath()` | 决定 `storagePath` | PDF 轨直接指向 PDF 文件 |
| 前端 5 处 `pageImageUrl` / `getBookCoverUrl` | 拼 PNG URL | 走 `PageSource` 抽象分派 |

### 3.3 上一轮未识别的新影响点

1. **CORS 约束**：`deploy/Caddyfile` 已经把 `/data`、`/lt` 代理到远程资源服务器（`182.92.129.222`）。
   若将来 PDF 也托管到远程，前端 pdf.js 用 `fetch` 取 PDF 会受同源策略限制，**必须配 CORS 头**（或经 `/storage` 代理）。这是引入 PDF 后唯一全新的外部约束。
2. **hasBookAssets 反而更稳**：`storage.ts:73` 同时认 `.pdf` 与数字目录，PDF 轨天然满足；切换 storage root 时匹配率比现在更高。
3. **孤儿书问题可顺带解决**：8835 本有记录无文件的书，说明拷贝式存储在换盘时很痛。PDF 轨建议改用引用式（见 §4.1）。

---

## 4. 未来场景：用 PDF 之后会不会有影响

### 4.1 换硬盘 / 移动资料 —— 明显更好（但取决于存储方式）

项目里**已经有成熟范式**：`BookVideo` 不复制文件，只存 `filePath + rootPath + relPath + missing`，换盘时调 `POST /admin/videos/repoint` 整体替换根目录（`adminVideos.ts:59-118`）。

建议 PDF 轨照抄这套：

```
Book:  pdfPath / pdfRoot / pdfRelPath / pdfMissing
```

- ✅ 重插硬盘即恢复，不用重拷 82G（甚至 9.6G）
- ✅ 与视频范式一致，心智与代码复用
- ⚠️ 代价：PDF 不在 storage 内，需服务端代理读取（`/storage` 之外新增 `/pdf/{id}` 直读，顺带解决鉴权与 CORS）

### 4.2 团队部署 / 多机（AUTH_ENABLED=true）—— 更好

需同步的数据从 82.6G 降到 9.6G；远程访问时按需渲染，流量也更低。

### 4.3 全文搜索 / 题目检索 / AI 批改 —— 只有 PDF 才有可能

图片模式永远拿不到文本层。这是最大的长期收益，也是「将来一定会后悔没做」的那一项。

### 4.4 iPad / 移动端 —— 更好，但有上限

按需渲染比加载整张 300 DPI 大图省内存；需控制 canvas 面积（iOS Safari 约 16.7M 像素上限）。

### 4.5 导出与分享 —— 更好

可以直接导出原 PDF；未来可导出「带批注的 PDF」。现在只能导出 JPG。

### 4.6 会变差的（必须提前处理）

| 场景 | 影响 | 对策 |
|---|---|---|
| 弱网首屏 | 需先下载 PDF 才能渲染 | 封面/缩略图走服务端缓存；PDF 用 Range 流式 |
| 大文件 | 189MB 那本 | `disableAutoFetch` + Range 分块 + 切书 `destroy()` |
| 服务端 CPU | 从「导入时一次性」转为「访问时按需」 | 缩略图生成队列 + 缓存 |
| 缩略图 tab | 几百页同时渲染会卡 | 服务端预生成 或 前端虚拟化懒渲染 |

---

## 5. 操作流程：建议「扫描 → 校正 → 关联」，而不是「先建目录再导入」

### 5.1 你的判断方向是对的，但顺序建议调整

- **不建议**把 category 预置成硬编码目录树：247 个分类里主流是「期末专项 / 期中专项 / 单元测试卷 / 同步讲义」这类**资料类型**，真正的层级是 `grade × subject × category` 三维组合 —— 现在的数据模型正是这么存的，不要把它拍平成树。
- **建议**把 category 收敛成可管理字典（照 `GRADE_PRESETS` / `SUBJECT_PRESETS` 的现成做法），导入时自动匹配 + 人工确认。247 个里 26 个长尾需要合并清理。

### 5.2 PDF 模式才让这个流程第一次真正可用

现在的流程是「解析 → 直接渲染入库」，一次导入十几小时，所以不敢反复试。
去掉渲染后，扫描变成分钟级，**「扫一遍看看解析对不对，改完再提交」才第一次具备可操作性**。

建议三步：

1. **扫描（dry-run）**：只做 `pdfinfo` + 路径解析 + hash，产出待入库清单，**不写库、不拷贝**。
2. **校正**：预览表格里批量改 category / grade / subject / title。
   - 现状基础已有：`previewScanPdf()` + `showConfirm` + 复制为 TSV（`PdfScanImport.tsx:205-253`）
   - 缺的只有「表格内联编辑 + 批量改」这层 UI
3. **提交关联**：确认后才写库 + 记录 PDF 来源（引用式）。

### 5.3 顺带的数据清洗

`grade = 20260908190618` 的 234 本书（category 多为「朱涛老师」，书名是「10」「10练习」）是历史污染，
代码已修（`admin.ts:501` 改为留空），但数据需要一次性清洗 —— 正好放在第 2 步的校正环节做。

---

## 6. 代码大盘点结论

### 不用动（约占九成）
```
server:  storage.ts / bookIndex.ts / videoMatcher.ts / annotations.ts(除107行)
         mistakes.ts / readingProgress.ts / auth 系列 / dbBackup 系列
client:  DrawingCanvas.tsx / AssignmentList.tsx / AnnotationList
         VideoListPanel.tsx / BookPairs.tsx / 全部 admin 表格（除封面列）
数据:    Annotation / AssignmentStroke / Mistake / ReadingProgress / Book.tocJson
```

### 要改（约 10 处，都在「页面位图产出」这一层）
```
server:  admin.ts:599/753/761/786     books.ts:312-324     assignments.ts:327
         adminBooks.ts:58             pdfProcessor.ts:112/177/201/346（保留，加分支）
client:  api/client.ts:773/778        PageCanvas.tsx:40/51/56
         CropTool.tsx:25/30           AssignmentMode.tsx:344/601/820
         TocTree.tsx:36               BookViewer.tsx:393-410/1190-1237
```

### 新增
```
server:  封面/页面缩略图生成与缓存   PDF 直读路由（含鉴权）   repoint 接口
client:  src/pdf/（worker / 加载器 / 渲染器 / 缓存）   src/lib/pageSource.ts
DB:      Book.sourceType  +  引用式四件套（pdfPath/pdfRoot/pdfRelPath/pdfMissing）
```

---

## 7. 建议的下一步（供讨论）

1. **先定存储方式**：引用式（照抄 BookVideo）还是继续拷贝进 storage？
   我倾向**引用式** —— 60% 的孤儿书就是拷贝式的代价，且能顺带解决 CORS 与鉴权。
2. **先做流程改造还是先做渲染改造？**
   我倾向**先做流程**（dry-run + 校正 UI），因为它不依赖 pdf.js，改动独立，且能让 14665 本书的元数据先变干净；渲染改造可以并行。
3. **老书切换策略**：先切 100 本灰度（验证坐标无偏移），再批量。
4. **是否做文本层**：建议放到渲染改造稳定之后，作为第二阶段。
