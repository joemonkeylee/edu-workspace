# books 模块清理与还原记录（2026-10-01）

## 当前状态

| 项 | 数量 |
|---|---|
| 清理前 | 14665 本 |
| **当前可见** | **169 本** |
| 软删（可回滚） | 14496 本 |
| 物理删除 | 0 本（尚未执行） |

- 库：`edu_workspace`（182.92.129.222:16240），`book` 表
- 存储：真实根为 `/Volumes/WD10JPVT-75/storage`（由 `appsetting.storageRoot` 指定，**不是** `server/.env` 里的 `./storage`）
  - `storage/books/` → 169 个目录
  - `storage/books-deleted/` → 14496 个目录（同盘 rename，不占额外空间，可回滚）
- 作业 19 份、笔迹 7148 条**一行未删**

可见的 169 本 = 作业所在的 2 本（14638 / 14639）+ 还原的「2025必刷题」整类（36 本）
+ 还原的「教材」整类（133 本）。

| 分类 | 本数 |
|---|---|
| 教材电子版 | 70 |
| 电子教材 | 39 |
| 2025必刷题 | 36 |
| 电子版教材 | 11 |
| 教材＋笔记 | 5 |
| 笔记＋教材 | 4 |
| 新版教材 | 3 |
| 教材电子版、 | 1 |


## 口径变更时间线

| 阶段 | 口径 | 保留 | 说明 |
|---|---|---|---|
| 第一次 | `title/category 含「必刷题」` ∪ `category 含「教材」` ∪ `id=14630` | 225 | 用户先说「除必刷题和教材外全删」 |
| **第二次** | **以 `assignment` 表反推**：作业挂在哪本书就只留哪本 | 2 | 用户要求「按照作业反推，应该剩下 2 本书」 |
| **第三次** | 在第二次基础上**还原 `category='2025必刷题'` 整个分类** | 36 | 用户要求「把这个分类下的图书都找回来，包括关联的答案」 |
| **第四次（当前）** | 再**还原 `category LIKE '%教材%'` 全部 7 个分类**（133 本） | **169** | 用户要求「教材看看有多少需要找回来的，确认后再找回来」 |

四轮都是软删 / 还原（同盘 rename）。第一、二次软删的 14440 + 223 本中已有 34 + 133 本被还原，
**其余 14496 本仍在 `books-deleted/`，随时可还原**。

## 最终保留口径

```sql
-- scripts/books-bulk-delete.mjs --keep=assignments
SELECT DISTINCT bookId FROM assignment;   -- → {14638, 14639}
```

脚本内置安全阀：`assignment` 为空时**直接中断**，绝不在保留集合为空的情况下执行（否则会清空全库）。

## 关于第 3 本书 14630

第一次审计时作业分布在 **3 本**书上，其中 `14630`（初二数学培训班学习用书-春下-全国版S-讲义1-正文，
`category=朱涛数学2026`, `kind=course`）挂着 1 份 draft 作业，当时按用户选择一并保留。

**第二次核对时该作业已不存在**：`assignment` 表从 20 行变为 19 行，`14630` 不再出现在任何作业的 `bookId` 中。
本次清理只操作过 `book` 表与 storage，未触碰 `assignment` —— 应为期间在前端被删除。
因此按「作业反推」得到的就是 2 本。

`14630` 及其所属的 194 本朱涛数学2026 课程书，现已一并软删（在 `books-deleted/`）。

## 前台「一书不可见」与视图兜底

首页「教辅」二级菜单有三个视图，`client/src/store/homeFilters.ts` 的 `loadResourceKind()`
**默认返回 `'course'`（视频课程）**，且会持久化到 localStorage。

课程类清空后（`kind='course'` 可见数为 0），首页若记忆停在该 Tab，打开就是空白页。
已在 `client/src/pages/Home.tsx` 加入兜底：

> 当前视图计数为 0、且其它视图有内容时，自动切到「全部书籍」。
> 同一次会话只自动切一次；计数尚未加载（全为 0）时不判断，避免误切。

三个视图与接口实测（教材还原后）：

| 视图 | 服务端查询 | 当前可见 | 说明 |
|---|---|---|---|
| 视频课程 | `kind=course` | 0 | 课程类仍全部软删；兜底会把它切走 |
| 必刷题 | `kind=exercise` | 14 | 36 本里 22 本答案册被折叠 |
| 全部书籍 | 无 kind 过滤 | 147 | 169 − 22 本折叠的答案册 |

`kindCounts` = `{ book: 133, exercise: 36, course: 0 }`（全局计数，不受当前筛选影响）。

## 2025必刷题 分类还原（用户后续要求）

用户要求「把 2025必刷题 分类下的图书都找回来，包括关联的答案」：

```bash
node scripts/books-bulk-delete.mjs --mode=restore --category=2025必刷题 --yes
```

- `category='2025必刷题'` 共 **36 本 = 12 正册 + 24 答案册**（每本正册配「狂K重点」+「批注式详答与详析」）
- 还原其中已软删的 **34 本**（剩余 2 本 14638/14639 本就在）
- 结果：可见 36 / 软删 14629 / `books/` 36 个目录 / `books-deleted/` 14629 个目录
- 校验：`node scripts/books-verify.mjs --also-keep=2025必刷题`

### 配对关系是单向的

答案册声明 `{role:'answer', with:<正册id>}`；正册只自指 `{role:'textbook', with:<自己id>}`。
所以「某本正册有哪些答案」需要**反查答案册**，不能只看正册的 `pairs`。
全库反查确认：**没有分类外的书**配对这些正册 —— 还原这一个分类即为完整集合。

### ⚠️ 数据缺口：9下英语的 2 本答案册没有配对记录

| 书 ID | 标题 | 问题 |
|---|---|---|
| 14665 | 初中必刷题-9下-英语人教版狂K重点 | `pairs` 为空 |
| 14668 | 初中必刷题-9下-英语人教版批注式详答与详析 | `pairs` 为空 |
| 14666 | 初中必刷题-9下-英语人教版（正册） | 因此没有答案入口 |

其余 11 本正册都正常配对 2 本答案册。这两本因为「没声明自己是答案」，
不会被 `answerSideIds` 排除，会**作为独立卡片出现在列表里**
—— 这正是「必刷题」视图显示 **14 本（12 正册 + 这 2 本）** 而非 12 本的原因。

补齐方式（既有接口）：`POST /api/admin/book-pairs/bind-batch`，绑定后视图会变成 12 本。
该缺口并非本次清理造成（`boundAt` 显示 2026-09-13 入库时即如此）。

### 列表层为何 36 → 14

`/api/books` 的 `notIn: index.answerSideIds` 会把 22 本答案册**折叠到正册下**：
列表里每本正册带 `pairSummary.partners`，指向它的 2 本答案册。
`GET /api/admin/books` 仍是全量 36。三视图实测：视频课程 0 / 必刷题 14 / 全部书籍 14。

## 教材 分类还原（用户后续要求）

用户要求「教材 看看有多少需要找回来的，确认一下再找回来」。先审计再确认口径，然后还原：

```bash
# 审计：133 本全部处于软删状态，目录 133/133 在 books-deleted，零缺失
node scripts/books-bulk-delete.mjs --mode=restore --category-like=教材 --dry-run
# 执行
node scripts/books-bulk-delete.mjs --mode=restore --category-like=教材 --yes
```

- 口径：`category LIKE '%教材%'`，**133 本跨 7 个分类**
  （教材电子版 70 / 电子教材 39 / 电子版教材 11 / 教材＋笔记 5 / 笔记＋教材 4 / 新版教材 3 / `教材电子版、` 1）
- 注意 `教材电子版、`（id 6535）是**脏数据**——分类名尾部多一个顿号，实际属于「教材电子版」
- 还原 133 本，零失败；结果：可见 169 / 软删 14496 / `books/` 169 个目录 / `books-deleted/` 14496 个目录
- 校验：`node scripts/books-verify.mjs --also-keep=2025必刷题 --also-keep-like=教材`（22 项全绿）

### 教材没有配对关系

审计发现：133 本教材**自带 `pairs` 全部为空**，且**反查全库也没有任何分类外的书配对到教材**。
即教材与其配套的课堂笔记/单词表是同分类下的独立条目，不存在「答案册」折叠关系。
（教材类里个别标题带 `（解析版）` 的书会被 `answerSideIds` 单独判定，属既有规则。）

### 未被还原的相邻集合

「**标题**含教材、但分类是期末专项/考点精炼等」另有 **58 本**（期末专项 26 / 考点精炼 12 / 期中专项 6 /
小红书抖音 3 / 小纸条汇总 3 / 知识点归纳 2 / 知识点总结 2 / 其余 4），属《教材全解》类配套教辅，
用户确认**不带回**。如需还原：

```bash
node scripts/books-bulk-delete.mjs --mode=restore --ids=<id列表> --yes
```

## 回滚

```bash
# 单本 / 多本
node scripts/books-bulk-delete.mjs --mode=restore --ids=23,14630 --yes
# 按精确分类
node scripts/books-bulk-delete.mjs --mode=restore --category=2025必刷题 --yes
# 按分类子串（覆盖其全部变体）
node scripts/books-bulk-delete.mjs --mode=restore --category-like=教材 --yes
# 全部还原（14496 本）
node scripts/books-bulk-delete.mjs --mode=restore --ids=all --yes
```

也可用接口：`POST /api/admin/books/:id/restore`、`POST /api/admin/books/restore-batch`（body `{ "ids": [...] }`）。

## 后续：物理清除以释放空间

外置盘 `/Volumes/WD10JPVT-75` 已用 928G / 剩余 3.7G，**软删不释放任何空间**，需物理清除：

```
node scripts/books-bulk-delete.mjs --mode=purge --yes
```

会删除 `books-deleted/{id}`、`crops/{id}`，并 `DELETE FROM book`（外键 CASCADE 清理关联表）。
**不可逆**，执行前先确认 `node scripts/books-verify.mjs` 全绿。

## 相关文件

| 路径 | 说明 |
|---|---|
| `scripts/books-bulk-delete.mjs` | `--mode=soft\|purge\|restore`，`--keep=legacy\|assignments`，restore 支持 `--ids=<列表\|all>` / `--category=<精确名>` / `--category-like=<子串>`，另有 `--dry-run --limit=N --no-backup --yes` |
| `scripts/books-verify.mjs` | 一致性断言（期望值按 `--keep` 口径动态推导），`--keep=legacy\|assignments`，`--also-keep=<精确分类>` / `--also-keep-like=<子串>` |
| `/Volumes/WD10JPVT-75/storage/db-backups/books-delete-backup-2026-10-01T12-18-27-314Z.json` | 第一次 14440 本的快照（15.1 MB） |
| `/Volumes/WD10JPVT-75/storage/db-backups/books-delete-backup-2026-10-01T12-35-41-026Z.json` | 第二次 223 本的快照（0.8 MB） |

> 注：视频 mp4 本体在 `~/Downloads/朱涛数学2026/`，**不在 storage 内**，删书不会影响这些文件。
