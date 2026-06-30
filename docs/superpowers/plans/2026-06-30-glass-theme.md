# Glass Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将应用从蓝色主题切换为黑白灰单色玻璃风格，统一 backdrop-filter 层级，TopBar 透明化，大卡片加 BorderGlow 鼠标追踪发光，并修复粒子/音频分析在非 3D 模式下未停止的问题。

**Architecture:** 以 `tokens.css` 为单一变更点——色彩 token 和 glass blur token 全部在此定义，组件 CSS 只引用 token。`GlassPanel` 升级为三层 level 系统，是唯一写 `backdrop-filter` 的基础组件。BorderGlow 是新增的独立组件，仅包裹三处大卡片。

**Tech Stack:** React + TypeScript, CSS Modules, electron-vite, Vitest (`npm run test`), TypeScript check (`npm run typecheck`)

## Global Constraints

- 所有 `backdrop-filter` 必须从三个 token 之一取值：`var(--glass-blur-base)` / `var(--glass-blur-card)` / `var(--glass-blur-modal)`，禁止在组件 CSS 中写硬编码 blur 值
- 蓝色值 `#4a90d9`、`#5da3f0`、`#6ea8ff`、`#4a90d9`、`rgba(20,30,55,...)` 全部消除
- BorderGlow 的 JS mousemove 仅挂在 `PlaylistCard`、`ShelfCard`、`HeroBanner` 三处，其余交互元素用纯 CSS
- 深色模式为主，浅色模式对称调整

---

## File Map

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/styles/tokens.css` | 修改 | 色彩 + glass blur token 全量替换 |
| `src/styles/global.css` | 修改 | 根背景色 #0c0c0c |
| `src/components/ui/GlassPanel.tsx` | 修改 | 新增 `level` prop |
| `src/components/ui/GlassPanel.module.css` | 修改 | 三层 `.base` `.card` `.modal` class |
| `src/components/Layout/TopBar.module.css` | 修改 | 去掉 bg + border-bottom，Tab 激活改白色 |
| `src/components/Layout/AppShell.module.css` | 修改 | loading 背景 → #0c0c0c |
| `src/components/Layout/AvatarMenu.module.css` | 修改 | 菜单用 glass-card token |
| `src/components/Search/SearchBar.module.css` | 修改 | backdrop-filter → var(--glass-blur-card) |
| `src/components/Settings/SettingsPanel.module.css` | 修改 | backdrop-filter → var(--glass-blur-modal) |
| `src/components/Shelf/ShelfDetail.module.css` | 修改 | backdrop-filter → var(--glass-blur-card) |
| `src/pages/LibraryPage.module.css` | 修改 | backdrop-filter → var(--glass-blur-base) |
| `src/pages/SettingsPage.module.css` | 修改 | backdrop-filter → var(--glass-blur-base) |
| `src/pages/ArtistPage.module.css` | 修改 | backdrop-filter → var(--glass-blur-base) |
| `src/components/ui/Slider.module.css` | 修改 | 滑块 + 进度条改白色 |
| `src/components/ui/Toggle.module.css` | 修改 | 开关开启态改白色 |
| `src/components/Player/PlayerBar.module.css` | 修改 | 播放按钮改白色玻璃 |
| `src/components/BorderGlow/BorderGlow.tsx` | 新建 | BorderGlow 组件 |
| `src/components/BorderGlow/BorderGlow.css` | 新建 | BorderGlow 样式 |
| `src/components/Explore/PlaylistCard.tsx` | 修改 | 包裹 BorderGlow |
| `src/components/Shelf/ShelfCard.tsx` | 修改 | 包裹 BorderGlow |
| `src/components/Explore/HeroBanner.tsx` | 修改 | 包裹 BorderGlow |
| `src/components/Lyrics/LyricsPanel.tsx` | 修改 | Canvas dpr + antialias 参数降级 |
| `src/components/Visualizer/Scene.tsx` | 修改 | Canvas dpr + antialias 参数降级 |

---

## Task 1: Token & Global Base

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: `--sm-accent`, `--sm-bg-base/elevated/overlay`, `--sm-text-primary/secondary`, `--sm-border`, `--glass-blur-base/card/modal` — 所有后续任务依赖这些 token

- [ ] **Step 1: 替换 tokens.css 全量内容**

将 `src/styles/tokens.css` 改为：

```css
/* ── 深色模式（主） ── */
:root {
  --sm-bg-base:        #0c0c0c;
  --sm-bg-elevated:    rgba(255, 255, 255, 0.06);
  --sm-bg-overlay:     rgba(255, 255, 255, 0.10);
  --sm-accent:         rgba(255, 255, 255, 0.92);
  --sm-accent-warm:    rgba(255, 255, 255, 0.70);
  --sm-text-primary:   rgba(255, 255, 255, 0.92);
  --sm-text-secondary: rgba(255, 255, 255, 0.45);
  --sm-border:         rgba(255, 255, 255, 0.10);
  --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.60);
  --sm-blur:           blur(12px);
  --sm-radius-card:    16px;
  --sm-radius-pill:    999px;
  --sm-ease-out:       cubic-bezier(0.16, 1, 0.3, 1);
  --sm-ease-in-out:    cubic-bezier(0.4, 0, 0.2, 1);
  --sm-text-on-accent: #0c0c0c;

  /* Glass 层级 */
  --glass-blur-base:   blur(12px);
  --glass-blur-card:   blur(18px);
  --glass-blur-modal:  blur(32px);
  --glass-bg-base:     rgba(255, 255, 255, 0.06);
  --glass-bg-card:     rgba(255, 255, 255, 0.08);
  --glass-bg-modal:    rgba(0, 0, 0, 0.55);
  --glass-border-base: rgba(255, 255, 255, 0.10);
  --glass-border-card: rgba(255, 255, 255, 0.12);
  --glass-border-modal:rgba(255, 255, 255, 0.08);
}

/* ── 浅色模式 ── */
@media (prefers-color-scheme: light) {
  :root {
    --sm-bg-base:        #f0f0f0;
    --sm-bg-elevated:    rgba(255, 255, 255, 0.72);
    --sm-bg-overlay:     rgba(255, 255, 255, 0.88);
    --sm-accent:         rgba(0, 0, 0, 0.85);
    --sm-accent-warm:    rgba(0, 0, 0, 0.60);
    --sm-text-primary:   rgba(0, 0, 0, 0.90);
    --sm-text-secondary: rgba(0, 0, 0, 0.45);
    --sm-border:         rgba(0, 0, 0, 0.10);
    --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.12);
    --sm-text-on-accent: #ffffff;
    --glass-bg-base:     rgba(255, 255, 255, 0.50);
    --glass-bg-card:     rgba(255, 255, 255, 0.65);
    --glass-bg-modal:    rgba(240, 240, 240, 0.80);
    --glass-border-base: rgba(0, 0, 0, 0.08);
    --glass-border-card: rgba(0, 0, 0, 0.10);
    --glass-border-modal:rgba(0, 0, 0, 0.06);
  }
}

/* ── 手动 theme 覆盖 ── */
[data-theme="light"] {
  --sm-bg-base:        #f0f0f0;
  --sm-bg-elevated:    rgba(255, 255, 255, 0.72);
  --sm-bg-overlay:     rgba(255, 255, 255, 0.88);
  --sm-accent:         rgba(0, 0, 0, 0.85);
  --sm-accent-warm:    rgba(0, 0, 0, 0.60);
  --sm-text-primary:   rgba(0, 0, 0, 0.90);
  --sm-text-secondary: rgba(0, 0, 0, 0.45);
  --sm-border:         rgba(0, 0, 0, 0.10);
  --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.12);
  --sm-text-on-accent: #ffffff;
  --glass-bg-base:     rgba(255, 255, 255, 0.50);
  --glass-bg-card:     rgba(255, 255, 255, 0.65);
  --glass-bg-modal:    rgba(240, 240, 240, 0.80);
  --glass-border-base: rgba(0, 0, 0, 0.08);
  --glass-border-card: rgba(0, 0, 0, 0.10);
  --glass-border-modal:rgba(0, 0, 0, 0.06);
}

[data-theme="dark"] {
  --sm-bg-base:        #0c0c0c;
  --sm-bg-elevated:    rgba(255, 255, 255, 0.06);
  --sm-bg-overlay:     rgba(255, 255, 255, 0.10);
  --sm-accent:         rgba(255, 255, 255, 0.92);
  --sm-accent-warm:    rgba(255, 255, 255, 0.70);
  --sm-text-primary:   rgba(255, 255, 255, 0.92);
  --sm-text-secondary: rgba(255, 255, 255, 0.45);
  --sm-border:         rgba(255, 255, 255, 0.10);
  --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.60);
  --sm-text-on-accent: #0c0c0c;
  --glass-bg-base:     rgba(255, 255, 255, 0.06);
  --glass-bg-card:     rgba(255, 255, 255, 0.08);
  --glass-bg-modal:    rgba(0, 0, 0, 0.55);
  --glass-border-base: rgba(255, 255, 255, 0.10);
  --glass-border-card: rgba(255, 255, 255, 0.12);
  --glass-border-modal:rgba(255, 255, 255, 0.08);
}

/* ── 无障碍：去除动画 ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: 更新 global.css 根背景色**

将 `src/styles/global.css` 中的 `body` 规则改为：

```css
body {
  font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: var(--sm-text-primary);
  background: #0c0c0c;
  overflow: hidden;
  transition: background 350ms var(--sm-ease-in-out), color 200ms var(--sm-ease-in-out);
}
```

- [ ] **Step 3: TypeScript 类型检查**

```bash
npm run typecheck
```

期望：无报错（此阶段只改 CSS，不涉及 TS）

- [ ] **Step 4: 提交**

```bash
git add src/styles/tokens.css src/styles/global.css
git commit -m "feat(theme): replace blue accent with monochrome glass tokens"
```

---

## Task 2: GlassPanel 三层升级

**Files:**
- Modify: `src/components/ui/GlassPanel.tsx`
- Modify: `src/components/ui/GlassPanel.module.css`

**Interfaces:**
- Consumes: `--glass-blur-base/card/modal`, `--glass-bg-base/card/modal`, `--glass-border-base/card/modal` from Task 1
- Produces: `GlassPanel` with `level?: 'base' | 'card' | 'modal'` prop，默认 `'base'`

- [ ] **Step 1: 更新 GlassPanel.tsx**

将 `src/components/ui/GlassPanel.tsx` 完整替换为：

```tsx
import type { CSSProperties, ReactNode } from 'react'
import styles from './GlassPanel.module.css'

type GlassLevel = 'base' | 'card' | 'modal'

interface GlassPanelProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  level?: GlassLevel
}

export function GlassPanel({ children, className, style, level = 'base' }: GlassPanelProps) {
  const cls = [styles.panel, styles[level], className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: 更新 GlassPanel.module.css**

将 `src/components/ui/GlassPanel.module.css` 完整替换为：

```css
.panel {
  border-radius: 16px;
  border: 1px solid var(--glass-border-base);
}

.base {
  background: var(--glass-bg-base);
  backdrop-filter: var(--glass-blur-base) saturate(120%);
  -webkit-backdrop-filter: var(--glass-blur-base) saturate(120%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.30);
}

.card {
  background: var(--glass-bg-card);
  border-color: var(--glass-border-card);
  backdrop-filter: var(--glass-blur-card) saturate(130%);
  -webkit-backdrop-filter: var(--glass-blur-card) saturate(130%);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.modal {
  background: var(--glass-bg-modal);
  border-color: var(--glass-border-modal);
  backdrop-filter: var(--glass-blur-modal) saturate(110%);
  -webkit-backdrop-filter: var(--glass-blur-modal) saturate(110%);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.50);
}
```

- [ ] **Step 3: 更新 SettingsPanel.tsx 的 GlassPanel 调用**

打开 `src/components/Settings/SettingsPanel.tsx`，找到 `<GlassPanel` 调用，加上 `level="modal"`：

```tsx
<GlassPanel level="modal" className={...}>
```

- [ ] **Step 4: 更新 ShelfDetail.tsx 的 GlassPanel 调用**

打开 `src/components/Shelf/ShelfDetail.tsx`，找到 `<GlassPanel` 调用，加上 `level="card"`：

```tsx
<GlassPanel level="card" className={...}>
```

- [ ] **Step 5: TypeScript 检查**

```bash
npm run typecheck
```

期望：无报错

- [ ] **Step 6: 提交**

```bash
git add src/components/ui/GlassPanel.tsx src/components/ui/GlassPanel.module.css \
  src/components/Settings/SettingsPanel.tsx src/components/Shelf/ShelfDetail.tsx
git commit -m "feat(glass): upgrade GlassPanel to three-level system (base/card/modal)"
```

---

## Task 3: 分散 backdrop-filter 统一 + TopBar 透明化

**Files:**
- Modify: `src/components/Layout/TopBar.module.css`
- Modify: `src/components/Layout/AppShell.module.css`
- Modify: `src/components/Layout/AvatarMenu.module.css`
- Modify: `src/components/Search/SearchBar.module.css`
- Modify: `src/components/Settings/SettingsPanel.module.css`
- Modify: `src/components/Shelf/ShelfDetail.module.css`
- Modify: `src/pages/LibraryPage.module.css`
- Modify: `src/pages/SettingsPage.module.css`
- Modify: `src/pages/ArtistPage.module.css`

**Interfaces:**
- Consumes: glass token 来自 Task 1

- [ ] **Step 1: TopBar 透明化**

在 `src/components/Layout/TopBar.module.css` 中，将 `.bar` 规则改为：

```css
.bar {
  display: flex;
  align-items: center;
  height: 44px;
  flex-shrink: 0;
  padding: 0 12px 0 80px;
  background: transparent;
  border-bottom: none;
  position: relative;
  z-index: 100;
  -webkit-app-region: drag;
}
```

同文件中，将 `.tabActive` 改为白色指示线，替换蓝色：

```css
.tabActive {
  color: var(--sm-text-primary);
  font-weight: 600;
  position: relative;
}

.tabActive::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 2px;
  border-radius: 999px;
  background: var(--sm-accent);
}
```

将 `.searchForm:focus-within` 的 `border-color` 改为：

```css
.searchForm:focus-within {
  width: 240px;
  border-color: var(--glass-border-card);
}
```

- [ ] **Step 2: AppShell loading 背景**

在 `src/components/Layout/AppShell.module.css` 中，将 `.loading` 改为：

```css
.loading {
  width: 100%;
  height: 100%;
  background: #0c0c0c;
}
```

- [ ] **Step 3: AvatarMenu 用 glass-card token**

在 `src/components/Layout/AvatarMenu.module.css` 中，将 `.menu` 改为：

```css
.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 220px;
  background: var(--glass-bg-card);
  border: 1px solid var(--glass-border-card);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.40);
  backdrop-filter: var(--glass-blur-card);
  -webkit-backdrop-filter: var(--glass-blur-card);
  z-index: 500;
  overflow: hidden;
  padding: 6px 0;
}
```

- [ ] **Step 4: SearchBar backdrop-filter 换 token**

在 `src/components/Search/SearchBar.module.css` 中，找到含 `backdrop-filter: blur(34px)` 的规则，将 backdrop-filter 改为：

```css
backdrop-filter: var(--glass-blur-card) saturate(130%);
-webkit-backdrop-filter: var(--glass-blur-card) saturate(130%);
```

- [ ] **Step 5: SettingsPanel.module.css backdrop-filter 换 token**

在 `src/components/Settings/SettingsPanel.module.css` 中，将 `backdrop-filter: blur(2px)` 改为：

```css
backdrop-filter: var(--glass-blur-modal);
-webkit-backdrop-filter: var(--glass-blur-modal);
```

- [ ] **Step 6: ShelfDetail.module.css backdrop-filter 换 token**

在 `src/components/Shelf/ShelfDetail.module.css` 中，将 `backdrop-filter: blur(4px)` 改为：

```css
backdrop-filter: var(--glass-blur-card);
-webkit-backdrop-filter: var(--glass-blur-card);
```

- [ ] **Step 7: Page 层 backdrop-filter 换 token**

`src/pages/LibraryPage.module.css`、`src/pages/SettingsPage.module.css`、`src/pages/ArtistPage.module.css` 中均有 `backdrop-filter: var(--sm-blur)`，全部替换为：

```css
backdrop-filter: var(--glass-blur-base);
-webkit-backdrop-filter: var(--glass-blur-base);
```

（三个文件各操作一次，搜索 `var(--sm-blur)` 替换）

- [ ] **Step 8: TypeScript 检查**

```bash
npm run typecheck
```

期望：无报错

- [ ] **Step 9: 提交**

```bash
git add \
  src/components/Layout/TopBar.module.css \
  src/components/Layout/AppShell.module.css \
  src/components/Layout/AvatarMenu.module.css \
  src/components/Search/SearchBar.module.css \
  src/components/Settings/SettingsPanel.module.css \
  src/components/Shelf/ShelfDetail.module.css \
  src/pages/LibraryPage.module.css \
  src/pages/SettingsPage.module.css \
  src/pages/ArtistPage.module.css
git commit -m "feat(glass): unify backdrop-filter to glass tokens, transparent TopBar"
```

---

## Task 4: 交互元素白色玻璃

**Files:**
- Modify: `src/components/ui/Slider.module.css`
- Modify: `src/components/ui/Toggle.module.css`
- Modify: `src/components/Player/PlayerBar.module.css`

**Interfaces:**
- Consumes: `--sm-accent`, `--sm-text-on-accent` from Task 1

- [ ] **Step 1: Slider 滑块换白色**

将 `src/components/ui/Slider.module.css` 完整替换为：

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
}

.label { opacity: 0.78; }

.value {
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  cursor: pointer;
}

.range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--sm-accent);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.50);
}
```

- [ ] **Step 2: Toggle 开关换白色**

将 `src/components/ui/Toggle.module.css` 完整替换为：

```css
.wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.label { opacity: 0.82; }

.track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
  transition: background 0.2s ease;
  padding: 0;
}

.on { background: rgba(255, 255, 255, 0.88); }

.thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.30);
}

.on .thumb {
  transform: translateX(18px);
  background: #1a1a1a;
}

.disabled {
  opacity: 0.4;
  pointer-events: none;
}
```

- [ ] **Step 3: PlayerBar 播放按钮换白色玻璃**

在 `src/components/Player/PlayerBar.module.css` 中，将 `.playBtn` 和 `.playBtn:hover` 改为：

```css
.playBtn {
  width: 46px;
  height: 46px;
  background: rgba(255, 255, 255, 0.92);
  color: #0c0c0c;
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.30), 0 4px 12px rgba(0, 0, 0, 0.20);
  border: 1px solid rgba(255, 255, 255, 0.20);
}

.playBtn:hover {
  background: #ffffff;
  color: #0c0c0c;
  filter: none;
  box-shadow: 0 0 22px rgba(255, 255, 255, 0.40), 0 4px 14px rgba(0, 0, 0, 0.25);
}
```

同文件中，将 `.btn:hover` 改为：

```css
.btn:hover {
  color: rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.10);
  border-radius: 50%;
}
```

- [ ] **Step 4: TypeScript 检查**

```bash
npm run typecheck
```

期望：无报错

- [ ] **Step 5: 提交**

```bash
git add \
  src/components/ui/Slider.module.css \
  src/components/ui/Toggle.module.css \
  src/components/Player/PlayerBar.module.css
git commit -m "feat(glass): replace blue interactive accents with white glass style"
```

---

## Task 5: BorderGlow 组件

**Files:**
- Create: `src/components/BorderGlow/BorderGlow.tsx`
- Create: `src/components/BorderGlow/BorderGlow.css`

**Interfaces:**
- Produces: `<BorderGlow>` 组件，props 见下方。Task 6 直接 import 并使用。

```ts
interface BorderGlowProps {
  children: ReactNode
  className?: string
  glowColor?: string        // HSL 格式 "H S L"，默认 "0 0 95"（近白）
  backgroundColor?: string  // 默认 "rgba(255,255,255,0.05)"
  borderRadius?: number     // 默认 16
  glowRadius?: number       // 默认 40
  glowIntensity?: number    // 默认 0.7
  coneSpread?: number       // 默认 30
  edgeSensitivity?: number  // 默认 35
  colors?: string[]         // 默认 ['#ffffff', '#cccccc', '#888888']
  fillOpacity?: number      // 默认 0.35
}
```

- [ ] **Step 1: 创建 BorderGlow.css**

创建 `src/components/BorderGlow/BorderGlow.css`，内容：

```css
.border-glow-card {
  --edge-proximity: 0;
  --cursor-angle: 45deg;
  --edge-sensitivity: 35;
  --color-sensitivity: calc(var(--edge-sensitivity) + 20);
  --border-radius: 16px;
  --glow-padding: 40px;
  --cone-spread: 30;

  position: relative;
  border-radius: var(--border-radius);
  isolation: isolate;
  transform: translate3d(0, 0, 0.01px);
  display: grid;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: var(--card-bg, rgba(255, 255, 255, 0.05));
  overflow: visible;
  box-shadow:
    rgba(0, 0, 0, 0.12) 0px 1px 2px,
    rgba(0, 0, 0, 0.12) 0px 4px 8px,
    rgba(0, 0, 0, 0.12) 0px 16px 32px;
}

.border-glow-card::before,
.border-glow-card::after,
.border-glow-card > .edge-light {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  transition: opacity 0.25s ease-out;
  z-index: -1;
}

.border-glow-card:not(:hover)::before,
.border-glow-card:not(:hover)::after,
.border-glow-card:not(:hover) > .edge-light {
  opacity: 0;
  transition: opacity 0.75s ease-in-out;
}

.border-glow-card::before {
  border: 1px solid transparent;
  background:
    linear-gradient(var(--card-bg, rgba(255,255,255,0.05)) 0 100%) padding-box,
    linear-gradient(rgba(255,255,255,0%) 0% 100%) border-box,
    var(--gradient-one) border-box,
    var(--gradient-two) border-box,
    var(--gradient-three) border-box,
    var(--gradient-four) border-box,
    var(--gradient-five) border-box,
    var(--gradient-six) border-box,
    var(--gradient-seven) border-box,
    var(--gradient-base) border-box;

  opacity: calc((var(--edge-proximity) - var(--color-sensitivity)) / (100 - var(--color-sensitivity)));

  mask-image: conic-gradient(
    from var(--cursor-angle) at center,
    black calc(var(--cone-spread) * 1%),
    transparent calc((var(--cone-spread) + 15) * 1%),
    transparent calc((100 - var(--cone-spread) - 15) * 1%),
    black calc((100 - var(--cone-spread)) * 1%)
  );
}

.border-glow-card::after {
  border: 1px solid transparent;
  background:
    var(--gradient-one) padding-box,
    var(--gradient-two) padding-box,
    var(--gradient-three) padding-box,
    var(--gradient-four) padding-box,
    var(--gradient-five) padding-box,
    var(--gradient-six) padding-box,
    var(--gradient-seven) padding-box,
    var(--gradient-base) padding-box;

  mask-image:
    linear-gradient(to bottom, black, black),
    radial-gradient(ellipse at 50% 50%, black 40%, transparent 65%),
    radial-gradient(ellipse at 66% 66%, black 5%, transparent 40%),
    radial-gradient(ellipse at 33% 33%, black 5%, transparent 40%),
    radial-gradient(ellipse at 66% 33%, black 5%, transparent 40%),
    radial-gradient(ellipse at 33% 66%, black 5%, transparent 40%),
    conic-gradient(from var(--cursor-angle) at center, transparent 5%, black 15%, black 85%, transparent 95%);

  mask-composite: subtract, add, add, add, add, add;
  opacity: calc(var(--fill-opacity, 0.35) * (var(--edge-proximity) - var(--color-sensitivity)) / (100 - var(--color-sensitivity)));
  mix-blend-mode: soft-light;
}

.border-glow-card > .edge-light {
  inset: calc(var(--glow-padding) * -1);
  pointer-events: none;
  z-index: 1;

  mask-image: conic-gradient(
    from var(--cursor-angle) at center,
    black 2.5%, transparent 10%, transparent 90%, black 97.5%
  );

  opacity: calc((var(--edge-proximity) - var(--edge-sensitivity)) / (100 - var(--edge-sensitivity)));
  mix-blend-mode: plus-lighter;
}

.border-glow-card > .edge-light::before {
  content: "";
  position: absolute;
  inset: var(--glow-padding);
  border-radius: inherit;
  box-shadow:
    inset 0 0 0 1px var(--glow-color, hsl(0deg 0% 95% / 100%)),
    inset 0 0 1px 0 var(--glow-color-60, hsl(0deg 0% 95% / 60%)),
    inset 0 0 3px 0 var(--glow-color-50, hsl(0deg 0% 95% / 50%)),
    inset 0 0 6px 0 var(--glow-color-40, hsl(0deg 0% 95% / 40%)),
    inset 0 0 15px 0 var(--glow-color-30, hsl(0deg 0% 95% / 30%)),
    inset 0 0 25px 2px var(--glow-color-20, hsl(0deg 0% 95% / 20%)),
    inset 0 0 50px 2px var(--glow-color-10, hsl(0deg 0% 95% / 10%)),
    0 0 1px 0 var(--glow-color-60),
    0 0 3px 0 var(--glow-color-50),
    0 0 6px 0 var(--glow-color-40),
    0 0 15px 0 var(--glow-color-30),
    0 0 25px 2px var(--glow-color-20),
    0 0 50px 2px var(--glow-color-10);
}

.border-glow-inner {
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: auto;
  z-index: 1;
}
```

- [ ] **Step 2: 创建 BorderGlow.tsx**

创建 `src/components/BorderGlow/BorderGlow.tsx`：

```tsx
import { useRef, useCallback, useEffect, type ReactNode } from 'react'
import './BorderGlow.css'

const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%']
const GRADIENT_KEYS = ['--gradient-one','--gradient-two','--gradient-three','--gradient-four','--gradient-five','--gradient-six','--gradient-seven']
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1]

function parseHSL(hslStr: string) {
  const m = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/)
  if (!m) return { h: 0, s: 0, l: 95 }
  return { h: parseFloat(m[1]), s: parseFloat(m[2]), l: parseFloat(m[3]) }
}

function buildGlowVars(glowColor: string, intensity: number): Record<string, string> {
  const { h, s, l } = parseHSL(glowColor)
  const base = `${h}deg ${s}% ${l}%`
  const opacities = [100, 60, 50, 40, 30, 20, 10]
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10']
  const vars: Record<string, string> = {}
  for (let i = 0; i < opacities.length; i++) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`
  }
  return vars
}

function buildGradientVars(colors: string[]): Record<string, string> {
  const vars: Record<string, string> = {}
  for (let i = 0; i < 7; i++) {
    const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)]
    vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`
  }
  vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`
  return vars
}

interface BorderGlowProps {
  children: ReactNode
  className?: string
  glowColor?: string
  backgroundColor?: string
  borderRadius?: number
  glowRadius?: number
  glowIntensity?: number
  coneSpread?: number
  edgeSensitivity?: number
  colors?: string[]
  fillOpacity?: number
}

export function BorderGlow({
  children,
  className = '',
  glowColor = '0 0 95',
  backgroundColor = 'rgba(255,255,255,0.05)',
  borderRadius = 16,
  glowRadius = 40,
  glowIntensity = 0.7,
  coneSpread = 30,
  edgeSensitivity = 35,
  colors = ['#ffffff', '#cccccc', '#888888'],
  fillOpacity = 0.35,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const activeRef = useRef(false)

  const getCenter = useCallback((el: HTMLDivElement) => {
    const { width, height } = el.getBoundingClientRect()
    return [width / 2, height / 2]
  }, [])

  const getEdgeProximity = useCallback((el: HTMLDivElement, x: number, y: number) => {
    const [cx, cy] = getCenter(el)
    const dx = x - cx, dy = y - cy
    let kx = Infinity, ky = Infinity
    if (dx !== 0) kx = cx / Math.abs(dx)
    if (dy !== 0) ky = cy / Math.abs(dy)
    return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1)
  }, [getCenter])

  const getCursorAngle = useCallback((el: HTMLDivElement, x: number, y: number) => {
    const [cx, cy] = getCenter(el)
    const dx = x - cx, dy = y - cy
    if (dx === 0 && dy === 0) return 0
    let deg = Math.atan2(dy, dx) * (180 / Math.PI) + 90
    if (deg < 0) deg += 360
    return deg
  }, [getCenter])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!activeRef.current) return
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const card = cardRef.current
      if (!card) return
      const rect = card.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      card.style.setProperty('--edge-proximity', `${(getEdgeProximity(card, x, y) * 100).toFixed(3)}`)
      card.style.setProperty('--cursor-angle', `${getCursorAngle(card, x, y).toFixed(3)}deg`)
    })
  }, [getEdgeProximity, getCursorAngle])

  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    observerRef.current = new IntersectionObserver(([entry]) => {
      activeRef.current = entry.isIntersecting
    }, { threshold: 0 })
    observerRef.current.observe(card)

    card.addEventListener('pointermove', handlePointerMove)
    return () => {
      card.removeEventListener('pointermove', handlePointerMove)
      observerRef.current?.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [handlePointerMove])

  const glowVars = buildGlowVars(glowColor, glowIntensity)
  const gradVars = buildGradientVars(colors)

  return (
    <div
      ref={cardRef}
      className={`border-glow-card ${className}`}
      style={{
        '--card-bg': backgroundColor,
        '--edge-sensitivity': edgeSensitivity,
        '--border-radius': `${borderRadius}px`,
        '--glow-padding': `${glowRadius}px`,
        '--cone-spread': coneSpread,
        '--fill-opacity': fillOpacity,
        ...glowVars,
        ...gradVars,
      } as React.CSSProperties}
    >
      <span className="edge-light" />
      <div className="border-glow-inner">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

```bash
npm run typecheck
```

期望：无报错

- [ ] **Step 4: 提交**

```bash
git add src/components/BorderGlow/
git commit -m "feat(glass): add BorderGlow component with IntersectionObserver throttle"
```

---

## Task 6: 卡片 BorderGlow 集成

**Files:**
- Modify: `src/components/Explore/PlaylistCard.tsx`
- Modify: `src/components/Shelf/ShelfCard.tsx`
- Modify: `src/components/Explore/HeroBanner.tsx`

**Interfaces:**
- Consumes: `BorderGlow` from Task 5，`import { BorderGlow } from '../BorderGlow/BorderGlow'`

- [ ] **Step 1: PlaylistCard 包裹 BorderGlow**

将 `src/components/Explore/PlaylistCard.tsx` 完整替换为：

```tsx
import { BorderGlow } from '../BorderGlow/BorderGlow'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistCard.module.css'

interface PlaylistCardProps {
  playlist: Playlist
  onClick(): void
}

export function PlaylistCard({ playlist, onClick }: PlaylistCardProps) {
  return (
    <BorderGlow borderRadius={16} className={styles.glowWrap}>
      <button className={`${styles.card} no-drag`} onClick={onClick}>
        <div className={styles.coverWrap}>
          {playlist.cover
            ? <img className={styles.cover} src={playlist.cover} alt="" loading="lazy" />
            : <div className={styles.coverFallback} />}
        </div>
        <p className={styles.name}>{playlist.name}</p>
        <p className={styles.meta}>{playlist.trackCount} 首</p>
      </button>
    </BorderGlow>
  )
}
```

在 `src/components/Explore/PlaylistCard.module.css` 末尾追加：

```css
.glowWrap {
  width: 160px;
  flex-shrink: 0;
}
```

- [ ] **Step 2: ShelfCard 包裹 BorderGlow**

将 `src/components/Shelf/ShelfCard.tsx` 的 return 改为：

```tsx
import { BorderGlow } from '../BorderGlow/BorderGlow'
import type { Playlist } from '../../types/domain'
import styles from './ShelfCard.module.css'

interface ShelfCardProps {
  playlist: Playlist
  onOpen: () => void
}

export function ShelfCard({ playlist, onOpen }: ShelfCardProps) {
  return (
    <BorderGlow borderRadius={12} glowRadius={32}>
      <button
        type="button"
        className={`${styles.card} no-drag`}
        onClick={onOpen}
        title={playlist.name}
      >
        <span className={styles.coverWrap}>
          {playlist.cover ? (
            <img className={styles.cover} src={playlist.cover} alt="" loading="lazy" />
          ) : (
            <span className={styles.cover} aria-hidden="true" />
          )}
          <span className={styles.spine} aria-hidden="true" />
          <span className={styles.gloss} aria-hidden="true" />
        </span>
        <span className={styles.meta}>
          <span className={styles.name}>{playlist.name}</span>
          <span className={styles.count}>{playlist.trackCount} 首</span>
        </span>
      </button>
    </BorderGlow>
  )
}
```

- [ ] **Step 3: HeroBanner 包裹 BorderGlow**

打开 `src/components/Explore/HeroBanner.tsx`，在 return 语句最外层 `<div className={styles.hero}>` 外包一层 BorderGlow：

```tsx
return (
  <BorderGlow borderRadius={0} glowRadius={60} glowIntensity={0.5} edgeSensitivity={20}>
    <div className={styles.hero}>
      {/* 原有内容不变 */}
    </div>
  </BorderGlow>
)
```

同时在文件顶部加 import：

```tsx
import { BorderGlow } from '../BorderGlow/BorderGlow'
```

- [ ] **Step 4: TypeScript 检查**

```bash
npm run typecheck
```

期望：无报错

- [ ] **Step 5: 提交**

```bash
git add \
  src/components/Explore/PlaylistCard.tsx \
  src/components/Explore/PlaylistCard.module.css \
  src/components/Shelf/ShelfCard.tsx \
  src/components/Explore/HeroBanner.tsx
git commit -m "feat(glass): wrap PlaylistCard, ShelfCard, HeroBanner with BorderGlow"
```

---

## Task 7: 性能修复

**Files:**
- Modify: `src/components/Lyrics/LyricsPanel.tsx`
- Modify: `src/components/Visualizer/Scene.tsx`

**Interfaces:**
- 无跨任务接口，独立修改

- [ ] **Step 1: LyricsPanel Canvas 参数降级**

打开 `src/components/Lyrics/LyricsPanel.tsx`，找到 `<Canvas` 元素（约第 177 行），将参数改为：

```tsx
<Canvas
  camera={{ position: [0, 0, 14], fov: 60 }}
  dpr={[1, 1.5]}
  gl={{ antialias: false, alpha: true }}
  style={{ background: backgroundColor || '#04060c' }}
>
```

（将 `dpr={[1, 2]}` 改为 `[1, 1.5]`，`antialias: true` 改为 `false`）

- [ ] **Step 2: Scene.tsx Canvas 参数降级**

打开 `src/components/Visualizer/Scene.tsx`，将 `<Canvas` 行改为：

```tsx
<Canvas camera={{ position: [0, 0, 14], fov: 60 }} dpr={[1, 1.5]} gl={{ antialias: false, alpha: true }}>
```

- [ ] **Step 3: TypeScript 检查**

```bash
npm run typecheck
```

期望：无报错

- [ ] **Step 4: 提交**

```bash
git add src/components/Lyrics/LyricsPanel.tsx src/components/Visualizer/Scene.tsx
git commit -m "perf: lower Canvas dpr to 1.5 and disable antialias to reduce GPU load"
```

---

## 验收清单

运行 `npm run dev`，打开应用检查：

- [ ] 应用内无任何蓝色元素（播放按钮、Tab 激活、Slider、Toggle 全为白色/灰色）
- [ ] TopBar 与主内容区无明显分界线
- [ ] 鼠标移近 PlaylistCard / ShelfCard / HeroBanner 时出现白色边缘发光
- [ ] 打开歌词面板 → 切换到「普通歌词」模式 → Activity Monitor 中 GPU 占用下降
- [ ] `npm run typecheck` 零错误
