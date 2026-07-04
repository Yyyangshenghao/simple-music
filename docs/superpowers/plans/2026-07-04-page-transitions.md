# 页面转场（暗夜霞光 · 第三期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 封面共享元素飞入详情、AppShell 纵深转场（带方向感）、reduced-motion 全局策略、stagger 封顶修复。

**Architecture:** navigation store 记录 push/pop 方向；AppShell 用 AnimatePresence popLayout 做双页交叠；PlaylistCard 与详情封面共用 motion layoutId；App 根挂 MotionConfig。

**Tech Stack:** React 18 + motion v12（`motion/react`：AnimatePresence / layoutId / MotionConfig）。

**Spec:** `docs/superpowers/specs/2026-07-04-page-transitions-design.md`

## Global Constraints

- 无新第三方依赖；motion 导入路径 `motion/react`。
- 弹簧参数引用 `src/lib/motion-presets.ts` 的 `springGentle`/`fadeRise`，不得内联重复定义。
- `PlaylistCard` 未传 `layoutId` 时行为必须与现状完全一致。
- layoutId 命名：Explore `explore-cover-${String(pl.id)}`；Library `library-cover-${String(pl.id)}`。
- vitest 为 node 环境：仅 navigation store 可单测（TDD）；其余任务验证 `npm run typecheck && npm run build`。
- 注释风格：中文注释。
- 每个提交末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: navigation store 方向标记（TDD）

**Files:**
- Modify: `src/stores/navigation.ts`
- Test: 追加到 `src/stores/stores.test.ts`

**Interfaces:**
- Produces: `useNavigationStore` 新增 `lastAction: 'push' | 'pop'`（初始 `'push'`）；`navigateTo` 置 `'push'`，`goBack` 成功回退时置 `'pop'`（history 为空时不变）

- [ ] **Step 1: Write the failing test**

在 `src/stores/stores.test.ts` 末尾追加：

```ts
describe('navigation store direction', () => {
  it('navigateTo 置 push，goBack 置 pop，空 history 时 goBack 不变', async () => {
    const { useNavigationStore } = await import('./navigation')
    useNavigationStore.setState({ currentView: 'explore', history: [], lastAction: 'push' })
    expect(useNavigationStore.getState().lastAction).toBe('push')
    useNavigationStore.getState().navigateTo('library')
    expect(useNavigationStore.getState().lastAction).toBe('push')
    useNavigationStore.getState().goBack()
    expect(useNavigationStore.getState().lastAction).toBe('pop')
    expect(useNavigationStore.getState().currentView).toBe('explore')
    // history 已空：goBack 无效果，方向不变
    useNavigationStore.getState().navigateTo('settings')
    useNavigationStore.setState({ history: [] })
    useNavigationStore.getState().goBack()
    expect(useNavigationStore.getState().lastAction).toBe('push')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/stores.test.ts`
Expected: FAIL —— `lastAction` 不存在（setState 类型错误 / 断言失败）。

- [ ] **Step 3: Write minimal implementation**

`src/stores/navigation.ts`：

```ts
interface NavigationStore {
  currentView: AppView
  history: AppView[]
  /** 最近一次导航方向：navigateTo 为 push，goBack 为 pop（供转场方向使用）。 */
  lastAction: 'push' | 'pop'
  navigateTo(view: AppView): void
  goBack(): void
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentView: 'explore',
  history: [],
  lastAction: 'push',

  navigateTo(view) {
    set((s) => ({ currentView: view, history: [...s.history, s.currentView], lastAction: 'push' }))
  },

  goBack() {
    const { history } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({ currentView: prev, history: history.slice(0, -1), lastAction: 'pop' })
  },
}))
```

（AppView 类型与 import 不动。）

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/stores.test.ts`
Expected: PASS

- [ ] **Step 5: 全量回归 + Commit**

Run: `npm test`
Expected: 全部通过

```bash
git add src/stores/navigation.ts src/stores/stores.test.ts
git commit -m "feat: track push/pop direction in navigation store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: AppShell 纵深转场 + MotionConfig

**Files:**
- Modify: `src/components/Layout/AppShell.tsx`
- Modify: `src/components/Layout/AppShell.module.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useNavigationStore.lastAction`（Task 1）、`springGentle`

- [ ] **Step 1: AppShell.tsx 接入 AnimatePresence**

imports 增加：

```tsx
import { AnimatePresence, motion } from 'motion/react'
import type { Variants } from 'motion/react'
import { springGentle } from '../../lib/motion-presets'
```

组件外（lazy 定义之后）加 variants：

```tsx
/** 纵深转场：新页从纵深浮上（scale 1.03→1），旧页缩小下沉；x 按 push/pop 反向。 */
const pageVariants: Variants = {
  enter: (dir: 1 | -1) => ({ opacity: 0, scale: 1.03, x: 24 * dir, y: 8 }),
  center: { opacity: 1, scale: 1, x: 0, y: 0 },
  exit: (dir: 1 | -1) => ({ opacity: 0, scale: 0.97, x: -24 * dir }),
}
```

组件内加订阅与方向：

```tsx
const lastAction = useNavigationStore((s) => s.lastAction)
const dir: 1 | -1 = lastAction === 'pop' ? -1 : 1
```

`Suspense` 内部替换为：

```tsx
<Suspense fallback={<div className={styles.loading} />}>
  <AnimatePresence mode="popLayout" initial={false} custom={dir}>
    <motion.div
      key={viewKey}
      className={styles.page}
      custom={dir}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={springGentle}
    >
      {renderPage()}
    </motion.div>
  </AnimatePresence>
</Suspense>
```

- [ ] **Step 2: AppShell.module.css 替换 pageEnter**

删除 `.pageEnter { … }` 与 `@keyframes pageEnter { … }`（含相关注释），新增：

```css
.page {
  height: 100%;
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 3: App.tsx 挂 MotionConfig**

`src/App.tsx`：import 增加 `import { MotionConfig } from 'motion/react'`；把 `<WindowChrome>…</WindowChrome>` 整体包进：

```tsx
<MotionConfig reducedMotion="user">
  <WindowChrome>
    …现有内容不动…
  </WindowChrome>
</MotionConfig>
```

- [ ] **Step 4: 验证 + Commit**

Run: `npm run typecheck && npm run build`
Expected: 通过

```bash
git add src/components/Layout/AppShell.tsx src/components/Layout/AppShell.module.css src/App.tsx
git commit -m "feat: depth page transitions with push/pop direction, MotionConfig reduced-motion

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 封面共享元素 + 详情错峰入场 + stagger 封顶

**Files:**
- Modify: `src/components/Explore/PlaylistCard.tsx`
- Modify: `src/pages/ExplorePage.tsx`
- Modify: `src/pages/LibraryPage.tsx`
- Modify: `src/components/Explore/AnimatedTrackRow.tsx`

**Interfaces:**
- Produces: `PlaylistCard` 新增可选 prop `layoutId?: string`
- Consumes: `fadeRise`、`springGentle`（motion-presets）

- [ ] **Step 1: PlaylistCard 支持 layoutId**

`src/components/Explore/PlaylistCard.tsx` 改为：

```tsx
import { motion } from 'motion/react'
import { BorderGlow } from '../BorderGlow/BorderGlow'
import { TiltCard } from '../ui/TiltCard'
import { springGentle } from '../../lib/motion-presets'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistCard.module.css'

interface PlaylistCardProps {
  playlist: Playlist
  onClick(): void
  /** 传入时封面参与共享元素转场（与详情页头部封面同 ID）。 */
  layoutId?: string
}

export function PlaylistCard({ playlist, onClick, layoutId }: PlaylistCardProps) {
  return (
    <TiltCard className={styles.glowWrap}>
      <BorderGlow borderRadius={16}>
        <button className={`${styles.card} no-drag`} onClick={onClick}>
          <motion.div className={styles.coverWrap} layoutId={layoutId} transition={springGentle}>
            {playlist.cover
              ? <img className={styles.cover} src={playlist.cover} alt="" loading="lazy" />
              : <div className={styles.coverFallback} />}
          </motion.div>
          <p className={styles.name}>{playlist.name}</p>
          <p className={styles.meta}>{playlist.trackCount} 首</p>
        </button>
      </BorderGlow>
    </TiltCard>
  )
}
```

（`layoutId` 为 `undefined` 时 motion.div 不参与 layout 动画，行为等价原 div。）

- [ ] **Step 2: ExplorePage 详情接线**

`src/pages/ExplorePage.tsx`：

imports 增加：

```tsx
import { motion } from 'motion/react'
import { fadeRise, springGentle } from '../lib/motion-presets'
```

推荐歌单 map 里给 PlaylistCard 传 `layoutId={`explore-cover-${String(pl.id)}`}`。

详情分支改为（结构不变，仅封面换 motion.img、非封面内容包错峰容器）：

```tsx
if (detail) {
  return (
    <div className={styles.page} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />
      <div className={styles.detailHeader}>
        <button className={`${styles.backBtn} no-drag`} onClick={() => { setTopOpacity(0); setBottomOpacity(0); setDetail(null) }}>← 返回</button>
        <div className={styles.detailMeta}>
          {detail.playlist.cover && (
            <motion.img
              className={styles.detailCover}
              src={detail.playlist.cover}
              alt=""
              layoutId={`explore-cover-${String(detail.playlist.id)}`}
              transition={springGentle}
            />
          )}
          <motion.div variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
            <h1 className={styles.detailTitle}><GradientText>{detail.playlist.name}</GradientText></h1>
            <p className={styles.detailSub}>{detail.tracks.length} 首</p>
          </motion.div>
        </div>
      </div>
      <motion.div className={styles.trackList} variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
        {detail.tracks.map((t, i) => (
          <AnimatedTrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} delay={i * 0.05} />
        ))}
      </motion.div>
      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
    </div>
  )
}
```

- [ ] **Step 3: LibraryPage 详情接线**

`src/pages/LibraryPage.tsx`：同样加两个 import；歌单 grid 的 PlaylistCard 传 `layoutId={`library-cover-${String(pl.id)}`}`；详情分支做与 Step 2 完全相同的三处改动（封面 `motion.img layoutId={`library-cover-${String(detail.playlist.id)}`}`、标题块与 trackList 包 fadeRise + delay 0.15 容器）。

- [ ] **Step 4: AnimatedTrackRow delay 封顶**

`src/components/Explore/AnimatedTrackRow.tsx` 的 transition 改为：

```tsx
transition={{ duration: 0.2, delay: Math.min(delay, 0.4) }}
```

（组件内单点封顶，三处调用方不改；注释说明：长列表末行不再累积等待。）

- [ ] **Step 5: 验证 + Commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过

```bash
git add src/components/Explore/PlaylistCard.tsx src/pages/ExplorePage.tsx src/pages/LibraryPage.tsx src/components/Explore/AnimatedTrackRow.tsx
git commit -m "feat: shared-element cover transition into playlist detail, cap track stagger delay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 全量验证 + 手动验收

**Files:** 无新改动（验证任务）

- [ ] **Step 1: 全量回归**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全部通过（33 tests）

- [ ] **Step 2: 手动验收（`npm run dev`）**

1. Explore 点歌单卡 → 封面从卡片平滑飞到详情头部；标题与列表在封面落位后浮现；返回 → 封面飞回卡片
2. Library 歌单 grid 同样生效
3. 顶栏切页（Explore ↔ Library ↔ Settings）→ 旧页缩小下沉、新页纵深浮入，双页交叠无闪黑
4. 进入歌手页再后退 → 横移方向与前进相反
5. 100+ 行歌单：快速滚到底，末行进入视口 ≤0.4s 内出现
6. 系统开「减弱动态」→ 共享元素/纵深转场退化为淡入淡出，功能正常
