# DrawingCanvas 双画布渲染方案

## Context（背景）

作业模式（AssignmentMode）的书写层是 `client/src/components/DrawingCanvas.tsx`。用户反馈「写的时候白屏了就没保存上，页面会 crash」，排查时发现一个明显的性能特征：

**每次鼠标移动都会把该页全部已提交的笔画重新画一遍。**

一页作业画到 220 笔时，一次 `pointermove` 要遍历几万个归一化坐标点，逐段做 `quadraticCurveTo`。`pointermove` 每秒可触发几十到上百次，主线程被持续占满 —— 这正是渲染进程卡死（白屏）的最可能来源。

改造目标：**让「移动一次鼠标」的成本与页面上已有多少笔迹无关。**

## 改前的实现

```ts
const redraw = useCallback(() => {
  const canvas = canvasRef.current;
  const ctx = ctxRef.current;
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokesRef.current) {   // ← 全部历史笔画
    drawStroke(ctx, stroke, width, height);
  }
  if (currentStrokeRef.current) {              // ← 正在画的这一笔
    drawStroke(ctx, currentStrokeRef.current, width, height);
  }
}, [width, height]);
```

而 `onPointerMove` 直接调它：

```ts
pts.push(pt);
redraw();   // 每移动一次 → 全量重绘
```

复杂度：单次移动 = O(全部笔画点数)。笔迹越多越慢，且用户在笔迹多的时候往往还要继续写 —— 正好在最需要流畅的时候最卡。

## 设计：把「不变的」和「正在变的」分开

核心观察：一次书写过程中，**历史笔画是恒定不变的**，只有 `currentStrokeRef`（当前这一笔）在增长。把恒定部分缓存成一张位图，每次移动只需：

```
清屏 → drawImage(缓存位图) → 画当前这一笔
```

`drawImage` 是位图块传送（blit），由浏览器/显卡直接搬运像素，代价与位图内容无关，只与尺寸有关。

### 结构

```
┌─ 外层容器（CSS transform: rotate / scale / translate）──────────┐
│  ┌─ <img> 页面图片 ─────────┐  ┌─ <canvas> 书写层 ─────────────┐ │
│  │  canvasWidth × canvasHeight │  │  CSS 尺寸 100%，紧贴图片     │ │
│  └──────────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

- **离屏 canvas**（`document.createElement('canvas')`，不插入 DOM）：缓存所有**已提交**笔画
- **主 canvas**（可见，就是原来的那个）：每帧 = 离屏位图 + 当前笔画

两张画布的像素尺寸始终相同，`drawImage(base, 0, 0)` 是严格 1:1 拷贝，无缩放。

## 代码详解

### 1. 新增的 ref

```ts
// Offscreen layer holding every committed stroke. It is repainted only when
// the stroke array or the canvas size changes, so moving the pointer costs
// one bitmap blit plus the stroke in progress instead of re-walking every
// point of the whole assignment on every single move event.
const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
const baseStrokesRef = useRef<Stroke[] | null>(null);
```

`baseStrokesRef` 记录「离屏层当前缓存的是哪一份 strokes 数组」，用于跳过无谓的重建。

### 2. 统一的像素尺寸（关键）

```ts
// Callers hand us width/height derived from `naturalSize * zoom`, which is
// fractional. Both canvases must end up at the exact same integer size or
// the blit would rescale, so round once and use it everywhere.
const pixelWidth = Math.max(1, Math.round(width));
const pixelHeight = Math.max(1, Math.round(height));
```

### 3. `rebuildBase()` —— 重建离屏层

```ts
/**
 * Repaint the cached layer from strokesRef. Skipped when it already mirrors
 * the current stroke array at the current size, so a parent re-render that
 * hands back the same array does not redo the work.
 */
const rebuildBase = useCallback(() => {
  let base = baseCanvasRef.current;
  if (!base) {
    base = document.createElement('canvas');
    baseCanvasRef.current = base;
  }
  const resized = base.width !== pixelWidth || base.height !== pixelHeight;
  if (!resized && baseStrokesRef.current === strokesRef.current) return;
  if (resized) {
    // Assigning width/height also clears the canvas.
    base.width = pixelWidth;
    base.height = pixelHeight;
  }
  const bctx = base.getContext('2d');
  if (!bctx) return;
  bctx.clearRect(0, 0, pixelWidth, pixelHeight);
  for (const stroke of strokesRef.current) {
    drawStroke(bctx, stroke, pixelWidth, pixelHeight);
  }
  baseStrokesRef.current = strokesRef.current;
}, [pixelWidth, pixelHeight]);
```

两个要点：

- **跳过条件用的是数组引用比较**。笔画数组是 immutable 增量更新的（新增用 `[...arr, s]`、删除用 `filter`、撤销重做从栈里取浅拷贝），未改动的 stroke 对象保持引用不变。所以「引用没变 ⇒ 内容没变」，父组件回传同一数组时直接返回，不做重复劳动。
- **尺寸变化必须强制重建**，即便 strokes 引用相同。给 `canvas.width` 赋值会清空画布，所以 `resized` 分支后仍需重绘。

### 4. `composite()` —— 每帧合成

```ts
/** Blit the committed strokes, then draw the stroke in progress on top. */
const composite = useCallback(() => {
  const canvas = canvasRef.current;
  const ctx = ctxRef.current;
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const base = baseCanvasRef.current;
  if (base && base.width === canvas.width && base.height === canvas.height) {
    ctx.drawImage(base, 0, 0);
  }
  if (currentStrokeRef.current) {
    drawStroke(ctx, currentStrokeRef.current, pixelWidth, pixelHeight);
  }
}, [pixelWidth, pixelHeight]);
```

尺寸相等判断是防御性的：两张画布由同一个 `pixelWidth/pixelHeight` 赋值，理论上恒等，但一旦不等就宁可不画（避免缩放错位），而不是画错。

### 5. `redraw()` —— 全量重绘（保留，用于真正的变更点）

```ts
/** Full repaint — rebuild the cached layer, then blit it. */
const redraw = useCallback(() => {
  rebuildBase();
  composite();
}, [rebuildBase, composite]);
```

### 6. 调用点分工

| 时机 | 调用 | 理由 |
|---|---|---|
| `onPointerDown`（起笔） | `composite()` | 离屏层未变，只需把新的当前笔画画上去 |
| `onPointerMove`（移动） | `composite()` | **性能关键路径**，只做 blit + 一笔 |
| `onPointerUp`（收笔） | `redraw()` | 当前笔画已并入 `strokes`，离屏层必须更新 |
| 橡皮擦除命中 | `redraw()` | 笔画集合变了 |
| `undo` / `redo` / `clear` | `redraw()` | 笔画集合变了 |
| `useEffect`（strokes prop 或尺寸变化） | `redraw()` | 外部数据或画布尺寸变了 |

原来的 `onPointerMove` / `onPointerDown` 调的是 `redraw()`，现在换成 `composite()` —— 这是本次改动性能收益的来源。

## 关键坑：浮点尺寸会让优化静默失效

`AssignmentMode` 传入的是：

```ts
const canvasWidth  = imgNatural.w * localZoom;   // 浮点
const canvasHeight = imgNatural.h * localZoom;   // 浮点
```

而 `canvas.width = 1200.7` 会被 WebIDL 规范截断成整数（向零取整，得 `1200`）。如果离屏层按浮点尺寸建、主画布按截断值建，会出现两个后果：

1. `base.width !== pixelWidth` 恒成立 → **每次移动都判定为「尺寸变了」→ 每次都重建离屏层**，优化完全失效，还多一次全量重绘；
2. 两张画布尺寸不等 → `drawImage` 变成缩放拷贝，笔迹位置整体偏移。

解法是**统一取整，并且主画布也显式赋这个值**：

```ts
canvas.width  = pixelWidth;    // 不再是浮点 width
canvas.height = pixelHeight;
```

副作用：画布像素尺寸由「截断」变为「四舍五入」，最多相差 1 像素。因为两张画布共用同一个值，不会出现相对错位；相对改前只是精度略准一点，肉眼不可见。

## 正确性保证

### 半透明荧光笔不会叠深

荧光笔用 `globalAlpha = 0.35` 绘制。若采用「只画最后一段增量」的优化，同一条笔画会被反复叠加，越画越深。**本方案每帧仍然先清屏、再整条重画当前笔画**，与改前的逐帧语义完全一致，透明度不会累积。这也是没有选择增量绘制的原因。

### 收笔不闪

`onPointerUp` 里同步走 `redraw()`，离屏层当帧就包含新笔画，不会等到父组件回传 props 才更新。随后父组件 `setStrokes(同一引用)` 触发 effect，`rebuildBase` 因引用未变而跳过，只做一次无害的 `composite`。

### 旋转、缩放、平移均不受影响

三者都是**外层容器的 CSS transform**，图片与 canvas 同属该容器，浏览器在合成阶段整体变换，二者永远同步。canvas 的**像素缓冲区**只由 `canvasWidth/canvasHeight` 决定，不参与 CSS 变换。

需要留意的一点：旋转 90°/270° 时 `calcLocalZoom` 会按交换后的 `natW/natH` 重算 `localZoom`，因此 `canvasWidth/canvasHeight` **会变化** —— 这会走到 effect → `pixelWidth` 变 → `rebuildBase` 走 `resized` 分支重建离屏层。已覆盖，无需额外处理。fit 模式切换、窗口 resize、双指缩放后的重排同理。

命中测试（`getNormalizedPoint`、`findStrokeAt`）使用 `getBoundingClientRect()`，该矩形反映 CSS transform **之后**的真实显示区域，所以旋转/缩放状态下归一化坐标依然正确。这部分代码本次未改动。

### 导出不受影响

`exportCanvas()` 返回主 canvas。主 canvas 每帧都等于「离屏位图 + 当前笔画」，即始终包含完整画面，导出内容与改前一致。

## 会触发离屏层重建的场景

| 场景 | 判定分支 |
|---|---|
| 收笔、橡皮擦除、撤销、重做、清空 | strokes 引用变化 → 重建 |
| 翻页（加载新页笔迹） | strokes 引用变化 → 重建 |
| 旋转 90°/180°/270° | `localZoom` 重算 → 尺寸变化 → 重建 |
| fit 模式切换、容器 resize | `localZoom` 重算 → 尺寸变化 → 重建 |
| 父组件回传同一 strokes 引用 | 引用未变且尺寸未变 → **跳过** |
| 每次 pointermove | 只 `composite()`，不触碰离屏层 |

## 复杂度对比

| | 单次 pointermove | 随笔迹增长 |
|---|---|---|
| 改前 | O(全部笔画点数) —— 220 笔约几万个点 | 持续变慢 |
| 改后 | O(1) blit + O(当前笔画点数) | 基本恒定 |

离屏层的重建是 O(全部点数)，但只在上述有限场景发生（每笔一次、翻页一次、旋转一次），不在高频路径上。

## 回归检查清单

改动涉及绘制基准（浮点 → 取整）与绘制时机，验证时重点看：

1. **落笔跟手、笔迹位置准确** —— 最可能暴露坐标基准问题
2. **荧光笔连续画，颜色深浅一致** —— 不应越画越深
3. **画到一半旋转 90°，笔迹与页面图片一起转且不错位**
4. **双指缩放后继续书写，落点准确**
5. **橡皮擦除、撤销、重做后画面立即正确**
6. **翻页后再翻回来，笔迹完整**
7. **在笔迹很多的一页连续书写，是否还卡** —— 若仍卡，瓶颈不在重绘，需转向排查自动保存的请求往返
