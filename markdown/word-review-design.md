# 单词模块的掌握度与三池轮转设计

> 适用范围：`client/src/review/*`（泛型引擎）+ `client/src/typing/*`（单词领域接入）。
> 目标：书有独立进度、错词可复习、掌握后抽查、答错回滚，且跨书重复单词只算一次。

---

## 1. 前提数据（决定了整套设计）

跑 `npm run review:index` 可得：

| 指标 | 数值 |
|---|---|
| 词库文件 | 311 个 JSON，68 MB |
| 登记在 `DICTIONARIES` 的词库 | 308 本，12 个一级分类 |
| 原始词条总数 | 367,065 |
| **书内去重后** | 355,606（同一本书内部就有重复词条） |
| **跨书全局并集** | 42,353（重复率 8.7 倍） |
| 一级分类并集 | 通用词表 21,652 / 雅思 19,435 / 国内考试 15,397 / 北美 13,055 / 美研 11,230 … |

两个由此推出的硬约束：

1. **任何分母都必须去重。** 否则有重复词条的书在 UI 上永远刷不到 100%。
2. **掌握态必须按「词」全局唯一，不能按「(书, 词)」。** 同一个拼写全世界只记一条状态。按 (书, 词) 存会让一个词在 56 本书里分别重练，且单用户上限抬到 36 万行。

跨书重叠实测：`book` 出现在 75 本书 / 11 个分类；`abandon` 出现在 56 本书 / 9 个分类；
六级 ∩ 考研红宝书 = 后者的 83.6%；COCA20000 ∩ 上海初中牛津词汇 = 77.2%。

---

## 2. 三池状态机

```
none ──错──▶ wrong ──连答对 N──▶ standby ──抽查通过 K──▶ mastered
              ▲                    │                        │
              └── 抽查累计错 M ─────┘◀── 主线答错（可配）────┘
  手动「认识了」：wrong/standby → standby（默认）或 mastered
```

| 状态 | 含义 | 是否计入进度分子 |
|---|---|---|
| `none` | 练过但从没错过 | 否（算进「已接触」） |
| `wrong` | 错题池 | 否 |
| `standby` | 备用池，达标但还没走远 | **是** |
| `mastered` | 毕业归档，退出抽查 | **是** |

字段见 `client/src/review/types.ts::ReviewItemState`。

### 关键取舍

- **同一会话内重复命中只计一次。** `loopTimes` / `isShuffle` 会让同一个词在一章里多次出现，
  否则「连答对 2 次」在同一次会话里就能刷出来。靠 `lastSessionId` 判定。
- **偷看答案（Tab 展开释义）不计 streak。** 既不奖励也不惩罚，且**不占用会话名额**——
  否则「先看答案再打」会把这次的晋级机会白白吃掉。
- **`wrongTotal` 只增不清**，代表历史而非当前能力；出池只看 `reviewStreak`。
- **两条出池路径**：自动（连答对 N 次）+ 手动（点「认识了」）。
- **毕业不免疫**：主线练习把已毕业的词打错仍拽回错题池（可关）。

---

## 3. 进度口径

```
书进度   掌握率 = (standby + mastered) / 该书去重词数
         覆盖率 = 已接触过的词 / 该书去重词数
一级分类 掌握率 = (standby + mastered) / 该分类所有书的并集词数
```

- 一级分类用**词表并集**而非各书加权平均：并集才反映真实词汇量，
  平均会把同一个已被掌握的词重复计入。
- 分母全部来自索引产物（`scripts/build-review-index.mjs`），不是原始词条数，
  也不是跨书全局并集。
- 静止重算不贵：一次 `Map` 查找 × 单书 ≤ 1.7 万词，< 5ms。会话结束时全量重算 + memo 即可，
  不需要增量维护。

---

## 4. 索引产物

`npm run review:index` 生成到 `client/public/dicts/_index/`：

| 文件 | 内容 | 体积 |
|---|---|---|
| `meta.json` | 每本书的 raw / unique 词数与所属分类；分类到分片的映射 | 小 |
| `g<N>.json` | 某个一级分类下，`unitId -> 去重词表`（`\n` 分隔字符串） | 合计 3.28 MB |

按分类分片是刻意的：算「雅思考试」的并集需要 59 本书的词表，运行时临时拉不现实；
分片后只在切到该分类时才下载它那一份（几百 KB）。由此也有 UI 约束 ——
**「全部词库」页和搜索状态下不显示进度**，否则要全量下载。

> 提交注意：索引是生成物，约 3.3 MB。已存在的 `client/public/dicts` 本身就有 68 MB 入库，
> 所以体积不是问题，但改动索引后者必须记得重跑，否则新加的词库分母会缺失。

---

## 5. 服务端

表 `review_item_state`（DDL：`server/prisma/review_module_init.sql`，**人工执行，禁止 `db push`**）：

| 字段 | 说明 |
|---|---|
| `userId, domain, key` | 唯一索引。刻意不含 `dictId` —— 同一个单词只有一条状态 |
| `status` | none / wrong / standby / mastered |
| `reviewStreak` / `checkStreak` / `checkFailStreak` | 三条计数器，分别对应晋级、毕业、回滚 |
| `wrongTotal` / `rightTotal` | 历史对错总次数，只增不清 |
| `firstWrongAt` / `lastResultAt` / `lastCheckAt` | 毫秒时间戳，抽查排序用「最久没抽查过」 |
| `units` | 曾在哪些书里遇到过，用于「本书错题」视图 |
| `mistakes` | 仅 word 领域：字母级错输明细，出池即丢 |

与既有 `typing_word_record` 的分工：**流水 vs 当前态**。前者继续记录每次章节练习的逐字母
耗时与错输，后者只保存这个词现在在哪个池。迁移端点 `POST /api/review/migrate-word-wrongs`
把历史上错过的单词灌成错题池初值（幂等）。

路由：`server/src/routes/review.ts`，挂在 `/api/review`。

---

## 6. 本地存储

`localStorage['review-state-v1']`，按 domain 拆三个桶：

| 桶 | 内容 | 为什么 |
|---|---|---|
| `active` | wrong / standby 的完整状态 | 数量有限，通常几百到几千 |
| `mastered` | 只存 key 的数组 | 毕业的词不需要 streak / mistakes |
| `ungraded` | 练过但没错过，只存 key | 同上 |

全书记载 42,353 个拼写，每个掌握的词都存完整对象会撑爆配额（约 4 MB）。
云端同步走 `/api/review/items` 批量 upsert，`updatedAt` 做 last-write-wins，失败静默降级。

---

## 7. 配置项

`DEFAULT_REVIEW_CONFIG`，暴露在设置面板「复习轮转」分组：

| 配置 | 默认 | 说明 |
|---|---|---|
| `reviewPassCount` | 2 | 错题 → 备用所需的连答对次数 |
| `spotCheckFailLimit` | 2 | 备用 → 错题所需的累计抽查错误次数 |
| `graduateAfterCheckPass` | 3 | 备用 → 毕业所需的连续抽查通过次数，0 = 永不毕业 |
| `masteredWrongReturnsToPool` | true | 毕业的词主线答错是否拽回错题池 |
| `manualKnowTarget` | standby | 手动「认识了」去备用（继续抽查）还是直接毕业 |
| `spotCheckMixRatio` | 0.2 | 主线练习混入备用词的比例 |
| `spotCheckMixMode` | interleave | tail 章末 / interleave 穿插 |

---

## 8. 接听力单句（下一步）

引擎是 domain-agnostic 的，接一个新领域只需要补一层映射：

| | 单词 word | 单句 sentence |
|---|---|---|
| 一级 group | `category`（雅思考试…） | `series`（新概念英语 · 英音…） |
| 二级 unit | `dictId` | `bookId` |
| 条目 key | `normalizeItemKey(word.name)` | `bookId::lessonId::句序` |
| 「答对」来源 | 拼写全对 | 听写/跟读判定通过或直接手动标记 |

需要补的东西：

1. `client/src/review/domains/sentence.ts`：写 `sentenceCatalog`（结构与 `wordCatalog` 一致，
   索引产物由 `build-review-index.mjs` 扩展出单句部分）+ 进度 hook。
2. `build-review-index.mjs` 增加一条流水线：书 → 每课的句子 id，产出同构的 `meta.json` 与分类分片。
3. 在英语页面把单句练习结果喂给 `getReviewStore('sentence').applyResults()`。

「这套东西真能复用吗」—— 能，因为抽象只有三条：条目键、所属 unit、所属 group，
三池轮转与进度算法完全不关心内容是什么。

---

## 9. 已知限制

- 复习/抽查队列里，不在当前词库的词只有拼写、没有中文释义与音标
  （释义是从当前词库回填的）。后续可按 `units` 记录的书按需拉对应词库。
- 「跳过（Esc）」的单词不产生任何结果与计数。
- 大小写与首尾空格归一化为一个词：`Book` 和 `book` 视为同一个条目。
