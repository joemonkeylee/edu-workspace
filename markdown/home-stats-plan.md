# 首页底部：可统计项盘点 + 打卡进度墙规划

> 目标：把首页下方那块空白做成「个人工作台」。
> 已完成（P1）：左侧「我的提交」（草稿 / 已打回 / 已提交 / 已批改 全在一处，点击直达作业），右侧「学习概览」计数。
> 本文解决第二件事：**现在库里到底能统计什么、怎么算才准、进度墙怎么排**。

---

## 一、本次改动（2026-09-25）

| 位置 | 改动 |
| --- | --- |
| `server/src/routes/assignments.ts` | 新增 `GET /assignments/mine` —— 跨书作业列表 + 各状态计数；保存笔迹时同步 `updatedAt` |
| `client/src/api/client.ts` | 新增 `getMyAssignments(limit)` |
| `client/src/components/MyWorkspace.tsx` | 新增底部工作区组件（左：我的提交；右：学习概览 + 进度墙预留位） |
| `client/src/pages/Home.tsx` | main 改成 flex 纵向布局：筛选条（固定）/ 列表（独立滚动）/ 分页（固定）/ 工作区（固定） |

要点：
- **只占底部一部分**：左 2 列给「我的提交」，右 1 列给统计，列表区仍是主视觉。
- **跳转**：`window.open('/book/{bookId}?assignmentId={id}')`，BookViewer 已有 `assignmentId` 深链逻辑（拉取作业 → 进入作业模式 → 跳到第一页有笔迹的页）；`graded` 自动只读，`submitted` 且当前用户是教师/管理员时追加 `grading=1` 打开批改层。
- **空壳草稿不展示**：一条笔迹都没有的 draft 不进列表（开了作业模式又直接退出产生的空记录）。
- `updatedAt` 现在语义明确 = **最后一次动手时间**（保存笔迹时也会更新），排序用它才不会把还在画的草稿沉到底。

---

## 二、库里现在能统计什么（逐表盘点）

| 表 | 时间字段 | 能得出的指标 | 口径陷阱 |
| --- | --- | --- | --- |
| `Assignment` | `createdAt` / `updatedAt` / `gradedAt` + `status` | 作业创建数、提交数、批改数（按天）；状态分布 | **没有 `submittedAt`**。目前"提交时间"≈ `updatedAt`，一旦后续改标题就会被覆盖。批改时间有 `gradedAt`，是准的 |
| `AssignmentStroke` | `createdAt` | 作答活跃度：当天在几份作业上动过笔 | 保存是**整页 delete + create**（自动保存 1.5s 一次），笔数会被反复放大 → 只能按「作业去重」计数，不能按笔数 |
| `Annotation` | `createdAt` | 批注条数 / 天，批注活跃天 | 无 updatedAt，删除后不留痕（只能统计"存量快照"） |
| `Mistake` | `createdAt` + `reviewStatus` | 错题条数 / 天，待复习 vs 已复习 | `reviewStatus` 变化**没有时间戳**，复习完成率只能算当前快照 |
| `ReadingProgress` | `updatedAt` + `pageNumber` | 阅读活跃天 | `@@unique([userId, bookId])`，只存**最新页码**，没有历史 → **算不出"今天读了几页"**，只能算"这天碰了这本书" |
| `VideoProgress` | `lastViewedAt` / `completedAt` / `watched` / `completed` | 看完讲数、手动完成数、观看活跃天 | `lastViewedAt` 每次播放都会覆盖，只代表"最近一次"，但作为"当天是否看过"够用 |
| `BookFavorite` | `createdAt` | 收藏数 / 天 | 取消收藏即删除记录，只能统计净增量 |
| `Book` / `BookVideo` | 静态 | 分母：总页数、总讲数（库里 786 条视频关联 ≈ 316 个视频） | 不是用户行为，只能做"完成度"的分母 |
| `Pdf*` 系列（pdf-assignment / pdf-annotation / pdf-mistake / pdf-reading-progress） | 同上 | 与上面一一对应 | **独立的并行模块**。统计口径不合并的话，走 `/pdf` 路由做的作业一篇都进不了热力图 |

**关键结论：目前没有独立的「打卡」数据源。**
想要的"每天打卡次数"只能是**派生指标**——由上述行为表聚合出"活跃天"，而不是读一张签到表。

---

## 三、指标口径建议

```
活跃天 = 当天命中任意一条：
  ① AssignmentStroke 有新记录（去重到 assignmentId）
  ② Assignment 状态发生变化（提交 / 批改）
  ③ Annotation 或 Mistake 新增
  ④ VideoProgress.lastViewedAt 落在当天
  ⑤ ReadingProgress.updatedAt 落在当天

GitHub 色阶（按当天行为条数 value 分档）：
  value = 0 → L0；1 → L1；2~4 → L2；5~9 → L3；10+ → L4

派生数字：
  连续天数 streak（今天或昨天起算，否则算 0）
  最长连续 longestStreak
  本周 / 本月 / 累计活跃天数
  作业提交数（按天，status ≠ draft 的那次状态变更）
  批改数（gradedAt 落在该天，口径本身就准）
```

作业上传数量 = **提交动作**按天计数（不是创建数）。若坚持要"创建数"，用 `createdAt`；两者差别很大：创建往往是同一次点击进入画布，**提交才是真实产出**。建议默认显示提交数。

---

## 四、接口设计（P2）

```
GET /api/stats/activity?days=119
→ {
    days: [{ date: '2026-09-25', strokes: 3, submits: 1, gradeds: 0,
             annotations: 2, mistakes: 1, video: 1, reading: 1, total: 9, level: 3 }],
    summary: { streak, longestStreak, thisWeek, thisMonth, activeDays, totalSubmits, totalGraded }
  }
```

实现要点：
1. **权限**：始终按 `userId` 过滤，跟 `/assignments/mine` 一个口径；管理员看别人走 `/admin` 单独视图，不在这里混。
2. **取数**：每张表一次 `$queryRaw` 按 `DATE(createdAt)` 分组，再在 Node 里按日期 merge。
   - MySQL 的 `DATE()` 走的是会话时区，和服务器本地时区要对齐，否则晚上 8 点后的记录会落到第二天 —— 建议直接 `DATE(CONVERT_TZ(col, '+00:00', '+08:00'))`，或干脆在 Node 侧用 `toLocaleDateString('sv')` 分桶，先把数据拉回来再说（数据量小）。
3. **合并 PDF 模块**：`Assignment` 和 `PdfAssignment`、`Annotation` 和 `PdfAnnotation` 都要查；两类 bookId **不在同一个空间**，所以各行各的查询、结果按日期相加即可，不要尝试 JOIN。
4. **性能**：现在 `AssignmentStroke` 只有 `@@index([assignmentId])`，按时间扫全表会随数据量变慢 —— 见下一节的 P3。
5. **缓存**：`/books` 有一套内存索引的做法可参考；热力图可以做成 5 分钟 TTL，不必每次请求都算。

---

## 五、为了让口径干净，建议补的东西（按性价比排序）

| 优先级 | 改动 | 解决什么 |
| --- | --- | --- |
| 高 | `Assignment.submittedAt DateTime?`（`PdfAssignment` 同步） | "提交数 / 提交日期"现在是猜的。加字段后 `prisma db push` 即可，**不丢数据、不改语义**，历史数据用 `updatedAt` 回填一次 |
| 高 | `AssignmentStroke` 加 `@@index([createdAt])` | 热力图要按时间范围扫这张表，现在只能全表走 assignmentId |
| 中 | 新增 `DailyActivity` 汇总表：`(userId, date)` 唯一 + 各分项计数，写入时 upsert（或每天首次进入时结算） | 热力图从"每次扫 5 张表"变成"读 ~120 行"，是长期可扩展的唯一路子 |
| 中 | `Mistake` 加 `reviewedAt` | 复习完成率目前只能看快照，出不了"今天复习了几条错题" |
| 低 | 独立的 `CheckIn` 签到表（显式打卡按钮） | 如果"打卡"要的是**主动签到**而不是行为派生，这是唯一真实来源；否则不用做 |

---

## 六、UI 落位

```
┌──────────────────────────────────────┬────────────────────┐
│ 我的提交  [全部 草稿 已打回 已提交 已批改] │ 学习概览            │
│ 缩略图 作业标题 状态 书名 页数 时间  操作  │ 草稿 3  待批改 2     │
│ ...（188px 内部滚动）                  │ 已批改 8  已打回 1    │
│                                      ├────────────────────┤
│                                      │ 连续 5 天 · 本周 4 天│
│                                      │ ▪▪▫▫▪▪▪ 53×7 热力图 │
│                                      │ 切换：全部/提交/视频  │
└──────────────────────────────────────┴────────────────────┘
```

- 热力图 53 列 × 7 行，hover tooltip 显示当天分项（笔迹 3 / 提交 1 / 标注 2…）。
- 顶部三个数字：连续天数、本周活跃天、本月提交数。
- 窄屏（`< lg`）改为上下堆叠，热力图可横向滚动或折叠成一行摘要。
- 现在的右列下半就是预留位，`/stats/activity` 落地后直接替换。

---

## 七、排期

- **P1（已完成）**：我的提交 + 状态计数 —— 入口和数据链路打通。
- **P2**：`/stats/activity` + GitHub 风格热力墙（只读展示，不动 schema）。
- **P3**：补 `submittedAt` / `stroke.createdAt` 索引 / `DailyActivity` 汇总表，PDF 模块并入同一口径。
- **P4**：目标与提醒（今日还没打卡、连续天数断了等）。

建议先做完 P2 看真实数据形态，再决定 P3 里的汇总表是否值得上 —— 如果数据量一直在几千行级别，直接现算也够用。
