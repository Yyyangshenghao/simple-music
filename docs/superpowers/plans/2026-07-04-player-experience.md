# 播放器体验（暗夜霞光 · 第四期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 播放栏音频响应辉光、歌词页霞光舞台、播放/暂停背景缓动、lazy 预热与 TiltCard reduced-motion 收尾。

**Architecture:** 音频能量走「纯函数（可单测）+ rAF hook 写 CSS 变量」两层；辉光/舞台全部消费 `--ambient-*` token；缓动用 motion useSpring 单弹簧驱动两个 LiquidEther prop。

**Tech Stack:** React 18 + motion v12（`motion/react`）+ Web Audio AnalyserNode（已有）+ vitest（node）。

**Spec:** `docs/superpowers/specs/2026-07-04-player-experience-design.md`

## Global Constraints

- 无新第三方依赖；motion 导入路径 `motion/react`。
- 弹簧参数引用 `src/lib/motion-presets.ts`（`tapScale`/`springSnappy`/`gentleSpringValues`），不得内联。
- 颜色一律 CSS 变量（`--ambient-1/2`），不得写死色值。
- `--audio-energy` 只在 `status === 'playing'` 且 `performanceMode !== 'eco'` 时由 rAF 更新；其余情况归零且无 rAF 循环。
- vitest 为 node 环境：只单测 `audio-energy.ts` 纯函数（TDD）；其余任务验证 `npm run typecheck && npm run build`。
- 注释风格：中文注释。
- 每个提交末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 音频能量纯函数（TDD）+ useAudioEnergy hook

**Files:**
- Create: `src/lib/audio-energy.ts`
- Test: `src/lib/audio-energy.test.ts`（新建）
- Create: `src/hooks/useAudioEnergy.ts`

**Interfaces:**
- Produces:
  - `export function bassEnergyFrom(data: Uint8Array | number[]): number`（0–1）
  - `export function smoothEnergy(prev: number, next: number): number`
  - `export function useAudioEnergy(ref: React.RefObject<HTMLElement | null>): void` — 副作用：目标元素 `--audio-energy` CSS 变量

- [ ] **Step 1: Write the failing test**

创建 `src/lib/audio-energy.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { bassEnergyFrom, smoothEnergy } from './audio-energy'

describe('bassEnergyFrom', () => {
  it('空数据返回 0', () => {
    expect(bassEnergyFrom([])).toBe(0)
    expect(bassEnergyFrom(new Uint8Array(0))).toBe(0)
  })

  it('前 16 bin 全 255 返回 1（后续 bin 不参与）', () => {
    const data = new Uint8Array(32)
    data.fill(255, 0, 16)
    // 17 之后是 0，但不在取样范围内
    expect(bassEnergyFrom(data)).toBe(1)
  })

  it('部分能量按前 16 bin 平均', () => {
    // 前 16 bin 全 51 → 51/255 = 0.2
    const data = new Array(16).fill(51)
    expect(bassEnergyFrom(data)).toBeCloseTo(0.2, 5)
  })

  it('bin 数不足 16 时按实际长度平均', () => {
    expect(bassEnergyFrom([255, 255, 255, 255])).toBe(1)
  })
})

describe('smoothEnergy', () => {
  it('上升比下降快（attack 快 release 慢）', () => {
    const up = smoothEnergy(0, 1) // 上升一步
    const down = 1 - smoothEnergy(1, 0) // 下降一步的降幅
    expect(up).toBeGreaterThan(down)
  })

  it('相等时不变', () => {
    expect(smoothEnergy(0.5, 0.5)).toBe(0.5)
  })

  it('多步后向目标收敛', () => {
    let v = 0
    for (let i = 0; i < 60; i++) v = smoothEnergy(v, 1)
    expect(v).toBeGreaterThan(0.95)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/audio-energy.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/audio-energy.ts`：

```ts
/** 从频谱数据取低频段平均能量（0–1）。取前 16 个 bin，与 CoverParticleCloud 取法一致。 */
export function bassEnergyFrom(data: Uint8Array | number[]): number {
  if (!data.length) return 0
  const n = Math.min(16, data.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  return sum / n / 255
}

/** 指数平滑：上升快（有节拍感）、下降慢（不抖动）。 */
export function smoothEnergy(prev: number, next: number): number {
  const k = next > prev ? 0.35 : 0.08
  return prev + (next - prev) * k
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/audio-energy.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 创建 useAudioEnergy hook**

创建 `src/hooks/useAudioEnergy.ts`：

```ts
import { useEffect } from 'react'
import type { RefObject } from 'react'
import { usePlayerStore } from '../stores/player'
import { useVisualStore } from '../stores/visual'
import { bassEnergyFrom, smoothEnergy } from '../lib/audio-energy'

/**
 * 播放中每帧读取频谱低频能量，平滑后写入目标元素的 --audio-energy（0–1）。
 * 暂停/eco 档时停表并归零，空闲零开销。
 */
export function useAudioEnergy(ref: RefObject<HTMLElement | null>): void {
  const playing = usePlayerStore((s) => s.status === 'playing')
  const eco = useVisualStore((s) => s.performanceMode === 'eco')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!playing || eco) {
      el.style.setProperty('--audio-energy', '0')
      return
    }
    let raf = 0
    let energy = 0
    const tick = () => {
      const data = usePlayerStore.getState()._engine().getFrequencyData()
      energy = smoothEnergy(energy, bassEnergyFrom(data))
      el.style.setProperty('--audio-energy', energy.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--audio-energy', '0')
    }
  }, [ref, playing, eco])
}
```

- [ ] **Step 6: 全量回归 + Commit**

Run: `npm run typecheck && npm test`
Expected: 全部通过

```bash
git add src/lib/audio-energy.ts src/lib/audio-energy.test.ts src/hooks/useAudioEnergy.ts
git commit -m "feat: add bass energy extraction + useAudioEnergy CSS-var hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PlayerGlass 辉光 + PlayerBar 按钮弹簧

**Files:**
- Modify: `src/components/Player/PlayerGlass.tsx`
- Modify: `src/components/Player/PlayerGlass.module.css`
- Modify: `src/components/Player/PlayerBar.tsx`

**Interfaces:**
- Consumes: `useAudioEnergy`（Task 1）、`tapScale`/`springSnappy`（motion-presets）

- [ ] **Step 1: PlayerGlass 接入能量辉光**

`src/components/Player/PlayerGlass.tsx` 改为：

```tsx
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useAudioEnergy } from '../../hooks/useAudioEnergy'
import { GlassPanel } from '../ui/GlassPanel'
import styles from './PlayerGlass.module.css'

interface PlayerGlassProps {
  children?: ReactNode
}

/** 播放栏外层毛玻璃容器，固定在视口底部；播放时底部氛围辉光随低频能量呼吸。 */
export function PlayerGlass({ children }: PlayerGlassProps) {
  const dockRef = useRef<HTMLDivElement>(null)
  useAudioEnergy(dockRef)

  return (
    <div className={styles.dock} ref={dockRef}>
      <div className={styles.glow} aria-hidden="true" />
      <GlassPanel className={styles.panel}>{children}</GlassPanel>
    </div>
  )
}
```

- [ ] **Step 2: PlayerGlass.module.css 加辉光层**

`.dock` 规则加一行 `position: relative;`，文件末尾追加：

```css
/* 音频响应辉光：opacity 由 --audio-energy（useAudioEnergy 每帧写入）驱动 */
.glow {
  position: absolute;
  inset: 4px 24px 2px;
  border-radius: 24px;
  pointer-events: none;
  background: radial-gradient(
    60% 100% at 50% 100%,
    color-mix(in srgb, var(--ambient-1) 45%, transparent),
    color-mix(in srgb, var(--ambient-2) 25%, transparent) 55%,
    transparent 80%
  );
  filter: blur(24px);
  opacity: calc(var(--audio-energy, 0) * 0.85);
}
```

- [ ] **Step 3: PlayerBar 三个控制按钮换弹簧按压**

`src/components/Player/PlayerBar.tsx`：imports 增加：

```tsx
import { motion } from 'motion/react'
import { tapScale, springSnappy } from '../../lib/motion-presets'
```

把上一首/播放暂停/下一首三个 `<button` 改为 `<motion.button`，各追加 `whileTap={tapScale} transition={springSnappy}`，其余 props（type/className/onClick/title/aria-label/data-loading/children）原样保留，闭合标签改 `</motion.button>`。

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过

```bash
git add src/components/Player/PlayerGlass.tsx src/components/Player/PlayerGlass.module.css src/components/Player/PlayerBar.tsx
git commit -m "feat: audio-reactive ambient glow on player dock, spring press on controls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 歌词页霞光舞台 + 当前行光晕

**Files:**
- Modify: `src/components/Lyrics/LyricsPanel.tsx`
- Modify: `src/components/Lyrics/LyricsPanel.module.css`
- Modify: `src/components/Lyrics/KtvLine.module.css`
- Modify: `src/components/Lyrics/LyricLine.module.css`

- [ ] **Step 1: lyrics 模式插入霞光舞台层**

`src/components/Lyrics/LyricsPanel.tsx` lyrics 分支中，blurBg 块（`{track?.cover && (<div className={styles.blurBg} …/>)}`）之后、`.coverSection` 之前插入：

```tsx
          {/* 氛围霞光舞台：两团氛围色缓慢漂移，跟切歌变色 */}
          <div className={styles.auroraStage} aria-hidden="true" />
```

- [ ] **Step 2: LyricsPanel.module.css 加舞台样式**

先查看 `.blurBg` 规则的定位/z-index 写法，`.auroraStage` 采用与其相同的层叠处理（保证盖在 blurBg 之上、内容之下），在其后追加：

```css
/* 氛围霞光舞台（lyrics 模式）：跟随 --ambient-* 切歌变色 */
.auroraStage {
  position: absolute;
  inset: -10%;
  pointer-events: none;
  background:
    radial-gradient(45% 55% at 18% 25%, color-mix(in srgb, var(--ambient-1) 26%, transparent), transparent 70%),
    radial-gradient(50% 60% at 82% 75%, color-mix(in srgb, var(--ambient-2) 20%, transparent), transparent 70%);
  filter: blur(60px);
  animation: stageDrift 30s ease-in-out infinite alternate;
}

@keyframes stageDrift {
  from { transform: translate3d(-2%, -1.5%, 0) scale(1); }
  to   { transform: translate3d(2%, 1.5%, 0) scale(1.06); }
}
```

（若 `.blurBg` 带 `z-index`，给 `.auroraStage` 用相同值；若无则不加。）

- [ ] **Step 3: 当前行光晕**

- `src/components/Lyrics/KtvLine.module.css` 的 `.active` 规则追加一行：
  `text-shadow: 0 0 24px color-mix(in srgb, var(--ambient-2) 55%, transparent);`
- `src/components/Lyrics/LyricLine.module.css` 的 `.active` 规则同样追加该行（若该规则已有 text-shadow，则在其值后以逗号叠加本光晕）。

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过

```bash
git add src/components/Lyrics/LyricsPanel.tsx src/components/Lyrics/LyricsPanel.module.css src/components/Lyrics/KtvLine.module.css src/components/Lyrics/LyricLine.module.css
git commit -m "feat: ambient aurora stage in lyrics view, glow on active line

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 播放缓动 + lazy 预热 + TiltCard useReducedMotion

**Files:**
- Modify: `src/components/Layout/AppShell.tsx`
- Modify: `src/components/ui/TiltCard.tsx`

- [ ] **Step 1: AppShell 播放缓动弹簧**

imports 增加 `useSpring, useMotionValueEvent`（并入现有 `motion/react` import）、`useEffect, useState`（并入现有 react import）、`gentleSpringValues`（并入现有 motion-presets import）。

组件内把 `const playing = usePlayerStore((s) => s.status === 'playing')` 之后加：

```tsx
  // 播放/暂停背景强度缓动：单弹簧 0↔1，避免流体参数跳变
  const playSpring = useSpring(playing ? 1 : 0, gentleSpringValues)
  const [playAmount, setPlayAmount] = useState(playing ? 1 : 0)
  useEffect(() => {
    playSpring.set(playing ? 1 : 0)
  }, [playing, playSpring])
  useMotionValueEvent(playSpring, 'change', (v) => setPlayAmount(v))
```

LiquidEther 的两个 prop 改为：

```tsx
            autoSpeed={0.25 + 0.2 * playAmount}
            autoIntensity={1.2 + 0.6 * playAmount}
```

- [ ] **Step 2: lazy 页面预热**

AppShell 组件内追加：

```tsx
  // 空闲预热 lazy 页面 chunk：首次切页转场不再被模块加载打断
  useEffect(() => {
    const t = window.setTimeout(() => {
      void import('../../pages/ExplorePage')
      void import('../../pages/LibraryPage')
      void import('../../pages/SettingsPage')
      void import('../../pages/ArtistPage')
    }, 2000)
    return () => window.clearTimeout(t)
  }, [])
```

- [ ] **Step 3: TiltCard 改 useReducedMotion**

`src/components/ui/TiltCard.tsx`：
- 删除模块级 `const REDUCED_MOTION = …` 定义
- import 增加 `useReducedMotion`（并入现有 `motion/react` import）
- 组件内加 `const reducedMotion = useReducedMotion()`（中文注释：运行时响应系统「减弱动态」切换）
- `onPointerMove={REDUCED_MOTION ? undefined : onPointerMove}` / `onPointerLeave` 两处把 `REDUCED_MOTION` 换成 `reducedMotion`

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过

```bash
git add src/components/Layout/AppShell.tsx src/components/ui/TiltCard.tsx
git commit -m "feat: smooth play/pause background easing, preload lazy pages, live reduced-motion in TiltCard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 全量验证 + 手动验收

**Files:** 无新改动（验证任务）

- [ ] **Step 1: 全量回归**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过（40 tests）

- [ ] **Step 2: 手动验收（`npm run dev`）**

1. 播放有明显低频的歌 → 底栏下方氛围色辉光随节拍呼吸；暂停 → 辉光渐熄；eco 档 → 无辉光
2. 播放/暂停切换 → 背景流体速度/强度平滑过渡（约 1s 内缓动，无跳变）
3. 打开歌词页（lyrics 模式）→ 两团霞光缓慢漂移；切歌 → 霞光与当前行光晕跟随封面变色
4. KTV 当前行有氛围色光晕
5. 播放器三个按钮按压有弹簧回弹
6. 启动 2s 后首次切到未访问过的页面 → 转场完整不闪黑
7. 播放中系统切「减弱动态」→ 卡片倾斜立即停止（无需重启）
