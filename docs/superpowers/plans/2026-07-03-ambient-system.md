# 全局氛围系统（暗夜霞光 · 第一期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 封面取色驱动的动态霞光背景 + 光效 token + ClickSpark 点击迸发 + 统一动效预设，实现「切歌全 app 氛围变色」。

**Architecture:** 新增 ambient store 持有三色调色板；`useAmbientPalette` hook 监听当前歌曲封面、提取调色板并写入 store 与根节点 CSS 变量；AppShell 的 LiquidEther 背景订阅调色板（LiquidEther 增加调色板热切换避免重建 WebGL）；eco 档退化为 CSS 渐变霞光。

**Tech Stack:** React 18 + zustand + three.js（已有 LiquidEther）+ motion（`motion/react`）+ vitest（node 环境，纯函数测试）。

**Spec:** `docs/superpowers/specs/2026-07-03-ambient-system-design.md`

## Global Constraints

- 默认调色板固定为 `['#5227FF', '#FF9FFC', '#B497CF']`（现有紫粉霞光）。
- vitest 跑在 node 环境（无 jsdom）：单测只测纯函数与 zustand store，不测 DOM/canvas。
- 性能规则：`eco` 不渲染 WebGL；`balanced` resolution 0.4；`high`/`ultra` resolution 0.5。
- 同屏只跑一个全屏 WebGL 层：歌词页 3D 模式打开时背景 `display: none`（LiquidEther 内置 IntersectionObserver 自动暂停）。
- `prefers-reduced-motion: reduce` 时新增动效全部禁用（tokens.css 已有全局规则，ClickSpark 需自行检查）。
- 注释风格：中文注释，与现有代码一致。
- 每个任务提交信息末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 调色板提取纯函数（extract-color.ts）

**Files:**
- Modify: `src/lib/extract-color.ts`（追加，不动现有 `extractColor`）
- Test: `src/lib/extract-color.test.ts`（新建）

**Interfaces:**
- Produces:
  - `export const DEFAULT_PALETTE: [string, string, string]`（值 `['#5227ff', '#ff9ffc', '#b497cf']`，小写 hex）
  - `export function paletteFromPixels(data: Uint8ClampedArray | number[]): [string, string, string]`（RGBA 像素数组 → 三主导色，饱和度钳制 [0.55, 0.9]、亮度钳制 [0.55, 0.72]）
  - `export function extractPalette(img: HTMLImageElement): [string, string, string]`（canvas 采样 24×24 后调 `paletteFromPixels`，异常返回 DEFAULT_PALETTE）

- [ ] **Step 1: Write the failing test**

创建 `src/lib/extract-color.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { paletteFromPixels, DEFAULT_PALETTE } from './extract-color'

/** 构造 n 个相同 RGBA 像素的数组。 */
function pixels(r: number, g: number, b: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(r, g, b, 255)
  return out
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s, l]
}

describe('paletteFromPixels', () => {
  it('纯红图像：主色落在红色系且亮度被钳制到可读区间', () => {
    const [c1] = paletteFromPixels(pixels(255, 0, 0, 64))
    const [h, s, l] = hexToHsl(c1)
    expect(h < 30 || h > 330).toBe(true)
    expect(s).toBeGreaterThanOrEqual(0.5)
    expect(s).toBeLessThanOrEqual(0.95)
    expect(l).toBeGreaterThanOrEqual(0.5)
    expect(l).toBeLessThanOrEqual(0.75)
  })

  it('蓝黄双色图像：前两个主导色 hue 明显不同', () => {
    const data = [...pixels(30, 60, 230, 40), ...pixels(240, 200, 40, 24)]
    const [c1, c2] = paletteFromPixels(data)
    const [h1] = hexToHsl(c1)
    const [h2] = hexToHsl(c2)
    // 蓝像素更多 → 主色是蓝
    expect(h1).toBeGreaterThan(180)
    expect(h1).toBeLessThan(280)
    expect(Math.abs(h1 - h2)).toBeGreaterThan(60)
  })

  it('全黑图像：回退默认霞光调色板', () => {
    expect(paletteFromPixels(pixels(0, 0, 0, 64))).toEqual(DEFAULT_PALETTE)
  })

  it('灰色图像（低饱和）：回退默认霞光调色板', () => {
    expect(paletteFromPixels(pixels(128, 128, 128, 64))).toEqual(DEFAULT_PALETTE)
  })

  it('单色图像不足三色时用默认色补齐', () => {
    const result = paletteFromPixels(pixels(255, 0, 0, 64))
    expect(result).toHaveLength(3)
    expect(result[1]).toBe(DEFAULT_PALETTE[1])
    expect(result[2]).toBe(DEFAULT_PALETTE[2])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/extract-color.test.ts`
Expected: FAIL —— `paletteFromPixels` / `DEFAULT_PALETTE` 未导出。

- [ ] **Step 3: Write minimal implementation**

在 `src/lib/extract-color.ts` 追加（保留文件现有内容）：

```ts
/** 默认霞光调色板（无封面/提取失败时使用），与 LiquidEther 初始色一致。 */
export const DEFAULT_PALETTE: [string, string, string] = ['#5227ff', '#ff9ffc', '#b497cf']

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** RGB(0-255) → HSL（h: 0-360, s/l: 0-1）。 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s, l]
}

/** HSL → hex 字符串（#rrggbb 小写）。 */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  const to2 = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

/**
 * 从 RGBA 像素数组提取三个主导色（用于霞光氛围）。
 * 按 30° 色相桶聚类，过滤近黑/近白/低饱和像素，按「饱和度 × 中间亮度」加权；
 * 输出做饱和度/亮度钳制，保证深色底上不脏不刺眼；不足三色用默认色补齐。
 */
export function paletteFromPixels(data: Uint8ClampedArray | number[]): [string, string, string] {
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const [h, s, l] = rgbToHsl(r, g, b)
    if (l < 0.08 || l > 0.95 || s < 0.12) continue
    const key = Math.floor(h / 30) % 12
    const w = s * (1 - Math.abs(l - 0.5))
    const cur = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 }
    cur.w += w; cur.r += r * w; cur.g += g * w; cur.b += b * w
    buckets.set(key, cur)
  }
  const top = [...buckets.values()].sort((a, b) => b.w - a.w).slice(0, 3)
  const out = top.map((bk) => {
    const [h, s, l] = rgbToHsl(bk.r / bk.w, bk.g / bk.w, bk.b / bk.w)
    return hslToHex(h, clamp(s, 0.55, 0.9), clamp(l, 0.55, 0.72))
  })
  while (out.length < 3) out.push(DEFAULT_PALETTE[out.length])
  return [out[0], out[1], out[2]]
}

/** 从已加载的图片提取霞光调色板（24×24 canvas 采样），异常回退默认色。 */
export function extractPalette(img: HTMLImageElement): [string, string, string] {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 24
    canvas.height = 24
    const ctx = canvas.getContext('2d')
    if (!ctx) return [...DEFAULT_PALETTE]
    ctx.drawImage(img, 0, 0, 24, 24)
    return paletteFromPixels(ctx.getImageData(0, 0, 24, 24).data)
  } catch {
    return [...DEFAULT_PALETTE]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/extract-color.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add src/lib/extract-color.ts src/lib/extract-color.test.ts
git commit -m "feat: add extractPalette — hue-bucket dominant colors with aurora clamping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: ambient store

**Files:**
- Create: `src/stores/ambient.ts`
- Test: 追加到 `src/stores/stores.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_PALETTE`（Task 1）
- Produces:
  - `export type AmbientPalette = [string, string, string]`
  - `export const useAmbientStore`（zustand store）：`palette: AmbientPalette`、`setPalette(palette: AmbientPalette): void`、`resetPalette(): void`

- [ ] **Step 1: Write the failing test**

在 `src/stores/stores.test.ts` 末尾追加：

```ts
describe('ambient store', () => {
  it('setPalette 更新调色板，resetPalette 回到默认霞光色', async () => {
    const { useAmbientStore } = await import('./ambient')
    const { DEFAULT_PALETTE } = await import('../lib/extract-color')
    expect(useAmbientStore.getState().palette).toEqual(DEFAULT_PALETTE)
    useAmbientStore.getState().setPalette(['#112233', '#445566', '#778899'])
    expect(useAmbientStore.getState().palette).toEqual(['#112233', '#445566', '#778899'])
    useAmbientStore.getState().resetPalette()
    expect(useAmbientStore.getState().palette).toEqual(DEFAULT_PALETTE)
  })
})
```

（文件顶部已有 `describe/it/expect` 导入，无需重复。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/stores.test.ts`
Expected: FAIL —— 找不到模块 `./ambient`。

- [ ] **Step 3: Write minimal implementation**

创建 `src/stores/ambient.ts`：

```ts
import { create } from 'zustand'
import { DEFAULT_PALETTE } from '../lib/extract-color'

export type AmbientPalette = [string, string, string]

interface AmbientStore {
  /** 氛围三色：主色/副色/点缀色，来自当前歌曲封面。 */
  palette: AmbientPalette
  setPalette(palette: AmbientPalette): void
  resetPalette(): void
}

export const useAmbientStore = create<AmbientStore>((set) => ({
  palette: [...DEFAULT_PALETTE],

  setPalette(palette) {
    set({ palette })
  },

  resetPalette() {
    set({ palette: [...DEFAULT_PALETTE] })
  }
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/stores.test.ts`
Expected: PASS（原 7 个 + 新 1 个）

- [ ] **Step 5: Commit**

```bash
git add src/stores/ambient.ts src/stores/stores.test.ts
git commit -m "feat: add ambient store holding cover-derived aurora palette

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 光效 Token（tokens.css + global.css）

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: CSS 变量 `--ambient-1/2/3`、`--glow-soft`、`--glow-ring`、`--ambient-gradient`，后续任务与二/三/四期直接引用。

- [ ] **Step 1: 在 tokens.css 注册可过渡的氛围色属性**

在 `src/styles/tokens.css` 文件顶部（`:root` 块之前）加入：

```css
/* ── 氛围色注册（@property 使 CSS 变量可平滑过渡）── */
@property --ambient-1 { syntax: '<color>'; inherits: true; initial-value: #5227ff; }
@property --ambient-2 { syntax: '<color>'; inherits: true; initial-value: #ff9ffc; }
@property --ambient-3 { syntax: '<color>'; inherits: true; initial-value: #b497cf; }
```

- [ ] **Step 2: 在深色 `:root` 块内追加氛围/光效 token**

在 `:root` 块（`--glass-border-modal` 之后）追加：

```css
  /* 氛围光效（封面取色驱动，useAmbientPalette 动态覆盖） */
  --ambient-1: #5227ff;
  --ambient-2: #ff9ffc;
  --ambient-3: #b497cf;
  --glow-soft: 0 0 48px color-mix(in srgb, var(--ambient-1) 28%, transparent);
  --glow-ring: 0 0 0 1px color-mix(in srgb, var(--ambient-2) 35%, transparent),
               0 0 24px color-mix(in srgb, var(--ambient-1) 30%, transparent);
  --ambient-gradient: linear-gradient(120deg, var(--ambient-1), var(--ambient-2), var(--ambient-3));
```

在 `[data-theme="dark"]` 块末尾追加同样的 6 行（与文件现有「每个主题块完整重复」的模式一致）。

- [ ] **Step 3: 浅色模式辉光减弱**

在 `@media (prefers-color-scheme: light)` 内的 `:root` 块和 `[data-theme="light"]` 块末尾各追加：

```css
  /* 浅色模式：辉光减半，避免刺眼 */
  --glow-soft: 0 0 48px color-mix(in srgb, var(--ambient-1) 14%, transparent);
  --glow-ring: 0 0 0 1px color-mix(in srgb, var(--ambient-2) 18%, transparent),
               0 0 24px color-mix(in srgb, var(--ambient-1) 15%, transparent);
```

（浅色块不重复 `--ambient-1/2/3` 与 `--ambient-gradient`，继承 `:root`。）

- [ ] **Step 4: 根节点氛围色过渡**

在 `src/styles/global.css` 中给 `html` 加过渡（若无 `html` 规则则新建）：

```css
/* 氛围色切换（切歌取色）时约 800ms 平滑过渡 */
html {
  transition:
    --ambient-1 800ms var(--sm-ease-in-out),
    --ambient-2 800ms var(--sm-ease-in-out),
    --ambient-3 800ms var(--sm-ease-in-out);
}
```

- [ ] **Step 5: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过（CSS 无类型检查，build 确认无语法错误）

```bash
git add src/styles/tokens.css src/styles/global.css
git commit -m "feat: add ambient/glow CSS tokens with @property color transitions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: useAmbientPalette hook + App 挂载

**Files:**
- Create: `src/hooks/useAmbientPalette.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAmbientStore.setPalette/resetPalette`（Task 2）、`extractPalette`（Task 1）、`api.url`、`usePlayerStore.currentTrack`
- Produces: `export function useAmbientPalette(): void`；副作用——ambient store 更新 + `document.documentElement` 上的 `--ambient-1/2/3` 内联变量

- [ ] **Step 1: 实现 hook**

创建 `src/hooks/useAmbientPalette.ts`：

```ts
import { useEffect } from 'react'
import { usePlayerStore } from '../stores/player'
import { useAmbientStore, type AmbientPalette } from '../stores/ambient'
import { api } from '../lib/api'
import { extractPalette, DEFAULT_PALETTE } from '../lib/extract-color'

/** 把调色板写入 store 与根节点 CSS 变量（tokens.css 的 @property + html transition 负责平滑过渡）。 */
function applyPalette(palette: AmbientPalette): void {
  useAmbientStore.getState().setPalette(palette)
  const root = document.documentElement
  root.style.setProperty('--ambient-1', palette[0])
  root.style.setProperty('--ambient-2', palette[1])
  root.style.setProperty('--ambient-3', palette[2])
}

/** 监听当前歌曲封面，提取霞光调色板并广播到全局（store + CSS 变量）。挂在 App 顶层。 */
export function useAmbientPalette(): void {
  const cover = usePlayerStore((s) => s.currentTrack?.cover)

  useEffect(() => {
    if (!cover) {
      applyPalette([...DEFAULT_PALETTE])
      return
    }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = api.url('/proxy/cover', { url: cover })
    img.onload = () => {
      if (!cancelled) applyPalette(extractPalette(img))
    }
    img.onerror = () => {
      if (!cancelled) applyPalette([...DEFAULT_PALETTE])
    }
    // 切歌竞态：只认最新封面的结果
    return () => {
      cancelled = true
    }
  }, [cover])
}
```

- [ ] **Step 2: 挂到 App**

修改 `src/App.tsx`：在 import 区加 `import { useAmbientPalette } from './hooks/useAmbientPalette'`，在 `useLyricsFetch()` 之后加一行 `useAmbientPalette()`。

- [ ] **Step 3: 验证 + Commit**

Run: `npm run typecheck && npm test`
Expected: 全部通过

```bash
git add src/hooks/useAmbientPalette.ts src/App.tsx
git commit -m "feat: wire cover palette extraction into ambient store and CSS vars

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: LiquidEther 调色板热切换（不重建 WebGL）

**Files:**
- Modify: `src/components/Visualizer/LiquidEther.tsx`

**Interfaces:**
- Produces: `colors` / `autoSpeed` / `autoIntensity` prop 变化不再重建整个模拟；`colors` 变化触发 800ms 调色板补间。

**背景**：目前挂载 useEffect 的依赖数组（约 1221–1239 行）包含 `colors`、`autoSpeed`、`autoIntensity`，任何变化都会 dispose 并重建整个 WebGL 模拟（黑闪 + 高开销）。`autoSpeed`/`autoIntensity` 已由第二个同步 effect（约 1241–1272 行）动态更新，`colors` 需要新增热切换路径。

- [ ] **Step 1: 把 makePaletteTexture 提升到模块作用域**

当前 `makePaletteTexture` 定义在挂载 effect 内部（约 60–88 行）。将整个函数原样移动到组件外（import 之后、`interface LiquidEtherProps` 之前），签名改为带返回类型：

```ts
function makePaletteTexture(stops: string[]): THREE.DataTexture {
  // ……函数体原样搬移，不改逻辑……
}
```

挂载 effect 内原调用处（约第 90 行）保持 `const paletteTex = makePaletteTexture(colorsRef.current);`（见 Step 2 的 colorsRef）。

- [ ] **Step 2: 新增 colorsRef 并从挂载依赖中移除动态 prop**

组件顶部 refs 区域加：

```ts
const colorsRef = useRef<string[]>(colors);
```

挂载 effect 的依赖数组中删除 `colors`、`autoSpeed`、`autoIntensity` 三项，并在依赖数组上一行加：

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps -- colors/autoSpeed/autoIntensity 走热更新路径，不重建模拟
```

- [ ] **Step 3: 新增调色板补间 effect**

在两个现有 useEffect 之间（挂载 effect 之后）追加：

```tsx
// colors 变化：补间旧→新调色板并热替换 palette uniform，避免重建整个模拟
useEffect(() => {
  const from = colorsRef.current;
  const to = colors;
  colorsRef.current = colors;
  const webgl = webglRef.current;
  const mesh = webgl?.output?.output as THREE.Mesh | undefined;
  const mat = mesh?.material as THREE.RawShaderMaterial | undefined;
  const uniform = mat?.uniforms?.palette as { value: THREE.DataTexture } | undefined;
  if (!uniform || from === to) return;

  const n = Math.max(from.length, to.length);
  const fromC = Array.from({ length: n }, (_, i) => new THREE.Color(from[i % from.length]));
  const toC = Array.from({ length: n }, (_, i) => new THREE.Color(to[i % to.length]));
  const start = performance.now();
  const DURATION = 800;
  let raf = 0;

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    const mixed = fromC.map((c, i) => `#${c.clone().lerp(toC[i], t).getHexString()}`);
    const tex = makePaletteTexture(mixed);
    const old = uniform.value;
    uniform.value = tex;
    old?.dispose?.();
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}, [colors]);
```

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过

```bash
git add src/components/Visualizer/LiquidEther.tsx
git commit -m "feat: hot-swap LiquidEther palette with 800ms tween instead of full re-init

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: AppShell 背景接线（跟色 + 播放联动 + 性能降级 + 互斥）

**Files:**
- Modify: `src/components/Layout/AppShell.tsx`
- Modify: `src/components/Layout/AppShell.module.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAmbientStore.palette`（Task 2）、`useVisualStore.performanceMode`、`usePlayerStore.status`、`useSettingsStore.lyricsPanelMode`
- Produces: `AppShell` 新增 prop `backgroundHidden?: boolean`

- [ ] **Step 1: 改造 AppShell.tsx**

```tsx
import { lazy, Suspense } from 'react'
import { useNavigationStore } from '../../stores/navigation'
import { useAmbientStore } from '../../stores/ambient'
import { useVisualStore } from '../../stores/visual'
import { usePlayerStore } from '../../stores/player'
import LiquidEther from '../Visualizer/LiquidEther'
import styles from './AppShell.module.css'
```

组件签名与背景块改为：

```tsx
interface AppShellProps {
  /** 为 true 时隐藏背景层（如歌词页 3D 模式打开，保证同屏只有一个全屏 WebGL）。 */
  backgroundHidden?: boolean
}

export function AppShell({ backgroundHidden }: AppShellProps) {
  const palette = useAmbientStore((s) => s.palette)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const playing = usePlayerStore((s) => s.status === 'playing')
  // …… viewKey / renderPage 等现有逻辑不动 ……

  return (
    <div className={styles.shell}>
      {/* display:none 时 LiquidEther 内置 IntersectionObserver 自动暂停渲染 */}
      <div className={styles.background} style={backgroundHidden ? { display: 'none' } : undefined}>
        {performanceMode === 'eco' ? (
          <div className={styles.auroraFallback} aria-hidden="true" />
        ) : (
          <LiquidEther
            colors={palette}
            mouseForce={12}
            cursorSize={80}
            resolution={performanceMode === 'balanced' ? 0.4 : 0.5}
            autoDemo={true}
            autoSpeed={playing ? 0.45 : 0.25}
            autoIntensity={playing ? 1.8 : 1.2}
            autoResumeDelay={2000}
          />
        )}
      </div>
      {/* …… Suspense/pageEnter 现有结构不动 …… */}
```

- [ ] **Step 2: eco 档 CSS 渐变霞光**

在 `src/components/Layout/AppShell.module.css` 的 `.background` 规则后追加：

```css
/* eco 档：无 WebGL 的 CSS 霞光（引用氛围变量，切歌自动跟色） */
.auroraFallback {
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(40% 50% at 20% 30%, color-mix(in srgb, var(--ambient-1) 32%, transparent), transparent 70%),
    radial-gradient(45% 55% at 80% 25%, color-mix(in srgb, var(--ambient-2) 26%, transparent), transparent 70%),
    radial-gradient(50% 60% at 55% 85%, color-mix(in srgb, var(--ambient-3) 24%, transparent), transparent 70%);
  filter: blur(40px);
  animation: auroraDrift 24s ease-in-out infinite alternate;
}

@keyframes auroraDrift {
  from { transform: translate3d(-3%, -2%, 0) rotate(-2deg) scale(1); }
  to   { transform: translate3d(3%, 2%, 0) rotate(2deg) scale(1.08); }
}
```

（reduced-motion 由 tokens.css 全局规则兜底。）

- [ ] **Step 3: App.tsx 传入互斥条件**

`src/App.tsx` 中 `useSettingsStore` 已导入。组件内加：

```tsx
const lyricsMode = useSettingsStore((s) => s.lyricsPanelMode)
```

并把 `<AppShell />` 改为：

```tsx
<AppShell backgroundHidden={lyricsOpen && lyricsMode === '3d'} />
```

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过

```bash
git add src/components/Layout/AppShell.tsx src/components/Layout/AppShell.module.css src/App.tsx
git commit -m "feat: ambient-driven background — palette colors, playback intensity, eco fallback, 3D mutual exclusion

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: ClickSpark 全局点击迸发

**Files:**
- Create: `src/components/ui/ClickSpark.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `export function ClickSpark(): JSX.Element | null` — 自足组件，挂 App 最外层即可

- [ ] **Step 1: 实现组件**

创建 `src/components/ui/ClickSpark.tsx`（参照 React Bits click-spark，无第三方依赖）：

```tsx
import { useEffect, useRef } from 'react'

interface Spark {
  x: number
  y: number
  angle: number
  start: number
}

const SPARK_COUNT = 8
const DURATION = 400
const SPARK_RADIUS = 18
const SPARK_SIZE = 8

/** 全局点击火花：单个全屏 canvas 覆盖层，颜色取 --ambient-1，reduced-motion 时禁用。 */
export function ClickSpark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const sparks: Spark[] = []
    let raf = 0
    let running = false

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const easeOut = (t: number) => t * (2 - t)

    const draw = (now: number) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const color =
        getComputedStyle(document.documentElement).getPropertyValue('--ambient-1').trim() || '#5227ff'
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        const t = (now - s.start) / DURATION
        if (t >= 1) {
          sparks.splice(i, 1)
          continue
        }
        const eased = easeOut(t)
        const dist = eased * SPARK_RADIUS
        const len = SPARK_SIZE * (1 - eased)
        const x1 = s.x + dist * Math.cos(s.angle)
        const y1 = s.y + dist * Math.sin(s.angle)
        ctx.strokeStyle = color
        ctx.globalAlpha = 1 - eased
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x1 + len * Math.cos(s.angle), y1 + len * Math.sin(s.angle))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      if (sparks.length > 0) {
        raf = requestAnimationFrame(draw)
      } else {
        running = false
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      }
    }

    const onClick = (e: MouseEvent) => {
      const now = performance.now()
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparks.push({ x: e.clientX, y: e.clientY, angle: (Math.PI * 2 * i) / SPARK_COUNT, start: now })
      }
      // 无火花时才起新 raf 循环，火花耗尽自动停，空闲零开销
      if (!running) {
        running = true
        raf = requestAnimationFrame(draw)
      }
    }
    window.addEventListener('click', onClick)

    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}
    />
  )
}
```

- [ ] **Step 2: 挂到 App**

`src/App.tsx`：import 后，在 `<LyricsPanel …/>` 下一行加 `<ClickSpark />`（`WindowChrome` 内、`styles.root` div 内最后一个子元素）。

- [ ] **Step 3: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过

```bash
git add src/components/ui/ClickSpark.tsx src/App.tsx
git commit -m "feat: add ClickSpark global click burst using ambient color

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 统一动效预设 + 应用到全局控件

**Files:**
- Create: `src/lib/motion-presets.ts`
- Modify: `src/components/Layout/TopBar.tsx`（后退按钮，约 86–95 行）
- Modify: `src/components/Layout/AvatarMenu.tsx`（sourceBtn 约 99–105 行、menuRow 约 113 行）
- Modify: `src/pages/SettingsPage.tsx`（三处 segControl 分段按钮，约 42、60、73 行）

**Interfaces:**
- Produces:
  - `export const springSnappy: Transition`、`export const springGentle: Transition`
  - `export const tapScale: { scale: number }`
  - `export const fadeRise: Variants`
  - 二期起所有卡片/列表动效复用本模块

- [ ] **Step 1: 创建预设模块**

创建 `src/lib/motion-presets.ts`：

```ts
import type { Transition, Variants } from 'motion/react'

/** 快速回弹弹簧：按钮按压、小控件。 */
export const springSnappy: Transition = { type: 'spring', stiffness: 480, damping: 30, mass: 0.7 }

/** 柔和弹簧：卡片上浮、面板入场。 */
export const springGentle: Transition = { type: 'spring', stiffness: 220, damping: 26, mass: 1 }

/** 按压反馈（配 whileTap）。 */
export const tapScale = { scale: 0.94 }

/** 入场：淡入上移（配 initial="hidden" animate="visible"）。 */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 }
}
```

- [ ] **Step 2: TopBar 后退按钮换弹簧按压**

`src/components/Layout/TopBar.tsx`：加 import：

```ts
import { motion } from 'motion/react'
import { springSnappy, tapScale } from '../../lib/motion-presets'
```

把后退按钮（86–95 行）改为：

```tsx
<motion.button
  className={styles.backBtn}
  onClick={goBack}
  disabled={history.length === 0}
  aria-label="后退"
  whileTap={tapScale}
  whileHover={{ scale: 1.06 }}
  transition={springSnappy}
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
</motion.button>
```

- [ ] **Step 3: AvatarMenu 按钮换弹簧按压**

`src/components/Layout/AvatarMenu.tsx`：加同样两个 import。把 `sourceBtn`（99–105 行）与 `menuRow`（113 行起）两处 `<button` 改为 `<motion.button`，各自追加属性 `whileTap={tapScale} transition={springSnappy}`，其余 props 原样保留（对应闭合标签改 `</motion.button>`）。

- [ ] **Step 4: SettingsPage 分段按钮换弹簧按压**

`src/pages/SettingsPage.tsx`：加同样两个 import（`motion`、`springSnappy`/`tapScale`）。页面里有三组 `styles.segControl` 分段控件（主题模式约 42 行、音源约 60 行、音质偏好约 73 行），把每组 map 里的 `<button` 改为 `<motion.button`，各追加 `whileTap={tapScale} transition={springSnappy}`，其余 props（key/className/onClick/children）原样保留，闭合标签改 `</motion.button>`。示例（主题模式组）：

```tsx
{(['auto', 'light', 'dark'] as ThemeMode[]).map((m) => (
  <motion.button
    key={m}
    className={`${styles.seg} no-drag ${themeMode === m ? styles.segActive : ''}`}
    onClick={() => setThemeMode(m)}
    whileTap={tapScale}
    transition={springSnappy}
  >
    {{ auto: '自动', light: '浅色', dark: '深色' }[m]}
  </motion.button>
))}
```

- [ ] **Step 5: 验证 + Commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过

```bash
git add src/lib/motion-presets.ts src/components/Layout/TopBar.tsx src/components/Layout/AvatarMenu.tsx src/pages/SettingsPage.tsx
git commit -m "feat: add shared motion presets, apply spring press to global controls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 全量验证 + 手动验收

**Files:** 无新改动（验证任务）

- [ ] **Step 1: 全量回归**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过（26+ tests）

- [ ] **Step 2: 手动验收（`npm run dev` 启动 Electron）**

核对清单：

1. 播放一首封面鲜艳的歌 → 背景霞光在约 800ms 内平滑变为封面色系（无黑闪、无重建卡顿）
2. 切到另一首不同色系的歌 → 氛围色再次平滑过渡
3. 暂停播放 → 背景流动明显放缓；恢复播放 → 加快
4. 设置切到 eco 性能档 → 背景变为 CSS 渐变霞光（缓慢漂移，仍跟封面色）
5. 打开歌词页切 3D 模式 → 主背景层隐藏（DevTools 确认 `display: none`）；关闭后恢复
6. 任意位置点击 → 出现 8 条氛围色火花，约 400ms 消散
7. TopBar 后退按钮 / AvatarMenu 按钮按压有弹簧回弹
8. 系统切浅色模式 → 辉光明显减弱、无刺眼
9. 系统开启「减弱动态效果」→ 火花与漂移动画禁用

- [ ] **Step 3: 记录验收结果**

有问题回到对应任务修复后重跑本任务；全部通过则第一期完成。
