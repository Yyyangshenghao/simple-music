# 探索页布局改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构探索页为方案 A —— 去掉 Banner，「每日推荐」「私人雷达」常驻方卡 + 可拖拽甩卡换推荐的 Stack 歌单堆 + 最近播放占位 rail。

**Architecture:** 前端 React + zustand + motion（CSS Modules），后端为 `server/routes/netease.ts` 里的手写路由（基于 NeteaseCloudMusicApi）。Stack 的补卡/去重/回收抽成纯函数 `stack-pool.ts`（唯一有单测的新逻辑），Stack 组件受控化，卡片数组由 ExplorePage 持有。

**Tech Stack:** React 18 + TypeScript、motion（已在依赖，`motion/react`）、zustand、vitest、CSS Modules、NeteaseCloudMusicApi。

**Spec:** `docs/superpowers/specs/2026-07-04-explore-layout-redesign-design.md`

## Global Constraints

- **工作区已有用户未提交改动（master 分支很脏）**：每次提交只 `git add` 本任务明确列出的文件，**绝不 `git add -A` / `git add .`**。
- 不新增任何 npm 依赖（motion `^12.42.1` 已有）。
- UI 文案全部中文；所有歌单卡近正方形。
- 样式用 CSS Modules + 现有 token（`--sm-bg-elevated`、`--sm-bg-overlay`、`--sm-border`、`--sm-text-primary`、`--sm-text-secondary`、`--sm-accent`、`--sm-text-on-accent`、`--sm-radius-card`、`--sm-radius-pill`、`--sm-shadow`、`--sm-blur`）。
- 动效用 `src/lib/motion-presets.ts` 里的预设；遵守 `useReducedMotion()`（参照 `src/components/ui/TiltCard.tsx` 的模式）。
- 仓库没有组件 DOM 测试基建（vitest 无 jsdom），**不要为本计划引入**；组件验证 = `npm run typecheck` + 手测。
- 验证命令：`npm run test`（vitest run）、`npm run typecheck`。仓库没有 lint script。
- 交互文案/注释风格：跟随现有代码的简短中文注释习惯，只注释代码本身说不清的约束。

---

### Task 1: stack-pool 纯函数（池子补卡/去重/回收）

**Files:**
- Create: `src/lib/stack-pool.ts`
- Test: `src/lib/stack-pool.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，泛型）
- Produces（Task 7 的 ExplorePage 依赖这些签名）:
  - `interface StackPoolState<T> { hand: T[]; reserve: T[]; discarded: T[] }`（`hand` 末位 = 顶卡）
  - `createPool<T>(items: T[], handSize?: number): StackPoolState<T>`（默认 handSize 5）
  - `swipeTop<T>(state: StackPoolState<T>): StackPoolState<T>`
  - `refill<T>(state: StackPoolState<T>, incoming: T[], getId: (t: T) => unknown): StackPoolState<T>`
  - `needsRefill<T>(state: StackPoolState<T>, threshold?: number): boolean`（默认 threshold 5）

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/stack-pool.test.ts
import { describe, expect, it } from 'vitest'
import { createPool, needsRefill, refill, swipeTop } from './stack-pool'

const ids = (arr: { id: number }[]) => arr.map((x) => x.id)
const items = (...ns: number[]) => ns.map((id) => ({ id }))

describe('createPool', () => {
  it('前 handSize 个进手牌（第一项是顶卡=末位），其余进池子', () => {
    const pool = createPool(items(1, 2, 3, 4, 5, 6, 7), 5)
    // 渲染顺序：后渲染者在上层，所以 hand 末位是顶卡；items[0] 应当是顶卡
    expect(ids(pool.hand)).toEqual([5, 4, 3, 2, 1])
    expect(ids(pool.reserve)).toEqual([6, 7])
    expect(pool.discarded).toEqual([])
  })

  it('数量不足 handSize 时全部进手牌', () => {
    const pool = createPool(items(1, 2), 5)
    expect(ids(pool.hand)).toEqual([2, 1])
    expect(pool.reserve).toEqual([])
  })
})

describe('swipeTop', () => {
  it('顶卡移到 discarded，池子补一张到堆底（hand 开头）', () => {
    const pool = createPool(items(1, 2, 3, 4, 5, 6, 7), 5)
    const next = swipeTop(pool)
    expect(ids(next.hand)).toEqual([6, 5, 4, 3, 2])
    expect(ids(next.reserve)).toEqual([7])
    expect(ids(next.discarded)).toEqual([1])
  })

  it('池子耗尽时从最早甩出的卡回收', () => {
    let pool = createPool(items(1, 2, 3), 3) // reserve 空
    pool = swipeTop(pool) // 甩 1 → 无卡可补，discarded=[1] 直接回收 1
    expect(ids(pool.hand)).toEqual([1, 3, 2])
    expect(pool.discarded).toEqual([])
  })

  it('空手牌是 no-op', () => {
    const empty = { hand: [], reserve: [], discarded: [] }
    expect(swipeTop(empty)).toBe(empty)
  })
})

describe('refill', () => {
  it('按 id 对 hand+reserve+discarded 全量去重后追加到池子', () => {
    let pool = createPool(items(1, 2, 3, 4, 5, 6), 5)
    pool = swipeTop(pool) // discarded=[1]
    const next = refill(pool, items(1, 3, 6, 8, 9, 8), (x) => x.id)
    expect(ids(next.reserve)).toEqual([8, 9]) // 1/3/6 已存在，8 只进一次
  })

  it('全部重复时原样返回（引用不变，避免无谓重渲染）', () => {
    const pool = createPool(items(1, 2, 3), 3)
    expect(refill(pool, items(1, 2), (x) => x.id)).toBe(pool)
  })
})

describe('needsRefill', () => {
  it('池子余量 <= 阈值时需要补货', () => {
    expect(needsRefill(createPool(items(1, 2, 3, 4, 5, 6, 7), 5))).toBe(true) // reserve=2
    const big = createPool(Array.from({ length: 20 }, (_, i) => ({ id: i })), 5) // reserve=15
    expect(needsRefill(big)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/stack-pool.test.ts`
Expected: FAIL（Cannot find module './stack-pool'）

- [ ] **Step 3: 最小实现**

```ts
// src/lib/stack-pool.ts
// Stack 卡片堆的池子逻辑：手牌（渲染中的卡，末位=顶卡）、池子（待补）、已甩出（池子耗尽时循环回收）。

export interface StackPoolState<T> {
  hand: T[]
  reserve: T[]
  discarded: T[]
}

export function createPool<T>(items: T[], handSize = 5): StackPoolState<T> {
  // 渲染顺序后者在上层，reverse 让 items[0] 成为顶卡
  return { hand: items.slice(0, handSize).reverse(), reserve: items.slice(handSize), discarded: [] }
}

export function swipeTop<T>(state: StackPoolState<T>): StackPoolState<T> {
  if (state.hand.length === 0) return state
  const top = state.hand[state.hand.length - 1]
  const rest = state.hand.slice(0, -1)
  const discarded = [...state.discarded, top]
  if (state.reserve.length > 0) {
    return { hand: [state.reserve[0], ...rest], reserve: state.reserve.slice(1), discarded }
  }
  // 池子耗尽（拉新全重复或请求失败）：回收最早甩出的卡，保证拖拽永远有下一张
  const [recycled, ...remaining] = discarded
  return { hand: [recycled, ...rest], reserve: [], discarded: remaining }
}

export function refill<T>(state: StackPoolState<T>, incoming: T[], getId: (t: T) => unknown): StackPoolState<T> {
  const seen = new Set([...state.hand, ...state.reserve, ...state.discarded].map(getId))
  const fresh: T[] = []
  for (const item of incoming) {
    const id = getId(item)
    if (seen.has(id)) continue
    seen.add(id)
    fresh.push(item)
  }
  if (fresh.length === 0) return state
  return { ...state, reserve: [...state.reserve, ...fresh] }
}

export function needsRefill<T>(state: StackPoolState<T>, threshold = 5): boolean {
  return state.reserve.length <= threshold
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/stack-pool.test.ts`
Expected: PASS（8 个用例全绿）

- [ ] **Step 5: 全量测试 + 提交**

Run: `npm run test && npm run typecheck`
Expected: 全部 PASS（原有 lyric-parser/stores 测试不受影响）

```bash
git add src/lib/stack-pool.ts src/lib/stack-pool.test.ts
git commit -m "feat: Stack 卡片池纯函数（补卡/去重/循环回收）"
```

---

### Task 2: 后端 —— 推荐池扩到 30、歌单带简介、新增私人雷达端点

**Files:**
- Modify: `server/lib/netease-client.ts:203-232`（MappedPlaylist + mapDiscoverPlaylist）
- Modify: `server/routes/netease.ts:111-132`（recommend/playlists），并在 recommend/songs 块（约 149 行）之后插入 radar 块

**Interfaces:**
- Consumes: `call(name, params)`、`getCookie(ctx, 'netease')`、`asObj/asArr/asStr/asNum`、`mapDiscoverPlaylist`、`mapSongRecord`、`sendJson`（全部已存在于这两个文件）
- Produces:
  - `GET /api/netease/recommend/playlists` → `{ playlists: MappedPlaylist[] }`，最多 30 个，每个带 `description`
  - `GET /api/netease/radar` → `{ playlist: MappedPlaylist | null, tracks: MappedSong[] }`（null = 不可用，前端隐藏卡片）
  - `MappedPlaylist` 新增字段 `description: string`

- [ ] **Step 1: MappedPlaylist 加 description**

在 `server/lib/netease-client.ts` 中：

```ts
export interface MappedPlaylist {
  provider: string
  source: string
  type: string
  id: unknown
  name: string
  cover: string
  trackCount: number
  playCount: number
  creator: string
  tag: string
  description: string
}
```

`mapDiscoverPlaylist` 的 return 里在 `tag` 之后加一行：

```ts
    tag: tag || asStr(pl.alg),
    description: asStr(pl.copywriter || pl.description),
```

（`personalized` 返回 `copywriter` 一句话文案，`playlist_detail` 返回 `description`，两者互补。）

- [ ] **Step 2: 改造 recommend/playlists**

把 `server/routes/netease.ts` 中 `if (pn === '/api/netease/recommend/playlists')` 整块（现为 111-132 行，含 `Promise.allSettled` 的 personalized + recommend_resource 双源）替换为单源 30 个：

```ts
  // ---------- Recommend Playlists（Stack 池子：单源 personalized，一次 30 个） ----------
  if (pn === '/api/netease/recommend/playlists') {
    try {
      const cookie = getCookie(ctx, 'netease')
      const resp = await call('personalized', { limit: 30, cookie, timestamp: Date.now() })
      const playlists = asArr(asObj(resp.body).result || [])
        .map((pl) => mapDiscoverPlaylist(pl, '推荐歌单'))
        .filter((pl) => pl.id && pl.name)
      sendJson(res, { playlists })
    } catch (err) {
      console.error('[RecommendPlaylists]', err)
      sendJson(res, { playlists: [] }, 500)
    }
    return true
  }
```

- [ ] **Step 3: 新增 /api/netease/radar**

文件顶部（import 之后）加常量：

```ts
/** 「私人雷达」官方共享歌单 id（社区通行做法：带登录 cookie 请求即返回个人化的每日 35 首）。 */
const RADAR_PLAYLIST_ID = '3136952023'
```

在 Recommend Songs 块（`if (pn === '/api/netease/recommend/songs') { ... }`，约 135-149 行）之后插入：

```ts
  // ---------- 私人雷达 ----------
  if (pn === '/api/netease/radar') {
    try {
      const cookie = getCookie(ctx, 'netease')
      if (!cookie) {
        sendJson(res, { playlist: null, tracks: [] })
        return true
      }
      const resp = await call('playlist_detail', { id: RADAR_PLAYLIST_ID, cookie, timestamp: Date.now() })
      const raw = asObj(asObj(resp.body).playlist)
      const tracks = asArr(raw.tracks).map(mapSongRecord).filter((s) => s.id && s.name)
      const playlist = mapDiscoverPlaylist(raw, '私人雷达')
      if (!playlist.id || tracks.length === 0) {
        sendJson(res, { playlist: null, tracks: [] })
        return true
      }
      sendJson(res, { playlist, tracks })
    } catch (err) {
      console.error('[Radar]', err)
      sendJson(res, { playlist: null, tracks: [] }, 500)
    }
    return true
  }
```

确认文件顶部 import 里已有 `asStr`、`mapSongRecord`（recommend/songs 块已在用 `mapSongRecord`，`mapDiscoverPlaylist` 也已导入；缺谁补谁）。

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: curl 验证（spec 要求的雷达 id 实测）**

启动开发服务器（后台）：`npm run server:dev`，从启动日志确认端口（记为 `$PORT`），然后：

```bash
curl -s "http://127.0.0.1:$PORT/api/netease/recommend/playlists" | head -c 600
curl -s "http://127.0.0.1:$PORT/api/netease/radar" | head -c 600
```

Expected:
- recommend/playlists 返回接近 30 个歌单，每个带非空 `description`（copywriter）。
- radar：若服务端存有网易登录 cookie → `playlist.name` 含「私人雷达」、`tracks` 约 35 首；若未登录 → `{"playlist":null,"tracks":[]}`（同样算验证通过，前端会隐藏卡片）。
- **若已登录但 radar 返回 null/报错**：说明固定 id 失效 —— 保留端点与前端隐藏逻辑不变，在提交信息里注明「雷达 id 待换」，不阻塞后续任务。

验证完停掉后台服务器。

- [ ] **Step 6: 提交**

```bash
git add server/lib/netease-client.ts server/routes/netease.ts
git commit -m "feat: 推荐歌单池扩到 30 并带简介，新增私人雷达端点"
```

---

### Task 3: 前端类型与服务层（description、getDailySongs、getRadarPlaylist）

**Files:**
- Modify: `src/types/domain.ts:42-54`（Playlist）
- Modify: `src/lib/music-service.ts`
- Modify: `src/lib/netease-music-service.ts`

**Interfaces:**
- Consumes: Task 2 的 `/api/netease/radar`、既有 `/api/netease/recommend/songs`
- Produces（Task 6/7 依赖）:
  - `Playlist.description?: string`
  - `interface RadarPlaylist { playlist: Playlist; tracks: Track[] }`（导出自 `music-service.ts`）
  - `MusicService.getDailySongs?(): Promise<Track[]>`
  - `MusicService.getRadarPlaylist?(): Promise<RadarPlaylist | null>`
  - **本任务不删除** `getRecommendBanners`/`getNewSongs`（Task 7 连同页面一起删，保证每步 tsc 绿）

- [ ] **Step 1: Playlist 加 description**

`src/types/domain.ts` 的 `Playlist` 接口，在 `tag?: string` 之后加：

```ts
  description?: string
```

- [ ] **Step 2: MusicService 加可选方法**

`src/lib/music-service.ts` 在接口末尾（`getLyrics` 之后）加：

```ts
  /** 每日歌曲推荐（网易专属；未实现的音源不渲染每日推荐卡）。 */
  getDailySongs?(): Promise<Track[]>
  /** 私人雷达歌单（网易专属；null = 不可用，隐藏卡片）。 */
  getRadarPlaylist?(): Promise<RadarPlaylist | null>
```

并在接口外导出：

```ts
export interface RadarPlaylist {
  playlist: Playlist
  tracks: Track[]
}
```

- [ ] **Step 3: 网易实现**

`src/lib/netease-music-service.ts`（import 行加 `type { MusicService, RadarPlaylist }`，注意 `RadarPlaylist` 从 `./music-service` 导入），类内加：

```ts
  async getDailySongs(): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/netease/recommend/songs')
    return res.songs ?? []
  }

  async getRadarPlaylist(): Promise<RadarPlaylist | null> {
    const res = await api.get<{ playlist: Playlist | null; tracks: Track[] }>('/api/netease/radar')
    if (!res.playlist || !res.tracks?.length) return null
    return { playlist: res.playlist, tracks: res.tracks }
  }
```

QQ 服务不实现（可选方法，天然缺席即降级）。

- [ ] **Step 4: 验证 + 提交**

Run: `npm run typecheck && npm run test`
Expected: PASS

```bash
git add src/types/domain.ts src/lib/music-service.ts src/lib/netease-music-service.ts
git commit -m "feat: service 层新增每日推荐/私人雷达可选能力与歌单简介字段"
```

---

### Task 4: Stack 组件（受控卡片堆）

**Files:**
- Create: `src/components/Explore/Stack.tsx`
- Create: `src/components/Explore/Stack.module.css`

**Interfaces:**
- Consumes: `Playlist`（含 Task 3 的 `description`）、motion/react
- Produces（Task 7 依赖）:
  - `Stack` 组件，props：`{ cards: Playlist[]; onSwipe(): void; onCardClick(playlist: Playlist): void }`
  - 约定：`cards` 末位 = 顶卡（与 stack-pool 的 `hand` 一致）；只有顶卡可拖拽、可点击

- [ ] **Step 1: 组件实现**

```tsx
// src/components/Explore/Stack.tsx
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import type { PanInfo } from 'motion/react'
import type { Playlist } from '../../types/domain'
import styles from './Stack.module.css'

/** 拖拽甩卡阈值（px），超过即视为把顶卡甩出。 */
const SENSITIVITY = 170

interface CardRotateProps {
  children: ReactNode
  active: boolean
  reduced: boolean
  onSwipe(): void
}

/** 顶卡拖拽层：跟手位移 + 3D 旋转（reduced-motion 时仅位移），超阈值甩出。 */
function CardRotate({ children, active, reduced, onSwipe }: CardRotateProps) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useTransform(y, [-100, 100], [60, -60])
  const rotateY = useTransform(x, [-100, 100], [-60, 60])

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (Math.abs(info.offset.x) > SENSITIVITY || Math.abs(info.offset.y) > SENSITIVITY) {
      onSwipe()
    }
    x.set(0)
    y.set(0)
  }

  // 受控模式下只有顶卡可拖：非顶卡拖拽会错甩掉顶卡
  if (!active) {
    return <div className={styles.cardStatic}>{children}</div>
  }

  return (
    <motion.div
      className={styles.cardRotate}
      style={reduced ? { x, y } : { x, y, rotateX, rotateY }}
      drag
      dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
      dragElastic={0.6}
      whileTap={{ cursor: 'grabbing' }}
      onDragEnd={handleDragEnd}
    >
      {children}
    </motion.div>
  )
}

interface StackProps {
  /** 顶卡在数组末位（后渲染者在上层）。 */
  cards: Playlist[]
  onSwipe(): void
  onCardClick(playlist: Playlist): void
}

export function Stack({ cards, onSwipe, onCardClick }: StackProps) {
  const reduced = useReducedMotion() ?? false
  // 每张卡固定一个 -3°~3° 的“杂乱角”，按 id 记忆，重渲染不跳动
  const rotations = useRef(new Map<unknown, number>())

  function messyAngle(id: unknown): number {
    if (reduced) return 0
    let angle = rotations.current.get(id)
    if (angle === undefined) {
      angle = Math.random() * 6 - 3
      rotations.current.set(id, angle)
    }
    return angle
  }

  return (
    <div className={styles.stackContainer}>
      {cards.map((pl, index) => {
        const isTop = index === cards.length - 1
        return (
          <CardRotate key={String(pl.id)} active={isTop} reduced={reduced} onSwipe={onSwipe}>
            <motion.div
              className={styles.card}
              onTap={isTop ? () => onCardClick(pl) : undefined}
              animate={{
                rotateZ: (cards.length - index - 1) * 4 + messyAngle(pl.id),
                scale: 1 + index * 0.06 - cards.length * 0.06,
                transformOrigin: '90% 90%',
              }}
              initial={false}
              transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 20 }}
            >
              {pl.cover
                ? <img className={styles.cover} src={pl.cover} alt="" draggable={false} loading="lazy" />
                : <div className={styles.coverFallback} />}
              <div className={styles.nameOverlay}>{pl.name}</div>
            </motion.div>
          </CardRotate>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: 样式**

```css
/* src/components/Explore/Stack.module.css */
.stackContainer {
  position: relative;
  width: clamp(200px, 26vw, 260px);
  aspect-ratio: 1;
  perspective: 600px;
}

.cardRotate,
.cardStatic {
  position: absolute;
  inset: 0;
}

.cardRotate { cursor: grab; }

.card {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  overflow: hidden;
  background: var(--sm-bg-elevated);
  box-shadow: var(--sm-shadow);
}

.cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.coverFallback {
  width: 100%;
  height: 100%;
  background: var(--sm-bg-elevated);
}

.nameOverlay {
  position: absolute;
  inset: auto 0 0 0;
  padding: 26px 12px 10px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

- [ ] **Step 3: 验证 + 提交**

Run: `npm run typecheck`
Expected: PASS（组件此时无人引用，属正常；不要为消除“未使用”而临时挂载）

```bash
git add src/components/Explore/Stack.tsx src/components/Explore/Stack.module.css
git commit -m "feat: 受控 Stack 卡片堆组件（拖拽甩卡/点击顶卡/reduced-motion 降级）"
```

---

### Task 5: HeroCard 常驻方卡 + RecentRail 占位

**Files:**
- Create: `src/components/Explore/HeroCard.tsx`
- Create: `src/components/Explore/HeroCard.module.css`
- Create: `src/components/Explore/RecentRail.tsx`
- Create: `src/components/Explore/RecentRail.module.css`

**Interfaces:**
- Consumes: `TiltCard`（`src/components/ui/TiltCard.tsx`）、`BorderGlow`（`src/components/BorderGlow/BorderGlow.tsx`，用法 `<BorderGlow borderRadius={16}>`）、`springGentle`
- Produces（Task 7 依赖）:
  - `HeroCard` props：`{ title: string; subtitle: string; cover?: string; badge?: ReactNode; layoutId?: string; onClick(): void }`
  - `RecentRail` 无 props（纯占位）

- [ ] **Step 1: HeroCard**

```tsx
// src/components/Explore/HeroCard.tsx
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { BorderGlow } from '../BorderGlow/BorderGlow'
import { TiltCard } from '../ui/TiltCard'
import { springGentle } from '../../lib/motion-presets'
import styles from './HeroCard.module.css'

interface HeroCardProps {
  title: string
  subtitle: string
  cover?: string
  /** 左上角徽标（每日推荐的日历数字）。 */
  badge?: ReactNode
  /** 传入时封面参与共享元素转场（与详情页头部封面同 ID）。 */
  layoutId?: string
  onClick(): void
}

export function HeroCard({ title, subtitle, cover, badge, layoutId, onClick }: HeroCardProps) {
  return (
    <TiltCard className={styles.wrap}>
      <BorderGlow borderRadius={16}>
        <button className={`${styles.card} no-drag`} onClick={onClick}>
          <motion.div className={styles.coverWrap} layoutId={layoutId} transition={springGentle}>
            {cover
              ? <img className={styles.cover} src={cover} alt="" loading="lazy" />
              : <div className={styles.coverFallback} />}
          </motion.div>
          <div className={styles.scrim} />
          {badge && <div className={styles.badge}>{badge}</div>}
          <div className={styles.text}>
            <p className={styles.title}>{title}</p>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
        </button>
      </BorderGlow>
    </TiltCard>
  )
}
```

```css
/* src/components/Explore/HeroCard.module.css */
.wrap { width: 150px; }

.card {
  position: relative;
  display: block;
  width: 150px;
  height: 150px;
  border: none;
  border-radius: 16px;
  overflow: hidden;
  padding: 0;
  cursor: pointer;
  background: var(--sm-bg-elevated);
}

.coverWrap { position: absolute; inset: 0; }

.cover { width: 100%; height: 100%; object-fit: cover; }

.coverFallback { width: 100%; height: 100%; background: var(--sm-bg-elevated); }

.scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(transparent 35%, rgba(0, 0, 0, 0.75));
}

.badge {
  position: absolute;
  top: 10px;
  left: 10px;
  font-size: 26px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.text {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  text-align: left;
}

.title { margin: 0; font-size: 14px; font-weight: 700; color: #fff; }
.subtitle { margin: 2px 0 0; font-size: 11px; color: rgba(255, 255, 255, 0.75); }
```

- [ ] **Step 2: RecentRail**

```tsx
// src/components/Explore/RecentRail.tsx
import styles from './RecentRail.module.css'

/** 最近播放占位：先占住布局位置，数据后续用网易 record_recent_song 接入。 */
export function RecentRail() {
  return (
    <section className={styles.rail}>
      <h2 className={styles.title}>最近播放</h2>
      <div className={styles.row}>
        {Array.from({ length: 5 }, (_, i) => <div key={i} className={styles.placeholder} />)}
      </div>
      <p className={styles.hint}>即将上线</p>
    </section>
  )
}
```

```css
/* src/components/Explore/RecentRail.module.css */
.rail { margin: 8px 24px 32px; }

.title {
  font-size: 18px;
  font-weight: 700;
  color: var(--sm-text-primary);
  margin: 0 0 12px;
}

.row { display: flex; gap: 12px; }

.placeholder {
  width: 92px;
  height: 92px;
  border-radius: 14px;
  border: 1.5px dashed var(--sm-border);
  opacity: 0.45;
}

.hint { font-size: 12px; color: var(--sm-text-secondary); margin: 10px 0 0; }
```

- [ ] **Step 3: 验证 + 提交**

Run: `npm run typecheck`
Expected: PASS

```bash
git add src/components/Explore/HeroCard.tsx src/components/Explore/HeroCard.module.css src/components/Explore/RecentRail.tsx src/components/Explore/RecentRail.module.css
git commit -m "feat: 常驻方卡 HeroCard 与最近播放占位 RecentRail"
```

---

### Task 6: PlaylistPreviewModal 预览弹窗

**Files:**
- Create: `src/components/Explore/PlaylistPreviewModal.tsx`
- Create: `src/components/Explore/PlaylistPreviewModal.module.css`

**Interfaces:**
- Consumes: `useMusicService().getPlaylistDetail(id)`、`usePlaylistStore.getState().setQueue(tracks, index)`、`Playlist.description`
- Produces（Task 7 依赖）: `PlaylistPreviewModal` props：`{ playlist: Playlist | null; onClose(): void }`（null 即关闭态，组件内部用 AnimatePresence 处理退场）

- [ ] **Step 1: 组件实现**

```tsx
// src/components/Explore/PlaylistPreviewModal.tsx
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMusicService } from '../../hooks/useMusicService'
import { usePlaylistStore } from '../../stores/playlist'
import { springGentle } from '../../lib/motion-presets'
import type { Playlist, Track } from '../../types/domain'
import styles from './PlaylistPreviewModal.module.css'

interface PlaylistPreviewModalProps {
  playlist: Playlist | null
  onClose(): void
}

/** Stack 顶卡的小卡预览：简介 + 可滚动曲目，不跳详情页。 */
export function PlaylistPreviewModal({ playlist, onClose }: PlaylistPreviewModalProps) {
  const service = useMusicService()
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)

  // 打开时才拉曲目；快速开合时丢弃过期响应
  useEffect(() => {
    if (!playlist) return
    let cancelled = false
    setTracks([])
    setLoading(true)
    service.getPlaylistDetail(playlist.id)
      .then((ts) => { if (!cancelled) setTracks(ts) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [playlist, service])

  useEffect(() => {
    if (!playlist) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playlist, onClose])

  function playAll() {
    if (tracks.length === 0) return
    usePlaylistStore.getState().setQueue(tracks, 0)
    onClose()
  }

  function playTrack(index: number) {
    usePlaylistStore.getState().setQueue(tracks, index)
  }

  return (
    <AnimatePresence>
      {playlist && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={styles.panel}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={springGentle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              {playlist.cover
                ? <img className={styles.cover} src={playlist.cover} alt="" />
                : <div className={styles.cover} />}
              <div className={styles.meta}>
                <h3 className={styles.name}>{playlist.name}</h3>
                {playlist.description && <p className={styles.desc}>{playlist.description}</p>}
              </div>
              <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">✕</button>
            </div>
            <div className={styles.actions}>
              <button className={styles.playAll} onClick={playAll} disabled={tracks.length === 0}>▶ 播放全部</button>
              <span className={styles.count}>{loading ? '加载中…' : `${tracks.length} 首`}</span>
            </div>
            <div className={styles.list}>
              {tracks.map((t, i) => (
                <button key={`${String(t.id)}-${i}`} className={styles.row} onClick={() => playTrack(i)}>
                  <span className={styles.index}>{i + 1}</span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{t.name}</span>
                    <span className={styles.rowArtist}>{t.artist}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: 样式**

```css
/* src/components/Explore/PlaylistPreviewModal.module.css */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: var(--sm-blur);
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 48px));
  max-height: min(560px, calc(100vh - 96px));
  overflow: hidden;
  background: var(--sm-bg-overlay);
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius-card);
  box-shadow: var(--sm-shadow);
}

.header { display: flex; gap: 14px; padding: 16px 16px 12px; }

.cover {
  width: 84px;
  height: 84px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--sm-bg-elevated);
}

.meta { flex: 1; min-width: 0; }

.name { margin: 0 0 4px; font-size: 16px; font-weight: 700; color: var(--sm-text-primary); }

.desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--sm-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.closeBtn {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--sm-text-secondary);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 4px;
}

.actions { display: flex; align-items: center; gap: 10px; padding: 0 16px 12px; }

.playAll {
  border: none;
  cursor: pointer;
  background: var(--sm-accent);
  color: var(--sm-text-on-accent);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 18px;
  border-radius: var(--sm-radius-pill);
}

.playAll:disabled { opacity: 0.5; cursor: default; }

.count { font-size: 12px; color: var(--sm-text-secondary); }

.list {
  overflow-y: auto;
  padding: 0 8px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--sm-border) transparent;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 10px;
  text-align: left;
}

.row:hover { background: var(--sm-bg-elevated); }

.index {
  width: 22px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--sm-text-secondary);
  text-align: right;
}

.rowText { min-width: 0; display: flex; flex-direction: column; }

.rowName {
  font-size: 13px;
  color: var(--sm-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rowArtist {
  font-size: 11px;
  color: var(--sm-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 3: 验证 + 提交**

Run: `npm run typecheck`
Expected: PASS

```bash
git add src/components/Explore/PlaylistPreviewModal.tsx src/components/Explore/PlaylistPreviewModal.module.css
git commit -m "feat: 歌单预览小卡弹窗（简介 + 可滚动曲目 + 播放全部）"
```

---

### Task 7: ExplorePage 重构（组装 + 删 Banner + 接口清理）

**Files:**
- Modify: `src/pages/ExplorePage.tsx`（整文件替换）
- Modify: `src/pages/ExplorePage.module.css`（追加英雄区样式，保留 .page/.detail* 等既有类）
- Modify: `src/lib/music-service.ts`（删 `getRecommendBanners`/`getNewSongs`，同时删掉不再需要的 `Banner` import）
- Modify: `src/lib/netease-music-service.ts`（删这两个方法与 `Banner` import）
- Modify: `src/lib/qq-music-service.ts`（删这两个方法与 `Banner` import）
- Delete: `src/components/Explore/HeroBanner.tsx`、`src/components/Explore/HeroBanner.module.css`

**Interfaces:**
- Consumes: Task 1 `stack-pool`、Task 3 服务层、Task 4 `Stack`、Task 5 `HeroCard`/`RecentRail`、Task 6 `PlaylistPreviewModal`
- Produces: 无（终端组装）

- [ ] **Step 1: 确认待删符号引用范围**

Run: `grep -rn "HeroBanner\|getRecommendBanners\|getNewSongs" src/ --include="*.ts" --include="*.tsx"`
Expected: 只出现在 ExplorePage、music-service、netease-music-service、qq-music-service、HeroBanner 自身。若有其他引用者，先停下评估再动手。

- [ ] **Step 2: ExplorePage 整文件替换**

```tsx
// src/pages/ExplorePage.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMusicService } from '../hooks/useMusicService'
import { useScrollGradient } from '../hooks/useScrollGradient'
import { usePlaylistStore } from '../stores/playlist'
import { useNavigationStore } from '../stores/navigation'
import { AnimatedTrackRow } from '../components/Explore/AnimatedTrackRow'
import { HeroCard } from '../components/Explore/HeroCard'
import { RecentRail } from '../components/Explore/RecentRail'
import { Stack } from '../components/Explore/Stack'
import { PlaylistPreviewModal } from '../components/Explore/PlaylistPreviewModal'
import { GradientText } from '../components/ui/GradientText'
import { fadeRise, springGentle } from '../lib/motion-presets'
import { createPool, needsRefill, refill, swipeTop, type StackPoolState } from '../lib/stack-pool'
import type { RadarPlaylist } from '../lib/music-service'
import type { Playlist, Track } from '../types/domain'
import styles from './ExplorePage.module.css'

const EMPTY_POOL: StackPoolState<Playlist> = { hand: [], reserve: [], discarded: [] }

export function ExplorePage() {
  const service = useMusicService()
  const [pool, setPool] = useState(EMPTY_POOL)
  const [poolLoaded, setPoolLoaded] = useState(false)
  const [dailySongs, setDailySongs] = useState<Track[]>([])
  const [radar, setRadar] = useState<RadarPlaylist | null>(null)
  const [preview, setPreview] = useState<Playlist | null>(null)
  const refilling = useRef(false)

  // 歌单详情提升到导航 store：顶栏前进/后退可穿越
  const currentView = useNavigationStore((s) => s.currentView)
  const detail =
    typeof currentView === 'object' && currentView.type === 'playlist' && currentView.from === 'explore'
      ? currentView
      : null

  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()

  useEffect(() => {
    setPool(EMPTY_POOL)
    setPoolLoaded(false)
    setDailySongs([])
    setRadar(null)
    void service.getRecommendPlaylists()
      .then((pls) => setPool(createPool(pls)))
      .catch(() => {})
      .finally(() => setPoolLoaded(true))
    void service.getDailySongs?.().then(setDailySongs).catch(() => {})
    void service.getRadarPlaylist?.().then(setRadar).catch(() => {})
  }, [service])

  // 池子见底时带新 timestamp 补一批（id 去重；全重复时由 swipeTop 回收循环）
  useEffect(() => {
    if (pool.hand.length === 0 || !needsRefill(pool) || refilling.current) return
    refilling.current = true
    service.getRecommendPlaylists()
      .then((pls) => setPool((p) => refill(p, pls, (x) => x.id)))
      .catch(() => {})
      .finally(() => { refilling.current = false })
  }, [pool, service])

  // 详情开合的所有路径（页内返回键、顶栏前进/后退）都重置滚动渐变遮罩
  useEffect(() => {
    setTopOpacity(0)
    setBottomOpacity(0)
  }, [detail, setTopOpacity, setBottomOpacity])

  const handleSwipe = useCallback(() => setPool((p) => swipeTop(p)), [])

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  function openDaily() {
    if (dailySongs.length === 0) return
    const pl: Playlist = {
      provider: 'netease',
      source: 'netease',
      type: 'playlist',
      id: 'netease-daily-songs',
      name: '每日推荐',
      cover: dailySongs[0]?.cover ?? '',
      trackCount: dailySongs.length,
      playCount: 0,
      creator: '',
    }
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist: pl, tracks: dailySongs })
  }

  function openRadar() {
    if (!radar) return
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist: radar.playlist, tracks: radar.tracks })
  }

  if (detail) {
    return (
      <div className={styles.page} onScroll={handleScroll}>
        <div className="topGradient" style={{ opacity: topOpacity }} />
        <div className={styles.detailHeader}>
          <button className={`${styles.backBtn} no-drag`} onClick={() => useNavigationStore.getState().goBack()}>← 返回</button>
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
            <AnimatedTrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} delay={0.15 + i * 0.05} />
          ))}
        </motion.div>
        <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
      </div>
    )
  }

  const top = pool.hand.length > 0 ? pool.hand[pool.hand.length - 1] : null
  const hasSideCards = dailySongs.length > 0 || radar !== null

  return (
    <div className={styles.page} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />

      <motion.section className={styles.hero} variants={fadeRise} initial="hidden" animate="visible" transition={springGentle}>
        {hasSideCards && (
          <div className={styles.heroCards}>
            {dailySongs.length > 0 && (
              <HeroCard
                title="每日推荐"
                subtitle={`${dailySongs.length} 首 · 每天更新`}
                cover={dailySongs[0]?.cover}
                badge={<span>{new Date().getDate()}</span>}
                layoutId="explore-cover-netease-daily-songs"
                onClick={openDaily}
              />
            )}
            {radar && (
              <HeroCard
                title="私人雷达"
                subtitle={`${radar.tracks.length} 首 · 根据你的口味`}
                cover={radar.playlist.cover}
                layoutId={`explore-cover-${String(radar.playlist.id)}`}
                onClick={openRadar}
              />
            )}
          </div>
        )}

        {pool.hand.length > 0 && (
          <div className={styles.stage}>
            <Stack cards={pool.hand} onSwipe={handleSwipe} onCardClick={setPreview} />
            {top && (
              <div className={styles.topInfo}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={String(top.id)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                  >
                    <p className={styles.topName}>{top.name}</p>
                    {top.description && <p className={styles.topDesc}>{top.description}</p>}
                  </motion.div>
                </AnimatePresence>
                <p className={styles.topHint}>拖拽换一张 · 点击看曲目</p>
              </div>
            )}
          </div>
        )}

        {poolLoaded && pool.hand.length === 0 && !hasSideCards && (
          <p className={styles.empty}>暂时没有推荐内容</p>
        )}
      </motion.section>

      {service.getDailySongs && <RecentRail />}

      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
      <PlaylistPreviewModal playlist={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
```

（最近播放是网易专属，用「service 是否具备网易专属能力」即 `service.getDailySongs` 存在与否来判断，避免再订阅一次 settings store。）

- [ ] **Step 3: ExplorePage.module.css 追加英雄区样式**

保留文件现有全部内容（`.page`、`.section`、`.sectionTitle`、`.trackList`、`.detail*`、`.backBtn`），在末尾追加：

```css
/* ---------- 英雄区（方案 A：常驻卡列 + Stack 舞台） ---------- */
.hero {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  min-height: 300px;
  padding: 16px 24px 8px;
}

.heroCards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stage {
  display: flex;
  align-items: center;
  gap: 24px;
}

.topInfo { width: 170px; }

.topName {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
  color: var(--sm-text-primary);
}

.topDesc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--sm-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.topHint {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--sm-text-secondary);
  opacity: 0.7;
}

.empty {
  padding: 48px 0;
  text-align: center;
  color: var(--sm-text-secondary);
}
```

- [ ] **Step 4: 接口清理**

- `src/lib/music-service.ts`：删除 `getRecommendBanners(): Promise<Banner[]>` 和 `getNewSongs(): Promise<Track[]>` 两行；import 行去掉 `Banner`。
- `src/lib/netease-music-service.ts`：删除 `getRecommendBanners`、`getNewSongs` 两个方法；import 行去掉 `Banner`。
- `src/lib/qq-music-service.ts`：删除 `getRecommendBanners`、`getNewSongs` 两个方法；import 行去掉 `Banner`。
- 删除文件：`src/components/Explore/HeroBanner.tsx`、`src/components/Explore/HeroBanner.module.css`（`git rm` 即可）。
- `src/types/domain.ts` 的 `Banner` 类型**保留**（若 typecheck 报 unused 再评估，正常导出类型不报）。
- 后端 `/api/netease/banner` 路由保留不动。

- [ ] **Step 5: 全量验证**

Run: `npm run typecheck && npm run test`
Expected: PASS

Run: `grep -rn "HeroBanner\|getRecommendBanners\|getNewSongs" src/`
Expected: 无任何输出

- [ ] **Step 6: 提交**

```bash
git add src/pages/ExplorePage.tsx src/pages/ExplorePage.module.css src/lib/music-service.ts src/lib/netease-music-service.ts src/lib/qq-music-service.ts
git rm src/components/Explore/HeroBanner.tsx src/components/Explore/HeroBanner.module.css
git commit -m "feat: 探索页改版为常驻卡 + Stack 卡片堆布局，移除 Banner"
```

---

### Task 8: 三态手测与回归

**Files:** 无新文件（发现问题就地修，修完补充提交）

**Interfaces:** 无

- [ ] **Step 1: 启动应用**

Run: `npm run dev`（electron-vite dev，Electron 窗口会自己弹出）

- [ ] **Step 2: 网易已登录态**

- [ ] 每日推荐卡显示（日期徽标 + 封面），点击进详情，封面共享元素转场正常，返回正常
- [ ] 私人雷达卡显示，点击进详情为约 35 首（若 Task 2 验证时 radar 拿不到，则本项改为验证「卡片隐藏且布局不破」）
- [ ] Stack 显示 5 张堆叠卡，拖拽超阈值甩卡、松手回弹都正常；连续甩 30+ 张不重复（补货生效），断网甩卡进入循环不崩
- [ ] 右侧歌单名/简介随顶卡淡入淡出切换
- [ ] 点击顶卡弹出预览弹窗：简介、曲目滚动、播放全部、单曲点播、Esc/遮罩/✕ 关闭
- [ ] 最近播放占位 rail 显示
- [ ] 系统开启「减弱动态」后：卡堆无 3D 旋转、无杂乱角，拖拽甩卡仍可用

- [ ] **Step 3: 网易未登录态**（设置里退出网易登录后回到探索页）

- [ ] 每日推荐/私人雷达卡隐藏，Stack 水平居中，布局不破
- [ ] Stack 仍有内容（personalized 无 cookie 也返回数据）

- [ ] **Step 4: QQ 音源**（设置里切换音源）

- [ ] 只显示 Stack（QQ discover 池子），常驻卡与最近播放 rail 均隐藏
- [ ] 拖拽、预览弹窗、播放全部正常

- [ ] **Step 5: 回归**

- [ ] 音乐库、歌手页、搜索、歌词页随机点一遍无异常（CardRail/PlaylistCard/RevealItem 仍被这些页面使用）
- [ ] `npm run typecheck && npm run test` 最终全绿

- [ ] **Step 6: 收尾**

发现的问题就地修复并按所属模块补提交（提交信息 `fix: ...`）。全部通过后本计划完成。
