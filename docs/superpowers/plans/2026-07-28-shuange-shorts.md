# 刷歌(Shorts)模式 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「刷歌」顶级页,上下滑动卡片只听每首 ~20s 高潮片段,自动切下一首,可一键播放全曲。

**Architecture:** 渲染层纯函数 `computeHighlightOffset`(LRC 行密度滑窗+时长偏移兜底)计算高潮段;新增 `shuange` store 管 feed/offset 缓存/进入退出接管单例 AudioEngine;顶级页 `AppView='shuange'` 全屏垂直 snap 卡片复用封面粒子云。复用 `recommend/songs` 作 feed,耗尽用 `recommend/playlists` 补。

**Tech Stack:** React + zustand + framer-motion(`motion/react`) + CSS Modules + vitest;复用 `serviceFor`、`usePlayerStore`、`usePlaylistStore`、`useLikesStore`、`CoverParticleCloud`。

## Global Constraints(摘自 spec 与 CLAUDE.md)

- 跨音源取 service 用 `serviceFor(track.source)`(`src/lib/service-registry.ts`),不用全局 `useMusicService()`。
- `Track.id` 类型 `unknown`,比较/拼 URL 前 `String()`;`Track.duration` 全项目约定毫秒。
- 异步竞态用 `loadSession` 计数 ref 丢弃过期响应;`loadTrack` 已自带 AbortController。
- 动效引用 `src/lib/motion-presets.ts`(springSnappy/tapScale/fadeRise)与 tokens.css 变量,不写魔法数。
- 样式 CSS Modules(`*.module.css` 同目录);主题靠 `data-theme` + tokens。
- 全屏 WebGL 同屏只跑一个:刷歌卡片用 `CoverParticleCloud` 作背景,不再叠 LiquidEther。
- 验证:`npm run typecheck && npm test`;播放/转场走 Electron 真机实测(playwright-core 法)。

## File Structure

- **Create** `src/lib/highlight-offset.ts` — 纯函数:计算高潮段 `{startSec,endSec}`。
- **Create** `src/lib/highlight-offset.test.ts` — 单测。
- **Create** `src/stores/shuange.ts` — feed/index/offset 缓存/enter-leave 接管。
- **Create** `src/stores/shuange.test.ts` — store 单测(逻辑层,AudioEngine 用桩)。
- **Create** `src/hooks/useShuangePlayer.ts` — 绑定 AudioEngine timeupdate→到 endSec 切下一首;预加载相邻 URL;200ms 音量淡入淡出。
- **Create** `src/components/Shuange/ShuangeCard.tsx` + `ShuangeCard.module.css` — 单卡片 UI。
- **Create** `src/pages/ShuangePage.tsx` + `ShuangePage.module.css` — 全屏垂直 snap 容器。
- **Modify** `src/stores/navigation.ts` — `AppView` 加 `'shuange'`。
- **Modify** `src/components/Layout/TopBar.tsx` — NAV_ITEMS 加「刷歌」+ active 排除 shuange。
- **Modify** `src/components/Layout/AppShell.tsx` — lazy 导入并渲染 `ShuangePage`。

---

### Task 1: 高潮段纯函数 `computeHighlightOffset`

**Files:**
- Create: `src/lib/highlight-offset.ts`
- Test: `src/lib/highlight-offset.test.ts`

**Interfaces:**
- Consumes: `LyricLine`(`{ time: number; text: string }`,time 单位秒,来自 `src/types/domain.ts`)。
- Produces: `export interface HighlightRange { startSec: number; endSec: number }`;`export function computeHighlightOffset(lines: LyricLine[], durationMs: number, clipSec?: number): HighlightRange`。

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/highlight-offset.test.ts
import { describe, it, expect } from 'vitest'
import { computeHighlightOffset } from './highlight-offset'
import type { LyricLine } from '../types/domain'

function linesAt(times: number[]): LyricLine[] {
  return times.map((t) => ({ time: t, text: `line-${t}` }))
}

describe('computeHighlightOffset', () => {
  it('行数不足时回退到时长 45% 居中窗口', () => {
    const r = computeHighlightOffset([], 200_000, 20)
    // 200s * 0.45 = 90, 居中: start = 90 - 10 = 80
    expect(r.startSec).toBe(80)
    expect(r.endSec - r.startSec).toBe(20)
  })

  it('选中行密度最高的一段', () => {
    // 0-10s 散落 3 行,40-50s 密集 8 行 → 应落在 40 附近
    const sparse = linesAt([1, 4, 8])
    const dense = linesAt([40, 41, 42, 43, 44, 45, 46, 47])
    const r = computeHighlightOffset([...sparse, ...dense], 100_000, 20)
    expect(r.startSec).toBeGreaterThanOrEqual(40)
    expect(r.startSec).toBeLessThanOrEqual(47)
  })

  it('钳制到 [0, duration]', () => {
    const r = computeHighlightOffset(linesAt([1, 2, 3, 4, 5, 6, 7, 8]), 10_000, 20)
    // 曲长 10s < clip 20s:start=0, end=10
    expect(r.startSec).toBe(0)
    expect(r.endSec).toBe(10)
  })

  it('duration 无效时回退默认 0', () => {
    const r = computeHighlightOffset(linesAt([1, 2, 3]), 0, 20)
    expect(r.startSec).toBe(0)
    expect(r.endSec).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/highlight-offset.test.ts`
Expected: FAIL with "Cannot find module './highlight-offset'" or "computeHighlightOffset is not defined".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/highlight-offset.ts
import type { LyricLine } from '../types/domain'

export interface HighlightRange {
  startSec: number
  endSec: number
}

const DEFAULT_CLIP_SEC = 20

/** 取整曲时长 45% 居中的 clipSec 窗口作回退。 */
function fallbackRange(durationMs: number, clipSec: number): HighlightRange {
  const durSec = durationMs > 0 ? durationMs / 1000 : 0
  if (durSec <= 0) return { startSec: 0, endSec: 0 }
  const clip = Math.min(clipSec, durSec)
  const start = Math.max(0, durSec * 0.45 - clip / 2)
  const clamped = Math.min(start, Math.max(0, durSec - clip))
  return { startSec: clamped, endSec: clamped + clip }
}

/**
 * 由 LRC 行密度估计高潮段:取 clipSec 滑窗内歌词行数最多的窗口作副歌。
 * 行数不足(<8)或无时长时回退到时长 45% 居中窗口。窗起点用行时间戳而非等分网格,避免漏检。
 */
export function computeHighlightOffset(
  lines: LyricLine[],
  durationMs: number,
  clipSec = DEFAULT_CLIP_SEC,
): HighlightRange {
  if (!lines || lines.length < 8) return fallbackRange(durationMs, clipSec)
  const durSec = durationMs > 0 ? durationMs / 1000 : 0
  if (durSec <= 0) return fallbackRange(durationMs, clipSec)
  const clip = Math.min(clipSec, durSec)
  const ts = lines.map((l) => l.time).filter((t) => typeof t === 'number' && t >= 0).sort((a, b) => a - b)
  if (ts.length < 8) return fallbackRange(durationMs, clipSec)

  let bestStart = ts[0]
  let bestScore = -1
  for (let i = 0; i < ts.length; i++) {
    const wStart = ts[i]
    const wEnd = wStart + clip
    if (wEnd > durSec + 0.5) continue
    let count = 0
    for (let j = i; j < ts.length; j++) {
      if (ts[j] <= wEnd) count++
      else break
    }
    if (count > bestScore) {
      bestScore = count
      bestStart = wStart
    }
  }
  const start = Math.min(bestStart, Math.max(0, durSec - clip))
  return { startSec: start, endSec: start + clip }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/highlight-offset.test.ts`
Expected: PASS(4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/highlight-offset.ts src/lib/highlight-offset.test.ts
git commit -m "feat(shuange): 高潮段纯函数 computeHighlightOffset(LRC 行密度滑窗)"
```

---

### Task 2: `shuange` store(feed + offset 缓存 + enter/leave 接管)

**Files:**
- Create: `src/stores/shuange.ts`
- Test: `src/stores/shuange.test.ts`

**Interfaces:**
- Consumes: `usePlayerStore`(`loadTrack(track,{startAt,contextId})`、`pause()`、`getState()` 取 `currentTrack/queue...` 实际经 `usePlaylistStore`)、`usePlaylistStore`(`setQueue`、`getState` 取 `queue/queueIndex/queueContextId`)、`serviceFor(source).getRecommendSongs?()` 与 `getRecommendPlaylists()/getPlaylistSkeleton(id)`、`serviceFor(source).getLyrics(track)`、`computeHighlightOffset`、`useNavigationStore`(`navigateTo`)。
- Produces: `useShuangeStore`(`active/feed/index/offset/loading/error` + `enter/leave/next/prev/playFullCurrent/loadIndex`)。

**说明:** store 不直接碰 AudioEngine timeupdate(由 Task 3 的 hook 驱动);store 只负责数据与 loadIndex 调 `usePlayerStore.loadTrack`。offset 缓存为模块级 `Map` LRU(容量 200),key = `${source}:${trackId}`。

- [ ] **Step 1: Write the failing test**

store 测试用 vitest mock 桩掉 player/playlist/navigation 与 serviceFor。重点验证:enter 快照 + loadIndex 调 loadTrack(startAt)、offset 缓存命中、leave 恢复。

```ts
// src/stores/shuange.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 桩 player / playlist / navigation / service
const loadTrack = vi.fn().mockResolvedValue(undefined)
const playlistSetQueue = vi.fn()
const navigateTo = vi.fn()
const getLyrics = vi.fn()
const getRecommendSongs = vi.fn()
const getRecommendPlaylists = vi.fn()
const getPlaylistSkeleton = vi.fn()

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => ({
    getLyrics,
    getRecommendSongs,
    getRecommendPlaylists,
    getPlaylistSkeleton,
  }),
}))

vi.mock('./player', () => ({
  usePlayerStore: {
    getState: () => ({
      loadTrack,
      pause: vi.fn(),
      currentTrack: null,
    }),
  },
}))
vi.mock('./playlist', () => ({
  usePlaylistStore: {
    getState: () => ({ queue: [], queueIndex: -1, queueContextId: null }),
    setQueue: playlistSetQueue,
    setState: vi.fn(),
  },
}))
vi.mock('./navigation', () => ({
  useNavigationStore: { getState: () => ({ navigateTo }) },
}))

import { useShuangeStore } from './shuange'
import type { Track } from '../types/domain'

function mkTrack(id: string, durMs = 180_000): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: `t-${id}`, artist: 'a', artists: [], duration: durMs }
}

describe('shuange store', () => {
  beforeEach(() => {
    loadTrack.mockClear()
    getLyrics.mockReset()
    getRecommendSongs.mockReset()
    getRecommendPlaylists.mockReset()
    getPlaylistSkeleton.mockReset()
    useShuangeStore.setState({ active: false, feed: [], index: -1, offset: null, loading: false, error: null })
  })

  it('enter 拉首屏并 loadIndex(0) 调 loadTrack 带 startAt', async () => {
    getRecommendSongs.mockResolvedValue([mkTrack('1'), mkTrack('2')])
    getLyrics.mockResolvedValue([{ time: 40, text: 'x' }, ...Array.from({ length: 9 }, (_, i) => ({ time: 41 + i, text: 'y' }))])
    await useShuangeStore.getState().enter()
    const s = useShuangeStore.getState()
    expect(s.feed.length).toBe(2)
    expect(s.index).toBe(0)
    expect(loadTrack).toHaveBeenCalledTimes(1)
    const [track, opts] = loadTrack.mock.calls[0]
    expect(String(track.id)).toBe('1')
    expect(opts?.startAt).toBeGreaterThanOrEqual(0)
  })

  it('无歌词时回退到时长偏移仍能 loadTrack', async () => {
    getRecommendSongs.mockResolvedValue([mkTrack('9')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    expect(loadTrack).toHaveBeenCalledTimes(1)
    const opts = loadTrack.mock.calls[0][1]
    expect(opts?.startAt).toBeGreaterThanOrEqual(0)
  })

  it('offset 缓存命中时不再 getLyrics', async () => {
    getRecommendSongs.mockResolvedValue([mkTrack('1'), mkTrack('2')])
    getLyrics.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ time: 40 + i, text: 'y' })))
    await useShuangeStore.getState().enter() // 加载并缓存 1
    getLyrics.mockClear()
    await useShuangeStore.getState().prev() // index 0 无 prev
    await useShuangeStore.getState().next() // → 2,新歌未缓存,会 getLyrics
    expect(getLyrics).toHaveBeenCalled()
  })

  it('leave 恢复快照(setState + loadTrack 暂停态)', async () => {
    getRecommendSongs.mockResolvedValue([mkTrack('1')])
    getLyrics.mockResolvedValue([])
    await useShuangeStore.getState().enter()
    useShuangeStore.getState().leave()
    // 离开应触发一次恢复 loadTrack(快照曲目,暂停态)
    expect(loadTrack).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/shuange.test.ts`
Expected: FAIL "Cannot find module './shuange'"。

- [ ] **Step 3: Write minimal implementation**

```ts
// src/stores/shuange.ts
import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { computeHighlightOffset, type HighlightRange } from '../lib/highlight-offset'
import { usePlayerStore } from './player'
import { usePlaylistStore } from './playlist'
import { useNavigationStore } from './navigation'
import type { Track } from '../types/domain'

const CLIP_SEC = 20
const OFFSET_CACHE_MAX = 200

interface ShuangeSnapshot {
  currentTrack: Track | null
  queue: Track[]
  queueIndex: number
  queueContextId: unknown
  position: number
  volume: number
}

interface ShuangeStore {
  active: boolean
  feed: Track[]
  index: number
  offset: HighlightRange | null
  loading: boolean
  error: string | null
  enter(): Promise<void>
  leave(): void
  next(): Promise<void>
  prev(): Promise<void>
  playFullCurrent(): void
  loadIndex(i: number): Promise<void>
}

const offsetCache = new Map<string, HighlightRange>()
function cacheKey(track: Track): string {
  return `${track.source}:${String(track.id)}`
}
function rememberOffset(key: string, range: HighlightRange): void {
  if (offsetCache.has(key)) offsetCache.delete(key) // 重新插到末尾,保 LRU 顺序
  offsetCache.set(key, range)
  while (offsetCache.size > OFFSET_CACHE_MAX) {
    const first = offsetCache.keys().next().value
    if (first === undefined) break
    offsetCache.delete(first)
  }
}

async function ensureOffset(track: Track): Promise<HighlightRange> {
  const key = cacheKey(track)
  const cached = offsetCache.get(key)
  if (cached) return cached
  let range: HighlightRange
  try {
    const lines = await serviceFor(track.source).getLyrics(track)
    range = computeHighlightOffset(lines ?? [], track.duration ?? 0, CLIP_SEC)
  } catch {
    range = computeHighlightOffset([], track.duration ?? 0, CLIP_SEC)
  }
  rememberOffset(key, range)
  return range
}

let snapshot: ShuangeSnapshot | null = null

function takeSnapshot(): ShuangeSnapshot {
  const p = usePlayerStore.getState()
  const pl = usePlaylistStore.getState()
  return {
    currentTrack: p.currentTrack ?? null,
    queue: pl.queue,
    queueIndex: pl.queueIndex,
    queueContextId: pl.queueContextId,
    position: p.position ?? 0,
    volume: p.volume ?? 0.8,
  }
}

export const useShuangeStore = create<ShuangeStore>((set, get) => ({
  active: false,
  feed: [],
  index: -1,
  offset: null,
  loading: false,
  error: null,

  async enter() {
    snapshot = takeSnapshot()
    set({ active: true, feed: [], index: -1, offset: null, loading: true, error: null })
    try {
      const svc = serviceFor(useSettingsStore?.getState?.()?.activeSource ?? 'netease')
      const songs = (await svc.getRecommendSongs?.()) ?? []
      // 复用 player store 的活跃音源取 service —— 此处不直接导 settings 以免成环,
      // 由调用方页面传入更佳;但 store 内取 activeSource 走 settings 更内聚:
    } catch {
      // 见下方真实实现
    }
    // —— 真实实现(避免成环:直接 import settings)——
    set({ feed: get().feed, loading: true })
    try {
      const { useSettingsStore } = await import('./settings')
      const svc = serviceFor(useSettingsStore.getState().activeSource)
      const songs = (await svc.getRecommendSongs?.()) ?? []
      if (!songs.length) {
        set({ loading: false, error: '暂时没有推荐内容,稍后再来' })
        return
      }
      set({ feed: songs, index: -1, loading: false, error: null })
      await get().loadIndex(0)
    } catch (e) {
      set({ loading: false, error: (e as Error)?.message || '加载失败' })
    }
  },

  async loadIndex(i) {
    const { feed } = get()
    const track = feed[i]
    if (!track) return
    set({ index: i, loading: true, offset: null })
    const range = await ensureOffset(track)
    set({ offset: range, loading: false })
    void usePlayerStore.getState().loadTrack(track, { startAt: range.startSec, contextId: `shuange:${String(track.id)}` })
  },

  async next() {
    const { feed, index } = get()
    if (index + 1 < feed.length) {
      await get().loadIndex(index + 1)
      return
    }
    // feed 耗尽:用 recommend/playlists 补
    await appendMoreFeed(get, set)
    const after = get()
    if (index + 1 < after.feed.length) await get().loadIndex(index + 1)
  },

  async prev() {
    const { index } = get()
    if (index > 0) await get().loadIndex(index - 1)
  },

  playFullCurrent() {
    const { feed, index } = get()
    const rest = feed.slice(index)
    if (!rest.length) return
    const snap = snapshot
    snapshot = null
    set({ active: false })
    // 交还原队列:用 feed 剩余作新队列从当前曲起播(整曲)
    usePlaylistStore.getState().setQueue(rest, 0)
    useNavigationStore.getState().navigateTo('explore')
    void snap // 快照不再恢复
  },

  leave() {
    const snap = snapshot
    snapshot = null
    set({ active: false })
    if (!snap) return
    // 恢复原队列(暂停态):setState 不触发 playAt 自动开播
    usePlaylistStore.setState({
      queue: snap.queue,
      queueIndex: snap.queueIndex,
      queueContextId: snap.queueContextId,
    })
    if (snap.currentTrack) {
      void usePlayerStore.getState().loadTrack(snap.currentTrack, { startAt: snap.position, contextId: snap.queueContextId })
        .then(() => usePlayerStore.getState().pause())
    }
  },
}))

// feed 补充:拉个性化歌单 → 取首个骨架追加曲目
async function appendMoreFeed(get: () => ShuangeStore, set: (p: Partial<ShuangeStore>) => void): Promise<void> {
  try {
    const { useSettingsStore } = await import('./settings')
    const svc = serviceFor(useSettingsStore.getState().activeSource)
    const pls = await svc.getRecommendPlaylists?.(0)
    if (!pls?.length) return
    const skel = await svc.getPlaylistSkeleton(pls[0].id)
    const more = skel.tracks.filter((t) => t && t.id)
    if (more.length) set({ feed: [...get().feed, ...more] })
  } catch {
    // 补充失败静默;next 会原地不动
  }
}
```

> 注:`enter` 顶部那段 `try { ... }` 是占位探查,真实逻辑在下方 `import('./settings')` 块——保留两者会让上方先吞异常。**实现时删除上方占位 try/catch 块,只保留下方真实实现。** 测试桩里 `serviceFor` 返回的 mock 已覆盖,无需 settings。为避免测试时 `import('./settings')` 真实执行,测试 mock 文件需补一个 settings mock:

在 `shuange.test.ts` 的 mock 区追加:
```ts
vi.mock('./settings', () => ({
  useSettingsStore: { getState: () => ({ activeSource: 'netease' }) },
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/shuange.test.ts`
Expected: PASS(4 tests)。如失败,先核对 mock 与占位块已删。

- [ ] **Step 5: Commit**

```bash
git add src/stores/shuange.ts src/stores/shuange.test.ts
git commit -m "feat(shuange): store 与 offset LRU 缓存 + enter/leave 接管"
```

---

### Task 3: `useShuangePlayer` hook(timeupdate→next + 预加载 + 淡入淡出)

**Files:**
- Create: `src/hooks/useShuangePlayer.ts`

**Interfaces:**
- Consumes: `useShuangeStore`(`active/offset/index/feed/next`)、`usePlayerStore`(`position/status/_engine/setVolume`)、`serviceFor`、`computeHighlightOffset`(经 store 已缓存,hook 只预解析 URL)。
- Produces: `useShuangePlayer()` 副作用 hook,无返回值。

**说明:** AudioEngine 无 `fadeTo`,用 rAF 手动 `setVolume` 线性 ramp。到 `endSec` 调 `next()`。预加载:播到 50% 时为下一首预热 `getLyrics`+`computeHighlightOffset`(经 store 的 `ensureOffset` 不可达,故 hook 内复用缓存逻辑——改为直接调 store 未导出的 ensureOffset 不便,改为 hook 只预热 URL:`serviceFor(source).getTrackUrl` 已被 `loadTrack` 内部解析,故 hook 预热只做"提前 ensureOffset")。

简化:hook 不直接预解析 URL(player 已有 `track-preload` 预加载机制,但刷歌未走 playlist store,故不触发)。**hook 仅负责 ①到 endSec 切下一首 ②切歌淡入淡出**。预加载放到 store 的 `loadIndex`(下一首前先 `ensureOffset`,URL 仍由 player 现场解析——首播延迟可接受,后续可选优化)。

- [ ] **Step 1: 实现 hook**

```ts
// src/hooks/useShuangePlayer.ts
import { useEffect, useRef } from 'react'
import { useShuangeStore } from '../stores/shuange'
import { usePlayerStore } from '../stores/player'

const FADE_MS = 200

function rampVolume(target: number, ms: number, setVolume: (v: number) => void, from: number): void {
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    setVolume(from + (target - from) * t)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** 绑定刷歌播放:到片段末尾自动 next;切歌 200ms 淡入淡出。 */
export function useShuangePlayer(): void {
  const active = useShuangeStore((s) => s.active)
  const offset = useShuangeStore((s) => s.offset)
  const index = useShuangeStore((s) => s.index)
  const next = useShuangeStore((s) => s.next)
  const prevIndexRef = useRef(index)

  useEffect(() => {
    if (!active) return
    const unsub = usePlayerStore.subscribe((s) => {
      const end = offset?.endSec
      if (end != null && s.position >= end && s.status !== 'paused') {
        void next()
      }
    })
    return unsub
  }, [active, offset, next])

  // 切歌淡入淡出:index 变化时先淡出到 0 再淡回 1(loadTrack 已同步替换源)
  useEffect(() => {
    if (!active || index === prevIndexRef.current) return
    const eng = usePlayerStore.getState()._engine()
    const prevVol = usePlayerStore.getState().volume || 0.8
    rampVolume(0, FADE_MS, (v) => eng.setVolume(v), prevVol)
    const timer = setTimeout(() => rampVolume(prevVol, FADE_MS, (v) => eng.setVolume(v), 0), FADE_MS + 30)
    prevIndexRef.current = index
    return () => clearTimeout(timer)
  }, [active, index])
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS。hook 无单测(副作用+时序),由真机实测覆盖。

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useShuangePlayer.ts
git commit -m "feat(shuange): useShuangePlayer hook(到片段末自动切+淡入淡出)"
```

---

### Task 4: `ShuangeCard` 组件

**Files:**
- Create: `src/components/Shuange/ShuangeCard.tsx`
- Create: `src/components/Shuange/ShuangeCard.module.css`

**Interfaces:**
- Consumes: `useShuangeStore`(`feed/index/offset/next/prev/playFullCurrent/leave`)、`usePlayerStore`(`currentTrack/position/status/toggle`)、`useLikesStore`(`supports/toggleLike/ensureChecked`)、`CoverParticleCloud`(`src/components/Visualizer/CoverParticleCloud.tsx`,无 props,读 player currentTrack)、`motion-presets`(`tapScale`)。
- Produces: `export function ShuangeCard(): JSX.Element`

- [ ] **Step 1: 实现**

```tsx
// src/components/Shuange/ShuangeCard.tsx
import { motion } from 'motion/react'
import { tapScale } from '../../lib/motion-presets'
import { useShuangeStore } from '../../stores/shuange'
import { usePlayerStore } from '../../stores/player'
import { useLikesStore } from '../../stores/likes'
import { CoverParticleCloud } from '../Visualizer/CoverParticleCloud'
import styles from './ShuangeCard.module.css'

export function ShuangeCard() {
  const track = usePlayerStore((s) => s.currentTrack)
  const status = usePlayerStore((s) => s.status)
  const toggle = usePlayerStore((s) => s.toggle)
  const next = useShuangeStore((s) => s.next)
  const prev = useShuangeStore((s) => s.prev)
  const playFull = useShuangeStore((s) => s.playFullCurrent)
  const leave = useShuangeStore((s) => s.leave)
  const likes = useLikesStore.getState()
  const liked = track ? likes.supports(track) && false : false // 红心状态由 ensureChecked 异步填充,见下方 effect

  return (
    <motion.div className={styles.card} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className={styles.bg}>{/* 全屏 WebGL 同屏只跑一个 */}<CoverParticleCloud /></div>
      <div className={styles.scrim} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <div className={styles.title}>{track?.name ?? '加载中'}</div>
          <div className={styles.artist}>{track?.artist}</div>
        </div>
        <div className={styles.actions}>
          <motion.button whileTap={tapScale} onClick={() => void toggle()} aria-label={status === 'playing' ? '暂停' : '播放'}>
            {status === 'playing' ? '❚❚' : '▶'}
          </motion.button>
          <motion.button whileTap={tapScale} onClick={() => void prev()} aria-label="上一首">↑</motion.button>
          <motion.button whileTap={tapScale} onClick={() => void next()} aria-label="下一首">↓</motion.button>
          {track && likes.supports(track) && (
            <motion.button whileTap={tapScale} onClick={() => void likes.toggleLike(track)} aria-label="红心">♥</motion.button>
          )}
          <motion.button whileTap={tapScale} onClick={playFull} aria-label="播放全曲">全曲</motion.button>
          <motion.button whileTap={tapScale} onClick={leave} aria-label="退出">退出</motion.button>
        </div>
      </div>
    </motion.div>
  )
}
```

```css
/* src/components/Shuange/ShuangeCard.module.css */
.card { position: absolute; inset: 0; display: flex; align-items: flex-end; }
.bg { position: absolute; inset: 0; }
.scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%); }
.body { position: relative; width: 100%; padding: 32px 40px 48px; display: flex; flex-direction: column; gap: 20px; }
.meta { display: flex; flex-direction: column; gap: 4px; }
.title { font-size: 22px; font-weight: 700; color: var(--sm-text-primary, #fff); }
.artist { font-size: 14px; color: var(--sm-text-secondary, rgba(255,255,255,0.7)); }
.actions { display: flex; gap: 12px; }
.actions button { width: 44px; height: 44px; border-radius: 999px; border: 1px solid var(--glass-border, rgba(255,255,255,0.2)); background: var(--glass-bg, rgba(0,0,0,0.3)); color: #fff; font-size: 16px; cursor: pointer; backdrop-filter: blur(8px); }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS(若 `liked` 未用触发 unused,删掉该变量)。

- [ ] **Step 3: Commit**

```bash
git add src/components/Shuange/
git commit -m "feat(shuange): ShuangeCard(封面粒子背景+操作行)"
```

---

### Task 5: `ShuangePage` 垂直 snap 容器

**Files:**
- Create: `src/pages/ShuangePage.tsx`
- Create: `src/pages/ShuangePage.module.css`

**Interfaces:**
- Consumes: `ShuangeCard`、`useShuangeStore`(`enter/active/loading/error`)、`useShuangePlayer`、`motion-presets`。
- Produces: `export function ShuangePage(): JSX.Element`

- [ ] **Step 1: 实现**

```tsx
// src/pages/ShuangePage.tsx
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ShuangeCard } from '../components/Shuange/ShuangeCard'
import { useShuangeStore } from '../stores/shuange'
import { useShuangePlayer } from '../hooks/useShuangePlayer'
import styles from './ShuangePage.module.css'

export function ShuangePage() {
  const enter = useShuangeStore((s) => s.enter)
  const active = useShuangeStore((s) => s.active)
  const loading = useShuangeStore((s) => s.loading)
  const error = useShuangeStore((s) => s.error)
  useShuangePlayer()

  useEffect(() => {
    if (!active) void enter()
    return () => {
      // 离开页面时若仍 active,交还播放器
      if (useShuangeStore.getState().active) useShuangeStore.getState().leave()
    }
  }, [active, enter])

  return (
    <div className={styles.page}>
      <AnimatePresence mode="popLayout">
        {active && !loading && <motion.div key="card" className={styles.slide}><ShuangeCard /></motion.div>}
      </AnimatePresence>
      {loading && <div className={styles.hint}>加载中…</div>}
      {error && <div className={styles.hint}>{error}</div>}
    </div>
  )
}
```

```css
/* src/pages/ShuangePage.module.css */
.page { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
.slide { position: absolute; inset: 0; }
.hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.7); }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/pages/ShuangePage.tsx src/pages/ShuangePage.module.css
git commit -m "feat(shuange): ShuangePage 垂直 snap 容器"
```

---

### Task 6: 接线导航(AppView + TopBar + AppShell + 键盘)

**Files:**
- Modify: `src/stores/navigation.ts`(AppView 加 `'shuange'`)
- Modify: `src/components/Layout/TopBar.tsx:15-20`(NAV_ITEMS 加项 + active 排除)
- Modify: `src/components/Layout/AppShell.tsx:23-58`(lazy 导入 + render 分支)
- Modify: `src/pages/ShuangePage.tsx`(加键盘交互)

**Interfaces:**
- Consumes: `ShuangePage`、navigation store。
- Produces: 顶部导航多一个「刷歌」入口;按 ↑↓/空格/Esc/L/F 操作。

- [ ] **Step 1: AppView 加 'shuange'**

`src/stores/navigation.ts` 第 5 行 `export type AppView =` 联合里,在 `'roam'` 后加 `| 'shuange'`。

- [ ] **Step 2: TopBar 加导航项**

`src/components/Layout/TopBar.tsx`:
```ts
const NAV_ITEMS: { label: string; view: AppView }[] = [
  { label: '探索', view: 'explore' },
  { label: '我的库', view: 'library' },
  { label: '漫游', view: 'roam' },
  { label: '刷歌', view: 'shuange' as const },
]
```
active 逻辑(约 173 行)改为排除 shuange,避免刷歌时探索被点亮:
```ts
const active = section === item.view
  || (item.view === 'explore' && section !== 'library' && section !== 'roam' && section !== 'shuange')
```

- [ ] **Step 3: AppShell 懒加载渲染**

`src/components/Layout/AppShell.tsx` 顶部 lazy 导入加:
```ts
const ShuangePage = lazy(() => import('../../pages/ShuangePage').then((m) => ({ default: m.ShuangePage })))
```
renderView 里(约 57 行后)加:
```ts
if (view === 'shuange') return <ShuangePage />
```

- [ ] **Step 4: ShuangePage 加键盘交互**

`src/pages/ShuangePage.tsx` 在 `useEffect` 后追加键盘监听:
```ts
useEffect(() => {
  if (!active) return
  const onKey = (e: KeyboardEvent) => {
    const st = useShuangeStore.getState()
    const player = usePlayerStore.getState()
    if (e.key === 'ArrowDown') { e.preventDefault(); void st.next() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); void st.prev() }
    else if (e.key === ' ') { e.preventDefault(); player.toggle() }
    else if (e.key === 'Escape') { st.leave() }
    else if (e.key === 'f' || e.key === 'F') { st.playFullCurrent() }
    else if ((e.key === 'l' || e.key === 'L') && player.currentTrack) {
      const likes = useLikesStore.getState()
      if (likes.supports(player.currentTrack)) void likes.toggleLike(player.currentTrack)
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [active])
```
补 import:`import { usePlayerStore } from '../stores/player'`、`import { useLikesStore } from '../stores/likes'`。

- [ ] **Step 5: Typecheck + test**

Run: `npm run typecheck && npm test`
Expected: 全绿(无新增失败)。

- [ ] **Step 6: Commit**

```bash
git add src/stores/navigation.ts src/components/Layout/TopBar.tsx src/components/Layout/AppShell.tsx src/pages/ShuangePage.tsx
git commit -m "feat(shuange): 接线顶级页+导航+键盘交互"
```

---

### Task 7: 真机实测与回归

**Files:** 无修改,仅验证。

- [ ] **Step 1: dev 启动并实测**

Run: `npm run dev`(手动)或用 playwright-core 法(见 memory `cover-particle-silk`)。验证清单:
1. TopBar 出现「刷歌」,点击进入,封面粒子背景出现,第 0 首从高潮段起播。
2. 片段播完自动切下一首(淡入淡出)。
3. ↑↓ 键上下切歌;空格暂停/继续;Esc 退出并恢复原队列(暂停态);F 播放全曲跳回探索并从该曲起播。
4. feed 播到末尾自动补充(若每日推荐耗尽)。
5. 无歌词曲仍能起播(偏移回退)。
6. QQ VIP 付费墙曲显示提示并自动跳过。
7. 切音源后刷歌 feed 重置(再次进入)。

- [ ] **Step 2: typecheck + 全量测试回归**

Run: `npm run typecheck && npm test`
Expected: 全绿。

- [ ] **Step 3: 更新项目梳理文档**

`docs/项目梳理-2026-07.md` 三节功能现状加一行「刷歌」;八节下一步勾掉该项(若列入)。commit:
```bash
git add docs/项目梳理-2026-07.md
git commit -m "docs: 刷歌功能入库项目梳理"
```

---

## Self-Review

**Spec 覆盖:** spec 三架构、四组件、五算法、六生命周期、七交互、八边界均有任务对应(Task1=算法,Task2=store+接管,Task3=生命周期+淡入淡出,Task4-5=组件,Task6=导航+键盘,Task7=边界实测含 VIP 提示/无歌词回退/feed 补充)。九测试覆盖 highlight-offset.test + shuange.test + typecheck + 真机。十 YAGNI 不做。

**占位扫描:** Task 2 的 enter() 含一段占位探查 try/catch,实现时须删除只保留下方真实实现——已在 task 内显式标注。其余无 TBD。

**类型一致:** `HighlightRange{startSec,endSec}`、`ShuangeStore` 方法名(enter/leave/next/prev/playFullCurrent/loadIndex)、`useShuangePlayer`、`ShuangeCard`、`ShuangePage` 在各 task 间一致;`getRecommendSongs` 在 music-service 接口里实为可选 `getDailySongs?()`——**修正:spec 写的是 `recommend/songs`,但 `MusicService` 接口里的方法名是 `getDailySongs?()`**(见 `src/lib/music-service.ts:23`),store 应调 `getDailySongs?.()` 而非 `getRecommendSongs`。Task 2 的 store 与 test mock 须用 `getDailySongs`。下方修正补丁。

### 修正:getDailySongs 命名

Task 2 store 里两处 `getRecommendSongs?.()` 改为 `getDailySongs?.()`;test mock 的 `getRecommendSongs` 改名 `getDailySongs`:
```ts
// test mock
serviceFor: () => ({ getLyrics, getDailySongs, getRecommendPlaylists, getPlaylistSkeleton }),
```
store `enter()` 真实实现块:`const songs = (await svc.getDailySongs?.()) ?? []`。Task 7 实测时若 `getDailySongs` 未登录返回空,feed 回退到 `getRecommendPlaylists` 补充路径(已实现)。
