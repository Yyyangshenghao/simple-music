# Left Module Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将顶部 TitleBar 导航重构为左侧模块化交互区（52px 图标条 + hover 向右展开 panel），每模块独立，全程 GSAP 动画，同步修复 PlayerBar 遮挡内容的 bug。

**Architecture:** App.tsx 改为纵向 flex（content-row + PlayerBar 兄弟节点），content-row 横向 flex（LeftStrip 52px + AppShell flex:1）。LeftStrip 内 4 个模块各自管理自己的展开 panel，panel 用 GSAP expo.out 动画从左侧图标右边缘弹出，overlay 于主内容区之上。NavModule 内部使用改编的 FlowingMenu（纯文字跑马灯，无图片）。

**Tech Stack:** React, TypeScript, CSS Modules, GSAP 3.15（已安装）, Zustand

## Global Constraints

- 不引入新依赖（gsap 已存在，不安装 @gsap/react，用 useEffect + gsap 直接操作）
- CSS 变量全部使用已有 `--sm-*` tokens（见 `src/styles/tokens.css`）
- 所有可点击元素加 `no-drag` class（Electron drag region）
- `desktop-shell` class 保留用于 `-webkit-app-region: drag`
- TypeScript strict，不使用 `any`
- 不修改 stores（navigation / player / playlist / settings）
- 不修改 PlayerBar.tsx 的内部逻辑，只修改其外层容器 PlayerGlass

---

## File Map

| 状态 | 文件 | 职责 |
|------|------|------|
| **修改** | `src/App.tsx` | 移除 TitleBar，新增 content-row wrapper |
| **修改** | `src/App.module.css` | 新增 `.content` flex-row 样式 |
| **修改** | `src/components/Player/PlayerGlass.tsx` | 从 `position:fixed` 改为 `position:relative` |
| **修改** | `src/components/Player/PlayerGlass.module.css` | 删除 fixed 定位样式，改为 inline 样式 |
| **修改** | `src/components/Layout/AppShell.tsx` | 无变动（AppShell 自身 flex:1 已够用） |
| **修改** | `src/components/Layout/AppShell.module.css` | `.shell` 加 `overflow: visible`（子页面自己管 overflow） |
| **删除** | `src/components/Layout/TitleBar.tsx` | 整个删除 |
| **删除** | `src/components/Layout/TitleBar.module.css` | 整个删除 |
| **创建** | `src/lib/animation.ts` | GSAP 动画常量 |
| **创建** | `src/components/Layout/LeftStrip.tsx` | 52px 图标条，组合 4 个 Module |
| **创建** | `src/components/Layout/LeftStrip.module.css` | 图标条样式 |
| **创建** | `src/components/Layout/modules/useHoverPanel.ts` | hover bridge 逻辑（共用 hook） |
| **创建** | `src/components/Layout/modules/NavModule.tsx` | 导航模块（探索/我的库/设置）|
| **创建** | `src/components/Layout/modules/NavModule.module.css` | NavModule 样式 |
| **创建** | `src/components/Layout/modules/SearchModule.tsx` | 搜索模块（复用 SearchPill 逻辑） |
| **创建** | `src/components/Layout/modules/SearchModule.module.css` | SearchModule 样式 |
| **创建** | `src/components/Layout/modules/SourceModule.tsx` | 音源切换模块 |
| **创建** | `src/components/Layout/modules/SourceModule.module.css` | SourceModule 样式 |
| **创建** | `src/components/Layout/modules/AccountModule.tsx` | 账号模块 |
| **创建** | `src/components/Layout/modules/AccountModule.module.css` | AccountModule 样式 |
| **创建** | `src/components/Layout/FlowingMenu/FlowingMenu.tsx` | 纯文字跑马灯 nav 动画组件 |
| **创建** | `src/components/Layout/FlowingMenu/FlowingMenu.module.css` | FlowingMenu 样式 |

---

### Task 1: 修复 PlayerBar 遮挡 bug + 重构 App 布局

**Files:**
- Modify: `src/components/Player/PlayerGlass.tsx`
- Modify: `src/components/Player/PlayerGlass.module.css`
- Modify: `src/App.tsx`
- Modify: `src/App.module.css`

**Interfaces:**
- Produces: `PlayerGlass` 改为 `position:relative`，App 布局变为 `.content`（flex-row）+ PlayerBar 兄弟节点

- [ ] **Step 1: 修改 PlayerGlass.module.css**

将 `.dock` 从 `position:fixed` 改为普通 block，`.panel` 保留：

```css
/* src/components/Player/PlayerGlass.module.css */
.dock {
  padding: 10px 16px;
  pointer-events: none;
  flex-shrink: 0;
}

.panel {
  pointer-events: auto;
  -webkit-app-region: no-drag;
  padding: 12px 20px;
}
```

- [ ] **Step 2: PlayerGlass.tsx 无需改动**（移除 fixed 后 JSX 不变，但确认无 `left/right/bottom` 内联样式）

打开 `src/components/Player/PlayerGlass.tsx`，确认返回的 JSX 仍是：
```tsx
<div className={styles.dock}>
  <GlassPanel className={styles.panel}>{children}</GlassPanel>
</div>
```
无需修改。

- [ ] **Step 3: 修改 App.module.css，新增 `.content`**

```css
/* src/App.module.css */
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--sm-bg-base);
}

.content {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
```

- [ ] **Step 4: 修改 App.tsx，移除 TitleBar，新增 content wrapper**

```tsx
// src/App.tsx
import { useEffect, useState } from 'react'
import styles from './App.module.css'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useAudio } from './hooks/useAudio'
import { useDesktopLyricsSync } from './hooks/useDesktopLyricsSync'
import { useWallpaperSync } from './hooks/useWallpaperSync'
import { useLyricsFetch } from './hooks/useLyricsFetch'
import { useSettingsStore } from './stores/settings'
import { WindowChrome } from './components/Layout/WindowChrome'
import { AppShell } from './components/Layout/AppShell'
import { LeftStrip } from './components/Layout/LeftStrip'
import { PlayerBar } from './components/Player/PlayerBar'
import { LyricsPanel } from './components/Lyrics/LyricsPanel'

export default function App() {
  const [lyricsOpen, setLyricsOpen] = useState(false)

  useDesktopBridge()
  useAudio()
  useDesktopLyricsSync()
  useWallpaperSync()
  useLyricsFetch()

  useEffect(() => {
    useSettingsStore.getState().loadFromLocal()
    const sync = () => {
      const mode = useSettingsStore.getState().themeMode
      const root = document.documentElement
      if (mode === 'auto') root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', mode)
    }
    sync()
    return useSettingsStore.subscribe(sync)
  }, [])

  return (
    <WindowChrome>
      <div className={styles.root}>
        <div className={styles.content}>
          <LeftStrip />
          <AppShell />
        </div>
        <PlayerBar onOpenLyrics={() => setLyricsOpen(true)} />
        <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
      </div>
    </WindowChrome>
  )
}
```

- [ ] **Step 5: 验证 LeftStrip 存在（先用 stub）**

在 `src/components/Layout/LeftStrip.tsx` 创建一个空 stub（Task 3 会填充内容），确保 App.tsx 能编译：

```tsx
// src/components/Layout/LeftStrip.tsx
export function LeftStrip() {
  return <div style={{ width: 52, flexShrink: 0, background: 'rgba(255,255,255,0.05)' }} />
}
```

- [ ] **Step 6: 启动应用，确认 PlayerBar 不再遮挡内容**

```bash
npm run dev
```

滚动 ExplorePage 到底部，确认最后一首歌曲完全可见，PlayerBar 紧贴在内容区下方，不浮动覆盖。

- [ ] **Step 7: 删除 TitleBar 文件**

```bash
rm src/components/Layout/TitleBar.tsx src/components/Layout/TitleBar.module.css
```

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.module.css src/components/Player/PlayerGlass.module.css src/components/Layout/LeftStrip.tsx
git rm src/components/Layout/TitleBar.tsx src/components/Layout/TitleBar.module.css
git commit -m "fix(layout): remove TitleBar, fix PlayerBar fixed-position overlap, add content row"
```

---

### Task 2: 创建动画常量 + hover panel 共用 hook

**Files:**
- Create: `src/lib/animation.ts`
- Create: `src/components/Layout/modules/useHoverPanel.ts`

**Interfaces:**
- Produces:
  - `ANIM` 常量对象（ease、duration）
  - `useHoverPanel(panelRef, opts?)` → `{ triggerProps, panelProps }` — 返回绑定到 icon 和 panel 的事件 handlers

- [ ] **Step 1: 创建 `src/lib/animation.ts`**

```ts
// src/lib/animation.ts
export const ANIM = {
  EASE_ENTER: 'expo.out',
  EASE_LEAVE: 'power2.in',
  DURATION_ENTER: 0.38,
  DURATION_LEAVE: 0.22,
  ICON_SCALE_DURATION: 0.2,
} as const
```

- [ ] **Step 2: 创建 `src/components/Layout/modules/useHoverPanel.ts`**

这个 hook 封装"图标 hover → 延迟关闭"的逻辑，避免每个 Module 重复写。

```ts
// src/components/Layout/modules/useHoverPanel.ts
import { useRef, useCallback } from 'react'
import gsap from 'gsap'
import type { RefObject } from 'react'
import { ANIM } from '../../../lib/animation'

interface UseHoverPanelOptions {
  hideDelay?: number
}

interface HoverPanelResult {
  /** 绑定到图标种子的事件 props */
  triggerProps: {
    onMouseEnter: () => void
    onMouseLeave: () => void
  }
  /** 绑定到展开 panel 的事件 props */
  panelProps: {
    onMouseEnter: () => void
    onMouseLeave: () => void
  }
}

export function useHoverPanel(
  panelRef: RefObject<HTMLElement | null>,
  opts: UseHoverPanelOptions = {}
): HoverPanelResult {
  const hideDelay = opts.hideDelay ?? 150
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visible = useRef(false)

  const showPanel = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    if (visible.current || !panelRef.current) return
    visible.current = true
    gsap.killTweensOf(panelRef.current)
    gsap.fromTo(
      panelRef.current,
      { x: -16, opacity: 0, scale: 0.96, pointerEvents: 'none' },
      {
        x: 0,
        opacity: 1,
        scale: 1,
        pointerEvents: 'auto',
        duration: ANIM.DURATION_ENTER,
        ease: ANIM.EASE_ENTER,
      }
    )
  }, [panelRef])

  const scheduleHide = useCallback(() => {
    hideTimer.current = setTimeout(() => {
      if (!panelRef.current) return
      visible.current = false
      gsap.killTweensOf(panelRef.current)
      gsap.to(panelRef.current, {
        x: -10,
        opacity: 0,
        scale: 0.96,
        pointerEvents: 'none',
        duration: ANIM.DURATION_LEAVE,
        ease: ANIM.EASE_LEAVE,
      })
    }, hideDelay)
  }, [panelRef, hideDelay])

  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  return {
    triggerProps: {
      onMouseEnter: showPanel,
      onMouseLeave: scheduleHide,
    },
    panelProps: {
      onMouseEnter: cancelHide,
      onMouseLeave: scheduleHide,
    },
  }
}
```

- [ ] **Step 3: TypeScript 检查**

```bash
npx tsc --noEmit
```

期待：0 错误。

- [ ] **Step 4: Commit**

```bash
git add src/lib/animation.ts src/components/Layout/modules/useHoverPanel.ts
git commit -m "feat(animation): add ANIM constants and useHoverPanel hook"
```

---

### Task 3: 创建 FlowingMenu 组件（纯文字跑马灯，无图片）

**Files:**
- Create: `src/components/Layout/FlowingMenu/FlowingMenu.tsx`
- Create: `src/components/Layout/FlowingMenu/FlowingMenu.module.css`

**Interfaces:**
- Consumes: `ANIM` from `../../../lib/animation`
- Produces:
  ```ts
  interface FlowingMenuItem {
    text: string
    active?: boolean
    onClick: () => void
  }
  interface FlowingMenuProps {
    items: FlowingMenuItem[]
    speed?: number          // 跑马灯速度（秒），默认 12
    textColor?: string      // 静态文字色，默认 var(--sm-text-primary)
    bgColor?: string        // panel 背景，默认 transparent
    marqueeBgColor?: string // 跑马灯覆盖层背景，默认 var(--sm-accent)
    marqueeTextColor?: string // 跑马灯文字色，默认 #fff
    borderColor?: string    // item 之间分割线色，默认 var(--sm-border)
  }
  export function FlowingMenu(props: FlowingMenuProps): JSX.Element
  ```

- [ ] **Step 1: 创建 FlowingMenu.module.css**

```css
/* src/components/Layout/FlowingMenu/FlowingMenu.module.css */
.menuWrap {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 12px;
}

.menu {
  display: flex;
  flex-direction: column;
  height: 100%;
  margin: 0;
  padding: 0;
}

.menuItem {
  flex: 1;
  position: relative;
  overflow: hidden;
  border-top: 1px solid;
}

.menuItem:first-child {
  border-top: none;
}

.menuItemLink {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 20px;
  height: 100%;
  position: relative;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
  font-weight: 600;
  font-size: 15px;
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  transition: color 0.15s;
}

.menuItemLink.active {
  color: var(--sm-accent) !important;
}

.marquee {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  width: 100%;
  height: 100%;
  pointer-events: none;
  transform: translate3d(0, 101%, 0);
}

.marqueeInnerWrap {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.marqueeInner {
  display: flex;
  align-items: center;
  position: relative;
  height: 100%;
  width: fit-content;
  will-change: transform;
}

.marqueePart {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 24px;
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

- [ ] **Step 2: 创建 FlowingMenu.tsx**

```tsx
// src/components/Layout/FlowingMenu/FlowingMenu.tsx
import { useRef, useEffect, useState } from 'react'
import gsap from 'gsap'
import styles from './FlowingMenu.module.css'

export interface FlowingMenuItem {
  text: string
  active?: boolean
  onClick: () => void
}

export interface FlowingMenuProps {
  items: FlowingMenuItem[]
  speed?: number
  textColor?: string
  bgColor?: string
  marqueeBgColor?: string
  marqueeTextColor?: string
  borderColor?: string
}

export function FlowingMenu({
  items = [],
  speed = 12,
  textColor = 'var(--sm-text-primary)',
  bgColor = 'transparent',
  marqueeBgColor = 'var(--sm-accent)',
  marqueeTextColor = '#fff',
  borderColor = 'var(--sm-border)',
}: FlowingMenuProps) {
  return (
    <div className={styles.menuWrap} style={{ backgroundColor: bgColor }}>
      <nav className={styles.menu}>
        {items.map((item, idx) => (
          <FlowingMenuItemComponent
            key={idx}
            item={item}
            speed={speed}
            textColor={textColor}
            marqueeBgColor={marqueeBgColor}
            marqueeTextColor={marqueeTextColor}
            borderColor={borderColor}
          />
        ))}
      </nav>
    </div>
  )
}

interface ItemProps {
  item: FlowingMenuItem
  speed: number
  textColor: string
  marqueeBgColor: string
  marqueeTextColor: string
  borderColor: string
}

function FlowingMenuItemComponent({ item, speed, textColor, marqueeBgColor, marqueeTextColor, borderColor }: ItemProps) {
  const itemRef = useRef<HTMLDivElement>(null)
  const marqueeRef = useRef<HTMLDivElement>(null)
  const marqueeInnerRef = useRef<HTMLDivElement>(null)
  const marqueeAnimRef = useRef<gsap.core.Tween | null>(null)
  const [repetitions, setRepetitions] = useState(6)

  function findClosestEdge(mouseX: number, mouseY: number, width: number, height: number): 'top' | 'bottom' {
    const topDist = (mouseX - width / 2) ** 2 + mouseY ** 2
    const bottomDist = (mouseX - width / 2) ** 2 + (mouseY - height) ** 2
    return topDist < bottomDist ? 'top' : 'bottom'
  }

  useEffect(() => {
    const calc = () => {
      const part = marqueeInnerRef.current?.querySelector(`.${styles.marqueePart}`) as HTMLElement | null
      if (!part) return
      const w = part.offsetWidth
      if (w === 0) return
      const needed = Math.ceil(window.innerWidth / w) + 3
      setRepetitions(Math.max(6, needed))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [item.text])

  useEffect(() => {
    const part = marqueeInnerRef.current?.querySelector(`.${styles.marqueePart}`) as HTMLElement | null
    if (!part) return
    const w = part.offsetWidth
    if (w === 0) return
    if (marqueeAnimRef.current) marqueeAnimRef.current.kill()
    marqueeAnimRef.current = gsap.to(marqueeInnerRef.current, {
      x: -w,
      duration: speed,
      ease: 'none',
      repeat: -1,
    })
    return () => { marqueeAnimRef.current?.kill() }
  }, [item.text, repetitions, speed])

  function handleMouseEnter(ev: React.MouseEvent<HTMLButtonElement>) {
    if (!itemRef.current || !marqueeRef.current || !marqueeInnerRef.current) return
    const rect = itemRef.current.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    const edge = findClosestEdge(x, y, rect.width, rect.height)
    gsap.timeline({ defaults: { duration: 0.5, ease: 'expo.out' } })
      .set(marqueeRef.current, { y: edge === 'top' ? '-101%' : '101%' })
      .set(marqueeInnerRef.current, { y: edge === 'top' ? '101%' : '-101%' })
      .to([marqueeRef.current, marqueeInnerRef.current], { y: '0%' })
  }

  function handleMouseLeave(ev: React.MouseEvent<HTMLButtonElement>) {
    if (!itemRef.current || !marqueeRef.current || !marqueeInnerRef.current) return
    const rect = itemRef.current.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    const edge = findClosestEdge(x, y, rect.width, rect.height)
    gsap.timeline({ defaults: { duration: 0.4, ease: 'expo.out' } })
      .to(marqueeRef.current, { y: edge === 'top' ? '-101%' : '101%' })
      .to(marqueeInnerRef.current, { y: edge === 'top' ? '101%' : '-101%' }, '<')
  }

  return (
    <div className={styles.menuItem} ref={itemRef} style={{ borderColor }}>
      <button
        className={`${styles.menuItemLink} no-drag ${item.active ? styles.active : ''}`}
        style={{ color: textColor }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={item.onClick}
      >
        {item.text}
      </button>
      <div className={styles.marquee} ref={marqueeRef} style={{ backgroundColor: marqueeBgColor }}>
        <div className={styles.marqueeInnerWrap}>
          <div className={styles.marqueeInner} ref={marqueeInnerRef} aria-hidden="true">
            {Array.from({ length: repetitions }).map((_, idx) => (
              <div className={styles.marqueePart} key={idx} style={{ color: marqueeTextColor }}>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

```bash
npx tsc --noEmit
```

期待：0 错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/FlowingMenu/
git commit -m "feat(ui): add FlowingMenu component with pure-text marquee"
```

---

### Task 4: 创建 NavModule

**Files:**
- Create: `src/components/Layout/modules/NavModule.tsx`
- Create: `src/components/Layout/modules/NavModule.module.css`

**Interfaces:**
- Consumes:
  - `FlowingMenu` from `../FlowingMenu/FlowingMenu`
  - `useHoverPanel` from `./useHoverPanel`
  - `useNavigationStore` from `../../../stores/navigation`
  - `ANIM` from `../../../lib/animation`
- Produces: `function NavModule(): JSX.Element`

- [ ] **Step 1: 创建 NavModule.module.css**

```css
/* src/components/Layout/modules/NavModule.module.css */
.seed {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: none;
  border: none;
  color: var(--sm-text-secondary);
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
  -webkit-app-region: no-drag;
}

.seed:hover,
.seed.active {
  color: var(--sm-text-primary);
  background: var(--sm-bg-overlay);
  transform: scale(1.15);
}

.panel {
  position: absolute;
  left: 52px;
  top: 0;
  width: 220px;
  height: 168px; /* 3 items × 56px */
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: 14px;
  box-shadow: var(--sm-shadow);
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transform-origin: left center;
}
```

- [ ] **Step 2: 创建 NavModule.tsx**

```tsx
// src/components/Layout/modules/NavModule.tsx
import { useRef } from 'react'
import { useNavigationStore } from '../../../stores/navigation'
import type { AppView } from '../../../stores/navigation'
import { FlowingMenu } from '../FlowingMenu/FlowingMenu'
import { useHoverPanel } from './useHoverPanel'
import styles from './NavModule.module.css'

const NAV_ITEMS: { view: AppView; label: string }[] = [
  { view: 'explore', label: '探索' },
  { view: 'library', label: '我的库' },
  { view: 'settings', label: '设置' },
]

export function NavModule() {
  const currentView = useNavigationStore((s) => s.currentView)
  const navigateTo = useNavigationStore((s) => s.navigateTo)
  const panelRef = useRef<HTMLDivElement>(null)
  const { triggerProps, panelProps } = useHoverPanel(panelRef)

  const isActive = typeof currentView === 'string' && NAV_ITEMS.some((n) => n.view === currentView)

  const menuItems = NAV_ITEMS.map((n) => ({
    text: n.label,
    active: currentView === n.view,
    onClick: () => navigateTo(n.view),
  }))

  return (
    <>
      <button
        className={`${styles.seed} ${isActive ? styles.active : ''}`}
        aria-label="导航"
        {...triggerProps}
      >
        {/* 网格图标 */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      </button>
      <div ref={panelRef} className={styles.panel} {...panelProps}>
        <FlowingMenu items={menuItems} />
      </div>
    </>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/modules/NavModule.tsx src/components/Layout/modules/NavModule.module.css
git commit -m "feat(nav): add NavModule with FlowingMenu panel"
```

---

### Task 5: 创建 SearchModule

**Files:**
- Create: `src/components/Layout/modules/SearchModule.tsx`
- Create: `src/components/Layout/modules/SearchModule.module.css`

**Interfaces:**
- Consumes: `useHoverPanel`, 复用 `SearchPill` 内部所有搜索逻辑（直接内联，不 import SearchPill）
- Produces: `function SearchModule(): JSX.Element`

- [ ] **Step 1: 创建 SearchModule.module.css**

```css
/* src/components/Layout/modules/SearchModule.module.css */
.seed {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: none;
  border: none;
  color: var(--sm-text-secondary);
  cursor: pointer;
  transition: color 0.2s, background 0.2s, transform 0.2s;
  -webkit-app-region: no-drag;
}

.seed:hover {
  color: var(--sm-text-primary);
  background: var(--sm-bg-overlay);
  transform: scale(1.15);
}

.panel {
  position: absolute;
  left: 52px;
  top: 0;
  width: 300px;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: 14px;
  box-shadow: var(--sm-shadow);
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transform-origin: left center;
}

.inputRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sm-border);
}

.input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--sm-text-primary);
  font-size: 14px;
  -webkit-app-region: no-drag;
}

.input::placeholder {
  color: var(--sm-text-secondary);
}

.results {
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.hint {
  padding: 12px 16px;
  color: var(--sm-text-secondary);
  font-size: 13px;
}

.sectionLabel {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--sm-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.songRow,
.artistRow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 16px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sm-text-primary);
  font-size: 13px;
  text-align: left;
  transition: background 0.15s;
  -webkit-app-region: no-drag;
}

.songRow:hover,
.artistRow:hover {
  background: var(--sm-bg-overlay);
}

.cover,
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.avatar {
  border-radius: 50%;
}

.songInfo {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.songName {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.songArtist {
  font-size: 12px;
  color: var(--sm-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: 创建 SearchModule.tsx**

```tsx
// src/components/Layout/modules/SearchModule.tsx
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigationStore } from '../../../stores/navigation'
import { useMusicService } from '../../../hooks/useMusicService'
import { usePlaylistStore } from '../../../stores/playlist'
import type { Track, ArtistInfo } from '../../../types/domain'
import { useHoverPanel } from './useHoverPanel'
import styles from './SearchModule.module.css'

export function SearchModule() {
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { triggerProps, panelProps } = useHoverPanel(panelRef, { hideDelay: 200 })

  const [keyword, setKeyword] = useState('')
  const [songs, setSongs] = useState<Track[]>([])
  const [artists, setArtists] = useState<ArtistInfo[]>([])
  const [loading, setLoading] = useState(false)

  const service = useMusicService()
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  function handleTriggerEnter() {
    triggerProps.onMouseEnter()
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  async function runSearch() {
    const q = keyword.trim()
    if (!q || loading) return
    setLoading(true)
    try {
      const [s, a] = await Promise.allSettled([
        service.searchTracks(q),
        service.searchArtists(q),
      ])
      setSongs(s.status === 'fulfilled' ? s.value : [])
      setArtists(a.status === 'fulfilled' ? a.value : [])
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void runSearch()
  }

  function pickSong(index: number) {
    usePlaylistStore.getState().setQueue(songs, index)
    setKeyword('')
    setSongs([])
    setArtists([])
  }

  function pickArtist(artist: ArtistInfo) {
    navigateTo({ type: 'artist', id: artist.id, source: artist.source })
    setKeyword('')
    setSongs([])
    setArtists([])
  }

  return (
    <>
      <button
        className={`${styles.seed}`}
        aria-label="搜索"
        onMouseEnter={handleTriggerEnter}
        onMouseLeave={triggerProps.onMouseLeave}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
      </button>
      <div ref={panelRef} className={styles.panel} {...panelProps}>
        <form className={styles.inputRow} onSubmit={handleSubmit}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            className={styles.input}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌曲、歌手…"
          />
        </form>
        <div className={styles.results}>
          {loading && <p className={styles.hint}>搜索中…</p>}
          {!loading && artists.length === 0 && songs.length === 0 && keyword.length > 0 && (
            <p className={styles.hint}>无结果</p>
          )}
          {!loading && artists.length > 0 && (
            <div>
              <div className={styles.sectionLabel}>歌手</div>
              {artists.map((a, i) => (
                <button key={`a-${i}`} className={styles.artistRow} onClick={() => pickArtist(a)}>
                  {a.avatar && <img className={styles.avatar} src={a.avatar} alt="" loading="lazy" />}
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && songs.length > 0 && (
            <div>
              {artists.length > 0 && <div className={styles.sectionLabel}>歌曲</div>}
              {songs.slice(0, 8).map((s, i) => (
                <button key={`s-${i}`} className={styles.songRow} onClick={() => pickSong(i)}>
                  {s.cover && <img className={styles.cover} src={s.cover} alt="" loading="lazy" />}
                  <div className={styles.songInfo}>
                    <span className={styles.songName}>{s.name}</span>
                    <span className={styles.songArtist}>{s.artist}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: TypeScript 检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/modules/SearchModule.tsx src/components/Layout/modules/SearchModule.module.css
git commit -m "feat(search): add SearchModule panel with hover expand"
```

---

### Task 6: 创建 SourceModule + AccountModule

**Files:**
- Create: `src/components/Layout/modules/SourceModule.tsx`
- Create: `src/components/Layout/modules/SourceModule.module.css`
- Create: `src/components/Layout/modules/AccountModule.tsx`
- Create: `src/components/Layout/modules/AccountModule.module.css`

**Interfaces:**
- Consumes: `useHoverPanel`, `useSettingsStore`
- Produces: `function SourceModule(): JSX.Element`, `function AccountModule(): JSX.Element`

- [ ] **Step 1: 创建 SourceModule.module.css**

```css
/* src/components/Layout/modules/SourceModule.module.css */
.seed {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: none;
  border: none;
  color: var(--sm-text-secondary);
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
  position: relative;
  -webkit-app-region: no-drag;
}

.seed:hover {
  color: var(--sm-text-primary);
  background: var(--sm-bg-overlay);
  transform: scale(1.15);
}

.dot {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sm-accent);
}

.panel {
  position: absolute;
  left: 52px;
  bottom: 44px;
  width: 160px;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: 12px;
  box-shadow: var(--sm-shadow);
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transform-origin: left bottom;
}

.option {
  display: block;
  width: 100%;
  padding: 11px 16px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sm-text-secondary);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  -webkit-app-region: no-drag;
}

.option:hover {
  background: var(--sm-bg-overlay);
  color: var(--sm-text-primary);
}

.option.active {
  color: var(--sm-accent);
  font-weight: 600;
}
```

- [ ] **Step 2: 创建 SourceModule.tsx**

```tsx
// src/components/Layout/modules/SourceModule.tsx
import { useRef } from 'react'
import { useSettingsStore } from '../../../stores/settings'
import { useHoverPanel } from './useHoverPanel'
import styles from './SourceModule.module.css'

const SOURCES = [
  { key: 'netease' as const, label: '网易云' },
  { key: 'qq' as const, label: 'QQ 音乐' },
]

export function SourceModule() {
  const panelRef = useRef<HTMLDivElement>(null)
  const { triggerProps, panelProps } = useHoverPanel(panelRef)
  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)

  return (
    <>
      <button className={styles.seed} aria-label="音源" {...triggerProps}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
        </svg>
        <span className={styles.dot} aria-hidden="true" />
      </button>
      <div ref={panelRef} className={styles.panel} {...panelProps}>
        {SOURCES.map((s) => (
          <button
            key={s.key}
            className={`${styles.option} ${s.key === activeSource ? styles.active : ''}`}
            onClick={() => setActiveSource(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 3: 创建 AccountModule.module.css**

```css
/* src/components/Layout/modules/AccountModule.module.css */
.seed {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--sm-bg-overlay);
  border: 1px solid var(--sm-border);
  color: var(--sm-text-secondary);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
  -webkit-app-region: no-drag;
}

.seed:hover {
  color: var(--sm-text-primary);
  border-color: var(--sm-accent);
}

.panel {
  position: absolute;
  left: 52px;
  bottom: 0;
  width: 200px;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: 12px;
  box-shadow: var(--sm-shadow);
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transform-origin: left bottom;
  padding: 14px 16px;
}

.status {
  font-size: 13px;
  color: var(--sm-text-secondary);
  margin-bottom: 12px;
}

.actionBtn {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: var(--sm-bg-overlay);
  border: 1px solid var(--sm-border);
  border-radius: 8px;
  color: var(--sm-text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  text-align: center;
  -webkit-app-region: no-drag;
}

.actionBtn:hover {
  background: var(--sm-accent);
  color: #fff;
  border-color: transparent;
}
```

- [ ] **Step 4: 创建 AccountModule.tsx**

```tsx
// src/components/Layout/modules/AccountModule.tsx
import { useRef } from 'react'
import { useHoverPanel } from './useHoverPanel'
import styles from './AccountModule.module.css'

export function AccountModule() {
  const panelRef = useRef<HTMLDivElement>(null)
  const { triggerProps, panelProps } = useHoverPanel(panelRef)

  return (
    <>
      <button className={styles.seed} aria-label="账户" {...triggerProps}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z" />
        </svg>
      </button>
      <div ref={panelRef} className={styles.panel} {...panelProps}>
        <p className={styles.status}>未登录</p>
        <button className={styles.actionBtn}>登录账号</button>
      </div>
    </>
  )
}
```

- [ ] **Step 5: TypeScript 检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout/modules/SourceModule.tsx src/components/Layout/modules/SourceModule.module.css src/components/Layout/modules/AccountModule.tsx src/components/Layout/modules/AccountModule.module.css
git commit -m "feat(modules): add SourceModule and AccountModule panels"
```

---

### Task 7: 组装 LeftStrip，完成收尾

**Files:**
- Modify: `src/components/Layout/LeftStrip.tsx`（替换 stub）
- Create: `src/components/Layout/LeftStrip.module.css`
- Modify: `src/components/Layout/AppShell.module.css`（确保正确处理 overflow）

**Interfaces:**
- Consumes: 所有 Module 组件
- Produces: 完整的 `LeftStrip` 组件，app 可正常运行

- [ ] **Step 1: 创建 LeftStrip.module.css**

```css
/* src/components/Layout/LeftStrip.module.css */
.strip {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 52px;
  flex-shrink: 0;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border-right: 1px solid var(--sm-border);
  z-index: 200;
  overflow: visible;
}

/* macOS traffic lights 占位：48px 高拖拽区 */
.dragArea {
  width: 100%;
  height: 48px;
  flex-shrink: 0;
  -webkit-app-region: drag;
}

/* 图标区域：居中排列图标 */
.icons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  flex: 1;
  width: 100%;
  overflow: visible;
}

/* 底部图标区 */
.bottomIcons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  width: 100%;
  overflow: visible;
}

/* 模块容器：position:relative，panel 从这里 absolute 定位 */
.moduleWrap {
  position: relative;
  width: 100%;
  display: flex;
  justify-content: center;
  overflow: visible;
}
```

- [ ] **Step 2: 替换 LeftStrip.tsx stub 为完整实现**

```tsx
// src/components/Layout/LeftStrip.tsx
import { NavModule } from './modules/NavModule'
import { SearchModule } from './modules/SearchModule'
import { SourceModule } from './modules/SourceModule'
import { AccountModule } from './modules/AccountModule'
import styles from './LeftStrip.module.css'

export function LeftStrip() {
  return (
    <div className={styles.strip}>
      {/* macOS traffic lights 占位 + 拖拽区 */}
      <div className={`${styles.dragArea} desktop-shell`} aria-hidden="true" />

      {/* 主图标区 */}
      <div className={styles.icons}>
        <div className={styles.moduleWrap}>
          <SearchModule />
        </div>
        <div className={styles.moduleWrap}>
          <NavModule />
        </div>
      </div>

      {/* 底部图标区 */}
      <div className={styles.bottomIcons}>
        <div className={styles.moduleWrap}>
          <SourceModule />
        </div>
        <div className={styles.moduleWrap}>
          <AccountModule />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 检查 AppShell.module.css，确保 `.shell` 不 clip overflow**

打开 `src/components/Layout/AppShell.module.css`，确认 `.shell` 有：
```css
.shell {
  flex: 1;
  overflow: hidden;  /* 只 clip 内容，不影响 LeftStrip 的 panel */
  position: relative;
  -webkit-app-region: no-drag;
}
```
AppShell 是 LeftStrip 的 **兄弟节点**，不是父节点，所以它的 overflow:hidden 不会裁剪 LeftStrip 的 panel。无需修改。

- [ ] **Step 4: TypeScript 检查**

```bash
npx tsc --noEmit
```

期待：0 错误。

- [ ] **Step 5: 启动应用完整验证**

```bash
npm run dev
```

验证清单：
- [ ] 顶部无 TitleBar，内容铺满
- [ ] 左侧 52px 图标条可见（有玻璃质感）
- [ ] 图标条顶部有 48px 透明拖拽区（macOS traffic lights 显示在此）
- [ ] hover 搜索图标 → 搜索 panel 从左边弹出，动画丝滑
- [ ] hover 导航图标 → FlowingMenu panel 弹出，hover 各 item 有上下跑马灯动画
- [ ] 点击导航 item → 页面切换，panel 关闭
- [ ] hover 音源图标（底部） → 音源 panel 弹出
- [ ] hover 账号图标 → 账号 panel 弹出
- [ ] 滚动 ExplorePage 到底部 → PlayerBar 不遮挡，最后一行内容完全可见
- [ ] 移开鼠标 → panel 在 150ms 后收起，动画丝滑

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout/LeftStrip.tsx src/components/Layout/LeftStrip.module.css
git commit -m "feat(layout): complete LeftStrip with all modules, remove TitleBar stub"
```

---

## 完成后验证

```bash
npx tsc --noEmit && npm run build
```

期待：0 TypeScript 错误，构建成功。
