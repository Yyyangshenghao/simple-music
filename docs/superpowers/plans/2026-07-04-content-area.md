# 内容区动效（暗夜霞光 · 第二期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 卡片 3D 倾斜追光、入场 stagger、渐变标题、列表行 hover/播放指示——内容区消费第一期的氛围 token 与 motion 预设。

**Architecture:** 三个新 UI 组件（TiltCard/RevealItem/GradientText）+ TrackRow 打磨；全部基于既有 motion 依赖与 `--ambient-*`/`--glow-*` token，无新依赖、无 WebGL。

**Tech Stack:** React 18 + motion（`motion/react`）+ CSS Modules + zustand。

**Spec:** `docs/superpowers/specs/2026-07-04-content-area-design.md`

## Global Constraints

- 无新第三方依赖；motion 导入路径为 `motion/react`。
- 弹簧参数一律引用 `src/lib/motion-presets.ts`（springGentle/springSnappy/tapScale/fadeRise），不得内联重复定义。
- 颜色一律引用 CSS 变量（`--ambient-1/2/3`、`--glow-soft`、`--ambient-gradient`），不得写死色值。
- `prefers-reduced-motion: reduce`：TiltCard 不绑 pointermove；CSS 动画由 tokens.css 全局规则兜底。
- vitest 为 node 环境：本期组件均为 DOM/视觉组件，无单测；每任务验证 `npm run typecheck && npm run build`，最后全量回归。
- 注释风格：中文注释。
- 每个提交末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: TiltCard 组件 + 应用到 PlaylistCard/ShelfCard

**Files:**
- Create: `src/components/ui/TiltCard.tsx`
- Create: `src/components/ui/TiltCard.module.css`
- Modify: `src/lib/motion-presets.ts`（导出 `gentleSpringValues`）
- Modify: `src/components/Explore/PlaylistCard.tsx`
- Modify: `src/components/Explore/PlaylistCard.module.css`
- Modify: `src/components/Shelf/ShelfCard.tsx`

**Interfaces:**
- Consumes: `springGentle`、`gentleSpringValues`（`src/lib/motion-presets.ts`）
- Produces: `export function TiltCard({ children, className?, maxTilt? }): JSX.Element`；`export const gentleSpringValues: { stiffness: number; damping: number; mass: number }`

- [ ] **Step 0: motion-presets.ts 导出 spring 原始参数**

`useSpring` 需要 `SpringOptions`（不含 `type` 字段），`Transition` 类型不能直接传入。把 `src/lib/motion-presets.ts` 中的 springGentle 定义改为：

```ts
/** springGentle 的原始参数（供 useSpring 等需要 SpringOptions 的 API 使用）。 */
export const gentleSpringValues = { stiffness: 220, damping: 26, mass: 1 }

/** 柔和弹簧：卡片上浮、面板入场。 */
export const springGentle: Transition = { type: 'spring', ...gentleSpringValues }
```

（原 springGentle 一行替换为以上两个导出，数值不变；其余导出不动。）

- [ ] **Step 1: 创建 TiltCard.tsx**

```tsx
import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { springGentle, gentleSpringValues } from '../../lib/motion-presets'
import styles from './TiltCard.module.css'

interface TiltCardProps {
  children: ReactNode
  className?: string
  /** 最大倾斜角（度），默认 8。 */
  maxTilt?: number
}

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 3D 倾斜追光卡片：鼠标位置驱动 rotateX/rotateY（弹簧平滑），
 * 卡片内光斑跟随光标（--spot-x/--spot-y），hover 上浮 + 氛围辉光。
 * reduced-motion 时不绑指针事件，仅保留辉光。
 */
export function TiltCard({ children, className, maxTilt = 8 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const sx = useSpring(px, gentleSpringValues)
  const sy = useSpring(py, gentleSpringValues)
  const rotateY = useTransform(sx, [0, 1], [-maxTilt, maxTilt])
  const rotateX = useTransform(sy, [0, 1], [maxTilt, -maxTilt])

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    px.set((e.clientX - rect.left) / rect.width)
    py.set((e.clientY - rect.top) / rect.height)
    // 光斑位置不走弹簧，直接跟手
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`)
  }

  function onPointerLeave() {
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      className={`${styles.tilt} ${className ?? ''}`}
      style={{ rotateX, rotateY, transformPerspective: 800 }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={springGentle}
      onPointerMove={REDUCED_MOTION ? undefined : onPointerMove}
      onPointerLeave={REDUCED_MOTION ? undefined : onPointerLeave}
    >
      {children}
      <div className={styles.spotlight} aria-hidden="true" />
    </motion.div>
  )
}
```

- [ ] **Step 2: 创建 TiltCard.module.css**

```css
.tilt {
  position: relative;
  border-radius: var(--sm-radius-card);
  transform-style: preserve-3d;
  transition: box-shadow 240ms var(--sm-ease-out);
}

.tilt:hover {
  box-shadow: var(--glow-soft);
}

/* 追光光斑：跟随 --spot-x/--spot-y，hover 淡入 */
.spotlight {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms var(--sm-ease-out);
  background: radial-gradient(
    180px circle at var(--spot-x, 50%) var(--spot-y, 50%),
    color-mix(in srgb, var(--ambient-2) 18%, transparent),
    transparent 70%
  );
}

.tilt:hover .spotlight {
  opacity: 1;
}
```

- [ ] **Step 3: PlaylistCard 接入 TiltCard 并移除旧 hover 上浮**

`src/components/Explore/PlaylistCard.tsx` 改为：

```tsx
import { BorderGlow } from '../BorderGlow/BorderGlow'
import { TiltCard } from '../ui/TiltCard'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistCard.module.css'

interface PlaylistCardProps {
  playlist: Playlist
  onClick(): void
}

export function PlaylistCard({ playlist, onClick }: PlaylistCardProps) {
  return (
    <TiltCard className={styles.glowWrap}>
      <BorderGlow borderRadius={16}>
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
    </TiltCard>
  )
}
```

`src/components/Explore/PlaylistCard.module.css`：删除整个 `.card:hover .coverWrap { … }` 规则块（transform/box-shadow 交给 TiltCard，避免双重动画）；`.coverWrap` 的 `transition` 行同时删掉（不再需要）。其余不动。

- [ ] **Step 4: ShelfCard 接入 TiltCard**

`src/components/Shelf/ShelfCard.tsx`：加 `import { TiltCard } from '../ui/TiltCard'`，把现有 `<BorderGlow borderRadius={12} glowRadius={32}>…</BorderGlow>` 整体包进 `<TiltCard>…</TiltCard>`（TiltCard 不传 className）。内部结构与 props 全部不动。

- [ ] **Step 5: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过

```bash
git add src/components/ui/TiltCard.tsx src/components/ui/TiltCard.module.css src/components/Explore/PlaylistCard.tsx src/components/Explore/PlaylistCard.module.css src/components/Shelf/ShelfCard.tsx
git commit -m "feat: add TiltCard 3D tilt + ambient spotlight, apply to playlist/shelf cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: RevealItem 入场 stagger

**Files:**
- Create: `src/components/ui/RevealItem.tsx`
- Modify: `src/pages/ExplorePage.tsx`（推荐歌单 map）
- Modify: `src/components/Shelf/ShelfScene.tsx`（slot map）

**Interfaces:**
- Consumes: `fadeRise`、`springGentle`（`src/lib/motion-presets.ts`）
- Produces: `export function RevealItem({ children, delay?, className? }): JSX.Element`

- [ ] **Step 1: 创建 RevealItem.tsx**

```tsx
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, useInView } from 'motion/react'
import { fadeRise, springGentle } from '../../lib/motion-presets'

interface RevealItemProps {
  children: ReactNode
  /** 入场延迟（秒），用于 stagger。 */
  delay?: number
  className?: string
}

/** 进入视口时淡入上移一次（fadeRise + springGentle），配合 delay 做序列入场。 */
export function RevealItem({ children, delay = 0, className }: RevealItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.1, once: true })

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={fadeRise}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      transition={{ ...springGentle, delay }}
    >
      {children}
    </motion.div>
  )
}
```

- [ ] **Step 2: ExplorePage 推荐歌单卡包 RevealItem**

`src/pages/ExplorePage.tsx`：加 `import { RevealItem } from '../components/ui/RevealItem'`，把推荐歌单 map 改为：

```tsx
{playlists.map((pl, i) => (
  <RevealItem key={String(pl.id) + i} delay={i * 0.04}>
    <PlaylistCard
      playlist={pl}
      onClick={() => { if (!loadingId) void openPlaylist(pl) }}
    />
  </RevealItem>
))}
```

（`key` 从 PlaylistCard 挪到 RevealItem 上。）

- [ ] **Step 3: ShelfScene slot 包 RevealItem**

`src/components/Shelf/ShelfScene.tsx`：加 `import { RevealItem } from '../ui/RevealItem'`，把 slot 内的 `<ShelfCard …/>` 改为：

```tsx
<RevealItem delay={index * 0.04}>
  <ShelfCard playlist={playlist} onOpen={() => handleOpen(playlist)} />
</RevealItem>
```

（外层 `div.slot` 与 key 不动。）

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过

```bash
git add src/components/ui/RevealItem.tsx src/pages/ExplorePage.tsx src/components/Shelf/ShelfScene.tsx
git commit -m "feat: add RevealItem stagger entrance for card rails and shelf grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: GradientText 渐变标题

**Files:**
- Create: `src/components/ui/GradientText.tsx`
- Create: `src/components/ui/GradientText.module.css`
- Modify: `src/components/Explore/CardRail.tsx`（标题）
- Modify: `src/pages/ExplorePage.tsx`（sectionTitle「今日推荐」、detailTitle）
- Modify: `src/pages/LibraryPage.tsx`（pageTitle、detailTitle）
- Modify: `src/components/Shelf/ShelfScene.tsx`（heading）

**Interfaces:**
- Produces: `export function GradientText({ children }): JSX.Element`

- [ ] **Step 1: 创建组件与样式**

`src/components/ui/GradientText.tsx`：

```tsx
import type { ReactNode } from 'react'
import styles from './GradientText.module.css'

/** 氛围渐变文字：background-clip 流动渐变，随 --ambient-* 切歌变色。 */
export function GradientText({ children }: { children: ReactNode }) {
  return <span className={styles.gradient}>{children}</span>
}
```

`src/components/ui/GradientText.module.css`：

```css
.gradient {
  background: var(--ambient-gradient);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: gradientFlow 8s ease-in-out infinite alternate;
}

@keyframes gradientFlow {
  from { background-position: 0% 50%; }
  to   { background-position: 100% 50%; }
}
```

- [ ] **Step 2: 应用到六处标题**

各处保留原有外层标签与 className，只把文字内容包进 `<GradientText>`：

1. `CardRail.tsx`：`<h2 className={styles.title}><GradientText>{title}</GradientText></h2>`
2. `ExplorePage.tsx`：`<h2 className={styles.sectionTitle}><GradientText>今日推荐</GradientText></h2>`
3. `ExplorePage.tsx` 详情：`<h1 className={styles.detailTitle}><GradientText>{detail.playlist.name}</GradientText></h1>`
4. `LibraryPage.tsx`：`<h1 className={styles.pageTitle}><GradientText>我的库</GradientText></h1>`
5. `LibraryPage.tsx` 详情：`<h1 className={styles.detailTitle}><GradientText>{detail.playlist.name}</GradientText></h1>`
6. `ShelfScene.tsx`：`<h2 className={styles.heading}><GradientText>我的歌单架</GradientText></h2>`

各文件加对应 import（页面用 `../components/ui/GradientText`，组件用 `../ui/GradientText`）。

- [ ] **Step 3: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过

```bash
git add src/components/ui/GradientText.tsx src/components/ui/GradientText.module.css src/components/Explore/CardRail.tsx src/pages/ExplorePage.tsx src/pages/LibraryPage.tsx src/components/Shelf/ShelfScene.tsx
git commit -m "feat: add GradientText ambient-gradient titles across content pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: TrackRow hover 打磨 + 播放中均衡器指示

**Files:**
- Modify: `src/components/Explore/TrackRow.tsx`
- Modify: `src/components/Explore/TrackRow.module.css`

**Interfaces:**
- Consumes: `usePlayerStore`（`currentTrack`/`status`，`src/stores/player.ts`）
- Produces: TrackRow 对外 props 不变（`track`/`index?`/`onPlay`）

- [ ] **Step 1: TrackRow.tsx 加播放状态与均衡器**

整文件改为：

```tsx
import { usePlayerStore } from '../../stores/player'
import type { Track } from '../../types/domain'
import styles from './TrackRow.module.css'

interface TrackRowProps {
  track: Track
  index?: number
  onPlay(): void
}

/** 播放中指示：3 根氛围色动画柱，暂停时定格。 */
function EqIndicator({ paused }: { paused: boolean }) {
  return (
    <span className={`${styles.eq}${paused ? ` ${styles.eqPaused}` : ''}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  )
}

export function TrackRow({ track, index, onPlay }: TrackRowProps) {
  // 窄布尔 selector：只在“是否当前曲目/是否播放中”变化时重渲染，不受高频 position 更新影响
  const isCurrent = usePlayerStore(
    (s) => s.currentTrack?.provider === track.provider && String(s.currentTrack?.id) === String(track.id)
  )
  const isPlaying = usePlayerStore(
    (s) =>
      s.status === 'playing' &&
      s.currentTrack?.provider === track.provider &&
      String(s.currentTrack?.id) === String(track.id)
  )

  return (
    <button className={`${styles.row}${isCurrent ? ` ${styles.rowActive}` : ''} no-drag`} onClick={onPlay}>
      {index !== undefined && (
        isCurrent
          ? <EqIndicator paused={!isPlaying} />
          : <span className={styles.index}>{index + 1}</span>
      )}
      {track.cover && <img className={styles.cover} src={track.cover} alt="" loading="lazy" />}
      <div className={styles.info}>
        <span className={styles.name}>{track.name}</span>
        <span className={styles.artist}>{track.artist}</span>
      </div>
      <span className={styles.duration}>
        {track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : ''}
      </span>
    </button>
  )
}
```

- [ ] **Step 2: TrackRow.module.css 追加样式**

`.row` 规则里加一行 `position: relative;`，文件末尾追加：

```css
/* hover 左缘氛围色 accent 条 */
.row::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 20%;
  bottom: 20%;
  width: 2px;
  border-radius: 1px;
  background: var(--ambient-1);
  opacity: 0;
  transition: opacity 160ms var(--sm-ease-out);
}

.row:hover::before { opacity: 1; }

/* 当前播放行：曲名染氛围色 */
.rowActive .name { color: var(--ambient-2); }

/* 迷你均衡器：3 根动画柱 */
.eq {
  width: 20px;
  height: 14px;
  display: inline-flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.eq i {
  width: 3px;
  border-radius: 1px;
  background: var(--ambient-1);
  animation: eqBounce 0.9s ease-in-out infinite;
}

.eq i:nth-child(1) { height: 60%; animation-delay: 0s; }
.eq i:nth-child(2) { height: 100%; animation-delay: 0.25s; }
.eq i:nth-child(3) { height: 75%; animation-delay: 0.5s; }

.eqPaused i { animation-play-state: paused; }

@keyframes eqBounce {
  0%, 100% { transform: scaleY(0.4); }
  50%      { transform: scaleY(1); }
}
```

- [ ] **Step 3: 验证 + Commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过

```bash
git add src/components/Explore/TrackRow.tsx src/components/Explore/TrackRow.module.css
git commit -m "feat: TrackRow ambient accent on hover + playing equalizer indicator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 全量验证 + 手动验收

**Files:** 无新改动（验证任务）

- [ ] **Step 1: 全量回归**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过（32 tests）

- [ ] **Step 2: 手动验收（`npm run dev`）**

1. Explore 推荐歌单卡：hover 出现 3D 倾斜跟随鼠标 + 卡内光斑 + 辉光上浮；按下有回弹
2. Library 歌单架卡片同样生效，与书架倾斜不冲突
3. 进入 Explore/切到 Library：卡片依次淡入上移（stagger），列表行入场与之协调
4. 所有区块标题为流动渐变色；切歌后标题渐变随封面变色
5. 播放某行后：该行序号变为跳动均衡器、曲名染氛围色；暂停时柱子定格
6. 列表行 hover 出现左缘氛围色细条
7. 系统开启「减弱动态效果」：卡片不再倾斜/光斑，标题渐变静止，其余功能正常
