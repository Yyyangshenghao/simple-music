# 歌单懒加载 + 虚拟列表实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 突破网易歌单 500 首上限,改为"全骨架 + 按需填充"懒加载,配套虚拟列表与队列占位播放。

**Architecture:** 服务端先用 `playlist_detail` 秒拿全量 trackIds,再用 `song_detail` 按 id 分批补详情;渲染层新增 `useLazyPlaylist` hook(稀疏数组 + 100 首窗口 + 模块级缓存)与自写 `VirtualList`(固定行高 56px,滚动条从第一刻就是完整长度);队列按完整 trackIds 入队,pending 占位曲目播到时再补详情。

**Tech Stack:** 现有栈,零新依赖(React 18 + zustand + motion + vitest;server 侧 NeteaseCloudMusicApi 4.32)。

**Spec:** `docs/superpowers/specs/2026-07-05-playlist-lazy-loading-design.md`

## Global Constraints

- `Track.duration` 全项目约定为**毫秒**(网易 `dt` 原样)。
- `Track`/`Playlist` 的 `id` 类型是 `unknown`,比较/拼 URL 前必须 `String()`。
- 样式用 CSS Modules,颜色/圆角等引用 `src/styles/tokens.css` 的 `--sm-*`/`--glass-*` 变量,不写魔法色值。
- 动效引用 `src/lib/motion-presets.ts`(springGentle/fadeRise 等)。
- 异步竞态守卫沿用 `loadSession` 计数 ref 模式(参考 ExplorePage)。
- 不新增 npm 依赖。
- 验证以 `npm run typecheck` + `npm test` 为准(无 lint 配置)。
- QQ 侧抓取逻辑不改(本来就一次全量返回)。
- 工作区有用户未提交的改动:**每次 commit 只 add 本任务明确列出的文件,禁止 `git add -A`**。

---

### Task 1: 懒加载窗口纯函数模块 lazy-window

**Files:**
- Create: `src/lib/lazy-window.ts`
- Test: `src/lib/lazy-window.test.ts`

**Interfaces:**
- Consumes: `Track`/`MusicSource` 类型(`src/types/domain.ts`;`Track.pending?: boolean` 在本任务一并加上)
- Produces(后续任务依赖的精确签名):
  - `TRACK_WINDOW = 100`
  - `windowIndicesFor(start: number, end: number, windowSize: number, total: number): number[]`
  - `windowSpan(w: number, windowSize: number, total: number): { start: number; end: number }`
  - `virtualRange(scrollTop: number, viewportHeight: number, listTop: number, rowHeight: number, total: number, overscan: number): { start: number; end: number }`
  - `makePlaceholderTrack(id: unknown, source: MusicSource): Track`
  - `buildQueue(trackIds: unknown[], tracks: (Track | null)[], source: MusicSource): Track[]`

- [ ] **Step 1: 给 Track 加 pending 字段**

在 `src/types/domain.ts` 的 `Track` 接口(`url?: string` 之后)加一行:

```ts
  /** 懒加载占位曲目:仅有 id,详情播到/滚到时再补。 */
  pending?: boolean
```

- [ ] **Step 2: 写失败的测试**

创建 `src/lib/lazy-window.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TRACK_WINDOW, windowIndicesFor, windowSpan, virtualRange, makePlaceholderTrack, buildQueue } from './lazy-window'
import type { Track } from '../types/domain'

function fakeTrack(id: number): Track {
  return { provider: 'netease', source: 'netease', type: 'song', id, name: `song-${id}`, artist: '', artists: [] }
}

describe('windowIndicesFor', () => {
  it('覆盖区间对应的窗口序号', () => {
    expect(windowIndicesFor(0, 100, 100, 650)).toEqual([0])
    expect(windowIndicesFor(50, 150, 100, 650)).toEqual([0, 1])
    expect(windowIndicesFor(600, 650, 100, 650)).toEqual([6])
  })
  it('end 超过 total 时截到最后一个窗口', () => {
    expect(windowIndicesFor(600, 900, 100, 650)).toEqual([6])
  })
  it('空区间或空列表返回空', () => {
    expect(windowIndicesFor(10, 10, 100, 650)).toEqual([])
    expect(windowIndicesFor(0, 100, 100, 0)).toEqual([])
  })
})

describe('windowSpan', () => {
  it('普通窗口', () => {
    expect(windowSpan(1, 100, 650)).toEqual({ start: 100, end: 200 })
  })
  it('末窗口截断到 total', () => {
    expect(windowSpan(6, 100, 650)).toEqual({ start: 600, end: 650 })
  })
})

describe('virtualRange', () => {
  it('列表起点在滚动容器顶部时的可视窗口', () => {
    // 视口 560px / 行高 56px = 10 行,overscan 5
    expect(virtualRange(0, 560, 0, 56, 650, 5)).toEqual({ start: 0, end: 15 })
  })
  it('滚到中部:前后各扩 overscan', () => {
    // scrollTop 5600 → 第 100 行起
    expect(virtualRange(5600, 560, 0, 56, 650, 5)).toEqual({ start: 95, end: 115 })
  })
  it('列表上方有 header(listTop > 0)时按偏移换算', () => {
    expect(virtualRange(200, 560, 200, 56, 650, 5)).toEqual({ start: 0, end: 15 })
  })
  it('end 不超过 total,start 不小于 0', () => {
    const r = virtualRange(999999, 560, 0, 56, 650, 5)
    expect(r.end).toBe(650)
    expect(r.start).toBeLessThanOrEqual(r.end)
    expect(virtualRange(-100, 560, 0, 56, 650, 5).start).toBe(0)
  })
  it('total 为 0 返回空区间', () => {
    expect(virtualRange(0, 560, 0, 56, 0, 5)).toEqual({ start: 0, end: 0 })
  })
})

describe('buildQueue', () => {
  it('已加载的用真曲目,未加载的用 pending 占位', () => {
    const loaded = fakeTrack(1)
    const queue = buildQueue([1, 2], [loaded, null], 'netease')
    expect(queue).toHaveLength(2)
    expect(queue[0]).toBe(loaded)
    expect(queue[1].pending).toBe(true)
    expect(String(queue[1].id)).toBe('2')
    expect(queue[1].source).toBe('netease')
  })
})

describe('makePlaceholderTrack', () => {
  it('占位曲目字段完整可安全渲染', () => {
    const t = makePlaceholderTrack(42, 'netease')
    expect(t.pending).toBe(true)
    expect(t.name).toBe('')
    expect(t.artists).toEqual([])
  })
})

describe('TRACK_WINDOW', () => {
  it('窗口大小为 100', () => {
    expect(TRACK_WINDOW).toBe(100)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/lib/lazy-window.test.ts`
Expected: FAIL,报 `Cannot find module './lazy-window'`(或等价的模块不存在错误)

- [ ] **Step 4: 写实现**

创建 `src/lib/lazy-window.ts`:

```ts
// 歌单懒加载的窗口计算与队列构建:全骨架(trackIds 全量已知)+ 按窗口补详情。
// 纯函数,不持状态;状态在 useLazyPlaylist 的模块级缓存里。

import type { Track, MusicSource } from '../types/domain'

/** 详情补拉的窗口大小(首) */
export const TRACK_WINDOW = 100

/** 覆盖 [start, end) 行区间的窗口序号列表(越界自动截到 total)。 */
export function windowIndicesFor(start: number, end: number, windowSize: number, total: number): number[] {
  if (total <= 0 || windowSize <= 0 || end <= start) return []
  const first = Math.floor(Math.max(0, Math.min(start, total - 1)) / windowSize)
  const last = Math.floor((Math.max(1, Math.min(end, total)) - 1) / windowSize)
  const out: number[] = []
  for (let w = first; w <= last; w++) out.push(w)
  return out
}

/** 第 w 个窗口对应的行区间 [start, end),末窗口截断到 total。 */
export function windowSpan(w: number, windowSize: number, total: number): { start: number; end: number } {
  return { start: w * windowSize, end: Math.min((w + 1) * windowSize, total) }
}

/** 固定行高虚拟列表的可视行区间 [start, end),含 overscan;listTop 为列表相对滚动内容顶部的偏移。 */
export function virtualRange(
  scrollTop: number,
  viewportHeight: number,
  listTop: number,
  rowHeight: number,
  total: number,
  overscan: number
): { start: number; end: number } {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const offset = scrollTop - listTop
  const start = Math.max(0, Math.floor(offset / rowHeight) - overscan)
  const end = Math.min(total, Math.ceil((offset + viewportHeight) / rowHeight) + overscan)
  return { start, end: Math.max(start, end) }
}

/** 仅有 id 的占位曲目:详情播到/滚到时再补,网易播放 URL 只需 id 所以占位也可播。 */
export function makePlaceholderTrack(id: unknown, source: MusicSource): Track {
  return { provider: source, source, type: 'song', id, name: '', artist: '', artists: [], pending: true }
}

/** 按完整 trackIds 构建播放队列:已加载详情的用真曲目,其余用占位。 */
export function buildQueue(trackIds: unknown[], tracks: (Track | null)[], source: MusicSource): Track[] {
  return trackIds.map((id, i) => tracks[i] ?? makePlaceholderTrack(id, source))
}
```

注意:`MusicSource` 若未从 `src/types/domain.ts` 导出则先确认其导出名(现有 `Track.provider: MusicSource` 用的就是它)。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/lib/lazy-window.test.ts`
Expected: PASS(6 个 describe 全绿)

- [ ] **Step 6: 类型检查 + 提交**

Run: `npm run typecheck`
Expected: 无错误

```bash
git add src/lib/lazy-window.ts src/lib/lazy-window.test.ts src/types/domain.ts
git commit -m "feat: 歌单懒加载窗口计算纯函数与 Track.pending 占位"
```

---

### Task 2: Server 新增 /api/song/detail 批量补详情端点

**Files:**
- Modify: `server/routes/netease.ts`(在 `// ---------- 歌单曲目详情 ----------` 区块之前插入新端点)

**Interfaces:**
- Consumes: `server/lib/netease-client.ts` 已有的 `has`/`call`/`asObj`/`asArr`/`mapSongRecord`(该文件顶部已 import)
- Produces: `GET /api/song/detail?ids=1,2,3` → `{ tracks: Track[] }`,返回顺序与入参 ids 一致,查不到的 id 跳过;单批上限 200

- [ ] **Step 1: 实现端点**

在 `server/routes/netease.ts` 的 `// ---------- 歌单曲目详情 ----------`(`if (pn === '/api/playlist/tracks')`)之前插入:

```ts
  // ---------- 按 id 批量补曲目详情(歌单懒加载窗口用) ----------
  if (pn === '/api/song/detail') {
    try {
      const ids = (url.searchParams.get('ids') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200)
      if (!ids.length) {
        sendJson(res, { error: 'Missing ids', tracks: [] }, 400)
        return true
      }
      const cookie = getCookie(ctx, 'netease')
      const detail = await call('song_detail', { ids: ids.join(','), cookie, timestamp: Date.now() })
      const songs = asArr(asObj(detail.body).songs).map(mapSongRecord).filter((t) => t.id)
      // song_detail 不保证返回顺序,按请求 ids 顺序重排
      const byId = new Map(songs.map((t) => [String(t.id), t]))
      const tracks = ids.map((id) => byId.get(id)).filter(Boolean)
      sendJson(res, { tracks })
    } catch (err) {
      console.error('[SongDetail]', err)
      sendJson(res, { error: (err as Error).message, tracks: [] }, 500)
    }
    return true
  }
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 起 server 手工验证**

Run: `npm run server:dev`(后台起,端口 35530),然后:

```bash
curl -s "http://127.0.0.1:35530/api/song/detail?ids=347230,186016" | head -c 400
```

Expected: 返回 `{"tracks":[...]}`,两首歌(海阔天空/光辉岁月),每项含 `name`/`artist`/`duration`(毫秒数量级,如 326000 而非 326)。再验证空参:

```bash
curl -s "http://127.0.0.1:35530/api/song/detail" | head -c 200
```

Expected: `{"error":"Missing ids","tracks":[]}`,HTTP 400。验证完停掉 server。

- [ ] **Step 4: 提交**

```bash
git add server/routes/netease.ts
git commit -m "feat: /api/song/detail 按 id 批量补曲目详情端点"
```

---

### Task 3: Server 改造 /api/playlist/tracks 返回全量 trackIds

**Files:**
- Modify: `server/routes/netease.ts`(`if (pn === '/api/playlist/tracks')` 区块,当前约 781-827 行)

**Interfaces:**
- Produces: `GET /api/playlist/tracks?id=X` → `{ playlist: { id, name, cover, trackCount }, trackIds: string[], tracks: Track[] }`
  - `trackIds` 为**完整**曲目 id 列表(来自 `playlist_detail` 的 `trackIds`,不受 500 限制)
  - `tracks` 为前 100 首详情(`song_detail` 补);接口不可用时 fallback 旧 `playlist_track_all`(limit 500)行为,此时 `trackIds` 从 tracks 推导

- [ ] **Step 1: 重写端点**

把 `if (pn === '/api/playlist/tracks') { ... }` 整块替换为:

```ts
  // ---------- 歌单曲目详情:全量 trackIds + 前 100 首详情(懒加载骨架) ----------
  if (pn === '/api/playlist/tracks') {
    try {
      const id = url.searchParams.get('id')
      if (!id) {
        sendJson(res, { error: 'Missing playlist id', trackIds: [], tracks: [] }, 400)
        return true
      }
      const cookie = getCookie(ctx, 'netease')
      let playlistMeta: { id: unknown; name: string; cover: string; trackCount: number } = {
        id,
        name: '',
        cover: '',
        trackCount: 0,
      }
      let trackIds: string[] = []
      let tracks: ReturnType<typeof mapSongRecord>[] = []

      // 1) playlist_detail:meta + 完整 trackIds(快,不受 500 限制)
      if (has('playlist_detail')) {
        try {
          const detail = await call('playlist_detail', { id, s: 0, cookie, timestamp: Date.now() })
          const pl = asObj(asObj(detail.body).playlist)
          playlistMeta = {
            id: pl.id || id,
            name: asStr(pl.name),
            cover: asStr(pl.coverImgUrl),
            trackCount: asNum(pl.trackCount),
          }
          trackIds = asArr(pl.trackIds)
            .map((t) => asStr(asObj(t).id))
            .filter(Boolean)
        } catch (err) {
          console.warn('[PlaylistTracks] playlist_detail failed:', (err as Error).message)
        }
      }

      // 2) song_detail 补前 100 首详情
      if (trackIds.length && has('song_detail')) {
        try {
          const head = trackIds.slice(0, 100)
          const detail = await call('song_detail', { ids: head.join(','), cookie, timestamp: Date.now() })
          const songs = asArr(asObj(detail.body).songs).map(mapSongRecord).filter((t) => t.id)
          const byId = new Map(songs.map((t) => [String(t.id), t]))
          tracks = head.map((tid) => byId.get(tid)).filter((t): t is ReturnType<typeof mapSongRecord> => !!t)
        } catch (err) {
          console.warn('[PlaylistTracks] song_detail failed:', (err as Error).message)
        }
      }

      // 3) fallback:playlist_track_all 旧逻辑(limit 500),trackIds 从结果推导
      if (!tracks.length && has('playlist_track_all')) {
        try {
          const all = await call('playlist_track_all', { id, limit: 500, offset: 0, cookie, timestamp: Date.now() })
          const ab = asObj(all.body)
          const rawTracks = Array.isArray(ab.songs) ? ab.songs : asArr(ab.tracks)
          tracks = rawTracks.map(mapSongRecord).filter((t) => t.id)
          if (!trackIds.length) trackIds = tracks.map((t) => asStr(t.id))
        } catch (err) {
          console.warn('[PlaylistTracks] playlist_track_all fallback failed:', (err as Error).message)
        }
      }

      if (!trackIds.length) trackIds = tracks.map((t) => asStr(t.id))
      if (!playlistMeta.trackCount) playlistMeta.trackCount = trackIds.length
      sendJson(res, { playlist: playlistMeta, trackIds, tracks })
    } catch (err) {
      console.error('[PlaylistTracks]', err)
      sendJson(res, { error: (err as Error).message, trackIds: [], tracks: [] }, 500)
    }
    return true
  }
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 手工验证**

Run: `npm run server:dev`,然后拿一个大公开歌单验证(例:歌单 2884035 云音乐飙升榜约 100 首;再找一个 >500 首公开歌单,如 60198 中的任意大歌单——用 `24381616` 或搜到的均可,关键断言是 `trackIds.length === playlist.trackCount` 且 `tracks.length ≤ 100`):

```bash
curl -s "http://127.0.0.1:35530/api/playlist/tracks?id=2884035" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('trackCount:',j.playlist.trackCount,'trackIds:',j.trackIds.length,'tracks:',j.tracks.length)})"
```

Expected: `trackIds` 长度 = trackCount,`tracks` ≤ 100,且 tracks[0] 有 name/duration(毫秒)。验证完停 server。

- [ ] **Step 4: 提交**

```bash
git add server/routes/netease.ts
git commit -m "feat: /api/playlist/tracks 返回全量 trackIds,突破 500 首上限"
```

---

### Task 4: MusicService 接口升级 + service 单例注册表

**Files:**
- Modify: `src/lib/music-service.ts`
- Modify: `src/lib/netease-music-service.ts`
- Modify: `src/lib/qq-music-service.ts`
- Create: `src/lib/service-registry.ts`
- Modify: `src/hooks/useMusicService.ts`

**Interfaces:**
- Produces:
  - `interface PlaylistSkeleton { trackIds: unknown[]; tracks: Track[] }`(`src/lib/music-service.ts` 导出)
  - `MusicService.getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton>`
  - `MusicService.getTracksByIds(ids: unknown[]): Promise<Track[]>`
  - `serviceFor(source: MusicSource): MusicService`、`neteaseService`、`qqService`(`src/lib/service-registry.ts` 导出,供 zustand store 等非 hook 场景用)
- 注意:`getPlaylistDetail` 本任务**保留**(现有调用方还没迁移),Task 8 收尾时移除。

- [ ] **Step 1: 接口定义**

`src/lib/music-service.ts` 在 `MusicService` 接口的 `getPlaylistDetail` 下方加两个方法,并在文件尾部(`RadarPlaylist` 旁)加骨架类型:

```ts
  /** 歌单骨架:完整 trackIds(顺序即歌单顺序)+ 已带详情的前缀批次(QQ/小歌单可能就是全部)。 */
  getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton>
  /** 按 id 批量补曲目详情;返回顺序与入参一致,查不到的跳过。 */
  getTracksByIds(ids: unknown[]): Promise<Track[]>
```

```ts
export interface PlaylistSkeleton {
  trackIds: unknown[]
  tracks: Track[]
}
```

- [ ] **Step 2: 网易实现**

`src/lib/netease-music-service.ts` 在 `getPlaylistDetail` 之后加(import 处补 `PlaylistSkeleton` 类型):

```ts
  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const res = await api.get<{ trackIds?: unknown[]; tracks?: Track[] }>('/api/playlist/tracks', { id: id as string | number })
    const tracks = res.tracks ?? []
    const trackIds = res.trackIds?.length ? res.trackIds : tracks.map((t) => t.id)
    return { trackIds, tracks }
  }

  async getTracksByIds(ids: unknown[]): Promise<Track[]> {
    if (ids.length === 0) return []
    const out: Track[] = []
    // 服务端单批上限 200
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      const res = await api.get<{ tracks: Track[] }>('/api/song/detail', { ids: batch.map(String).join(',') })
      out.push(...(res.tracks ?? []))
    }
    return out
  }
```

- [ ] **Step 3: QQ 实现**

`src/lib/qq-music-service.ts` 在 `getPlaylistDetail` 之后加(import 处补 `PlaylistSkeleton`):

```ts
  async getPlaylistSkeleton(id: unknown): Promise<PlaylistSkeleton> {
    const res = await api.get<{ tracks: Track[] }>('/api/qq/playlist/tracks', { id: id as string | number })
    const tracks = res.tracks ?? []
    // QQ 一次全量返回,骨架即全部曲目,无未加载窗口
    return { trackIds: tracks.map((t) => t.id), tracks }
  }

  async getTracksByIds(): Promise<Track[]> {
    // QQ skeleton 全量返回,不存在 pending 窗口;仅为接口完整性
    return []
  }
```

- [ ] **Step 4: service 单例注册表**

创建 `src/lib/service-registry.ts`:

```ts
// service 单例集中在此:hook(useMusicService)与非 hook 场景(zustand store 按 track.source 取)共用。

import { NeteaseMusicService } from './netease-music-service'
import { QQMusicService } from './qq-music-service'
import type { MusicService } from './music-service'
import type { MusicSource } from '../types/domain'

export const neteaseService = new NeteaseMusicService()
export const qqService = new QQMusicService()

export function serviceFor(source: MusicSource): MusicService {
  return source === 'qq' ? qqService : neteaseService
}
```

改写 `src/hooks/useMusicService.ts` 复用单例:

```ts
import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settings'
import { neteaseService, qqService } from '../lib/service-registry'
import type { MusicService } from '../lib/music-service'

export function useMusicService(): MusicService {
  const activeSource = useSettingsStore((s) => s.activeSource)
  return useMemo(() => (activeSource === 'qq' ? qqService : neteaseService), [activeSource])
}
```

- [ ] **Step 5: 验证 + 提交**

Run: `npm run typecheck && npm test`
Expected: 全过

```bash
git add src/lib/music-service.ts src/lib/netease-music-service.ts src/lib/qq-music-service.ts src/lib/service-registry.ts src/hooks/useMusicService.ts
git commit -m "feat: MusicService 增加歌单骨架/按 id 补详情接口与 service 注册表"
```

---

### Task 5: useLazyPlaylist hook(稀疏曲目 + 窗口补拉 + 模块级缓存)

**Files:**
- Create: `src/hooks/useLazyPlaylist.ts`

**Interfaces:**
- Consumes: Task 1 的 `TRACK_WINDOW`/`windowIndicesFor`/`windowSpan`/`buildQueue`;Task 4 的 `getPlaylistSkeleton`/`getTracksByIds`
- Produces:

```ts
function useLazyPlaylist(playlist: Playlist, initialTracks?: Track[]): {
  total: number                 // trackIds.length(骨架未回来时为 0)
  tracks: (Track | null)[]      // 稀疏数组,null = 未加载
  loading: boolean              // 骨架加载中
  error: boolean                // 骨架加载失败
  ensureRange(start: number, end: number): void  // 视口区间 → 补缺失窗口(幂等,可高频调)
  makeQueue(): Track[]          // 完整队列(未加载的为 pending 占位)
  retry(): void
}
```

- [ ] **Step 1: 实现 hook**

创建 `src/hooks/useLazyPlaylist.ts`:

```ts
// 歌单懒加载:全骨架(trackIds 全量)+ 按 100 首窗口补详情。
// 模块级缓存按 `${source}:${id}` 存,顶栏后退/前进或预览弹窗→详情页共用,不重拉。
// 竞态守卫沿用 loadSession 计数 ref 模式(参考 ExplorePage):切歌单/音源丢弃在途响应。

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useMusicService } from './useMusicService'
import { TRACK_WINDOW, windowIndicesFor, windowSpan, buildQueue } from '../lib/lazy-window'
import type { Playlist, Track } from '../types/domain'

interface LazyEntry {
  trackIds: unknown[]
  tracks: (Track | null)[]
  loadedWindows: Set<number>
  inflightWindows: Set<number>
  skeletonLoaded: boolean
  error: boolean
}

const cache = new Map<string, LazyEntry>()

function emptyEntry(): LazyEntry {
  return { trackIds: [], tracks: [], loadedWindows: new Set(), inflightWindows: new Set(), skeletonLoaded: false, error: false }
}

/** 每日推荐/雷达等已全量在手的场景:直接落缓存,不发任何请求。 */
function seededEntry(tracks: Track[]): LazyEntry {
  const e = emptyEntry()
  e.trackIds = tracks.map((t) => t.id)
  e.tracks = [...tracks]
  for (let w = 0; w * TRACK_WINDOW < tracks.length; w++) e.loadedWindows.add(w)
  e.skeletonLoaded = true
  return e
}

/** 骨架回来后标记已被前缀详情覆盖的完整窗口。 */
function markPrefixWindows(e: LazyEntry, prefixLen: number): void {
  const fullWindows = Math.floor(prefixLen / TRACK_WINDOW)
  for (let w = 0; w < fullWindows; w++) e.loadedWindows.add(w)
  if (prefixLen >= e.trackIds.length) {
    for (let w = 0; w * TRACK_WINDOW < e.trackIds.length; w++) e.loadedWindows.add(w)
  }
}

export function useLazyPlaylist(playlist: Playlist, initialTracks?: Track[]) {
  const service = useMusicService()
  const key = `${playlist.source}:${String(playlist.id)}`
  const [, bump] = useReducer((c: number) => c + 1, 0)
  const [retryTick, setRetryTick] = useState(0)
  const sessionRef = useRef(0)

  if (!cache.has(key)) {
    cache.set(key, initialTracks?.length ? seededEntry(initialTracks) : emptyEntry())
  }

  useEffect(() => {
    sessionRef.current += 1
    const session = sessionRef.current
    const e = cache.get(key)
    if (!e || e.skeletonLoaded || e.error) return
    service
      .getPlaylistSkeleton(playlist.id)
      .then((sk) => {
        if (sessionRef.current !== session) return
        e.trackIds = sk.trackIds
        e.tracks = sk.trackIds.map((_, i) => sk.tracks[i] ?? null)
        markPrefixWindows(e, sk.tracks.length)
        e.skeletonLoaded = true
        bump()
      })
      .catch(() => {
        if (sessionRef.current !== session) return
        e.error = true
        bump()
      })
    // playlist.id 已编码进 key;retryTick 触发重拉
  }, [key, service, retryTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const ensureRange = useCallback(
    (start: number, end: number) => {
      const e = cache.get(key)
      if (!e || !e.skeletonLoaded) return
      const total = e.trackIds.length
      const session = sessionRef.current
      for (const w of windowIndicesFor(start, end, TRACK_WINDOW, total)) {
        if (e.loadedWindows.has(w) || e.inflightWindows.has(w)) continue
        e.inflightWindows.add(w)
        const span = windowSpan(w, TRACK_WINDOW, total)
        service
          .getTracksByIds(e.trackIds.slice(span.start, span.end))
          .then((fetched) => {
            e.inflightWindows.delete(w)
            const byId = new Map(fetched.map((t) => [String(t.id), t]))
            for (let i = span.start; i < span.end; i++) {
              e.tracks[i] = byId.get(String(e.trackIds[i])) ?? e.tracks[i]
            }
            e.loadedWindows.add(w)
            if (sessionRef.current === session) bump()
          })
          .catch(() => {
            // 失败不标记 loaded:下次滚到该窗口自动重试
            e.inflightWindows.delete(w)
          })
      }
    },
    [key, service]
  )

  const entry = cache.get(key)!
  return {
    total: entry.trackIds.length,
    tracks: entry.tracks,
    loading: !entry.skeletonLoaded && !entry.error,
    error: entry.error,
    ensureRange,
    makeQueue: () => buildQueue(entry.trackIds, entry.tracks, playlist.source),
    retry: () => {
      entry.error = false
      setRetryTick((t) => t + 1)
    },
  }
}
```

- [ ] **Step 2: 验证 + 提交**

Run: `npm run typecheck && npm test`
Expected: 全过

```bash
git add src/hooks/useLazyPlaylist.ts
git commit -m "feat: useLazyPlaylist 歌单骨架 + 窗口懒加载 hook"
```

---

### Task 6: VirtualList 固定行高虚拟列表组件

**Files:**
- Create: `src/components/ui/VirtualList.tsx`

**Interfaces:**
- Consumes: Task 1 的 `virtualRange`
- Produces:

```tsx
interface VirtualListProps {
  total: number
  rowHeight: number
  /** 外层滚动容器(整页滚动的 div)的 ref */
  scrollRef: RefObject<HTMLElement | null>
  overscan?: number   // 默认 10
  onRangeChange?(start: number, end: number): void
  renderRow(index: number): ReactNode
}
export function VirtualList(props: VirtualListProps): JSX.Element
```

- [ ] **Step 1: 实现组件**

创建 `src/components/ui/VirtualList.tsx`:

```tsx
// 固定行高虚拟列表:总高度 = rowHeight × total,滚动条从第一刻就是完整长度,
// 可直接拖到任意位置;只渲染可视区 ± overscan 的行,行绝对定位。
// 滚动容器由外部传入(详情页是整页滚动),内部用 rAF 节流计算可视区间。

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { virtualRange } from '../../lib/lazy-window'

interface VirtualListProps {
  total: number
  rowHeight: number
  scrollRef: RefObject<HTMLElement | null>
  overscan?: number
  onRangeChange?(start: number, end: number): void
  renderRow(index: number): ReactNode
}

export function VirtualList({ total, rowHeight, scrollRef, overscan = 10, onRangeChange, renderRow }: VirtualListProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const rangeRef = useRef(range)

  useEffect(() => {
    const scrollEl = scrollRef.current
    const inner = innerRef.current
    if (!scrollEl || !inner) return
    let raf = 0
    function update() {
      raf = 0
      if (!scrollEl || !inner) return
      // 列表相对滚动内容顶部的偏移(header 占的高度)
      const listTop = inner.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
      const next = virtualRange(scrollEl.scrollTop, scrollEl.clientHeight, listTop, rowHeight, total, overscan)
      if (next.start !== rangeRef.current.start || next.end !== rangeRef.current.end) {
        rangeRef.current = next
        setRange(next)
      }
    }
    function schedule() {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    scrollEl.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(scrollEl)
    return () => {
      scrollEl.removeEventListener('scroll', schedule)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, rowHeight, total, overscan])

  useEffect(() => {
    if (range.end > range.start) onRangeChange?.(range.start, range.end)
  }, [range, onRangeChange])

  const rows: ReactNode[] = []
  for (let i = range.start; i < range.end; i++) {
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}>
        {renderRow(i)}
      </div>
    )
  }
  return (
    <div ref={innerRef} style={{ position: 'relative', height: total * rowHeight }}>
      {rows}
    </div>
  )
}
```

- [ ] **Step 2: 验证 + 提交**

Run: `npm run typecheck`
Expected: 无错误

```bash
git add src/components/ui/VirtualList.tsx
git commit -m "feat: 固定行高 VirtualList 虚拟列表组件"
```

---

### Task 7: PlaylistDetailView 共用详情组件 + 两页接入

**Files:**
- Create: `src/components/Playlist/PlaylistDetailView.tsx`
- Create: `src/components/Playlist/PlaylistDetailView.module.css`
- Modify: `src/stores/navigation.ts`(`tracks` 变可选)
- Modify: `src/pages/LibraryPage.tsx`
- Modify: `src/pages/ExplorePage.tsx`

**Interfaces:**
- Consumes: Task 5 `useLazyPlaylist`、Task 6 `VirtualList`、现有 `TrackRow`/`useScrollGradient`/`GradientText`/motion-presets
- Produces:

```tsx
export const TRACK_ROW_HEIGHT = 56  // TrackRow: padding 8×2 + cover 40
interface PlaylistDetailViewProps {
  playlist: Playlist
  initialTracks?: Track[]           // 每日推荐/雷达传全量,不发请求
  layoutIdPrefix: 'explore-cover' | 'library-cover'
}
export function PlaylistDetailView(props: PlaylistDetailViewProps): JSX.Element
```

- 导航类型变更:`{ type: 'playlist'; from: 'explore' | 'library'; playlist: Playlist; tracks?: Track[] }`

- [ ] **Step 1: navigation store 的 tracks 变可选**

`src/stores/navigation.ts` 第 10 行改为:

```ts
  /** 歌单详情:tracks 为可选初始数据(每日推荐/雷达已全量在手);普通歌单由详情视图懒加载。 */
  | { type: 'playlist'; from: 'explore' | 'library'; playlist: Playlist; tracks?: Track[] }
```

- [ ] **Step 2: 创建 PlaylistDetailView 组件**

创建 `src/components/Playlist/PlaylistDetailView.tsx`:

```tsx
// 歌单详情共用视图(Library / Explore 共用):
// 全骨架懒加载(useLazyPlaylist)+ 虚拟列表(VirtualList),未加载行显示 shimmer 占位。
// 播放任意一行时按完整 trackIds 入队,未加载详情的为 pending 占位曲目。

import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useScrollGradient } from '../../hooks/useScrollGradient'
import { useLazyPlaylist } from '../../hooks/useLazyPlaylist'
import { useNavigationStore } from '../../stores/navigation'
import { usePlaylistStore } from '../../stores/playlist'
import { GradientText } from '../ui/GradientText'
import { VirtualList } from '../ui/VirtualList'
import { TrackRow } from '../Explore/TrackRow'
import { fadeRise, springGentle } from '../../lib/motion-presets'
import type { Playlist, Track } from '../../types/domain'
import styles from './PlaylistDetailView.module.css'

/** TrackRow 实测高度:上下 padding 8×2 + 封面 40。虚拟列表按此定位,改 TrackRow 尺寸需同步。 */
export const TRACK_ROW_HEIGHT = 56

interface PlaylistDetailViewProps {
  playlist: Playlist
  initialTracks?: Track[]
  layoutIdPrefix: 'explore-cover' | 'library-cover'
}

function SkeletonTrackRow({ index }: { index: number }) {
  return (
    <div className={styles.skeletonRow} aria-hidden="true">
      <span className={styles.skeletonIndex}>{index + 1}</span>
      <span className={styles.skeletonCover} />
      <span className={styles.skeletonLines}>
        <i />
        <i />
      </span>
    </div>
  )
}

export function PlaylistDetailView({ playlist, initialTracks, layoutIdPrefix }: PlaylistDetailViewProps) {
  const pageRef = useRef<HTMLDivElement>(null)
  const { topOpacity, bottomOpacity, handleScroll, setTopOpacity, setBottomOpacity } = useScrollGradient()
  const { total, tracks, loading, error, ensureRange, makeQueue, retry } = useLazyPlaylist(playlist, initialTracks)

  // 进入/切换详情时重置滚动渐变遮罩
  useEffect(() => {
    setTopOpacity(0)
    setBottomOpacity(0)
  }, [playlist, setTopOpacity, setBottomOpacity])

  function playAt(index: number) {
    usePlaylistStore.getState().setQueue(makeQueue(), index)
  }

  return (
    <div className={styles.page} ref={pageRef} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />
      <div className={styles.detailHeader}>
        <button className={`${styles.backBtn} no-drag`} onClick={() => useNavigationStore.getState().goBack()}>
          ← 返回
        </button>
        <div className={styles.detailMeta}>
          {playlist.cover && (
            <motion.img
              className={styles.detailCover}
              src={playlist.cover}
              alt=""
              layoutId={`${layoutIdPrefix}-${String(playlist.id)}`}
              transition={springGentle}
            />
          )}
          <motion.div variants={fadeRise} initial="hidden" animate="visible" transition={{ ...springGentle, delay: 0.15 }}>
            <h1 className={styles.detailTitle}>
              <GradientText>{playlist.name}</GradientText>
            </h1>
            <p className={styles.detailSub}>{loading ? '加载中…' : `${total} 首`}</p>
          </motion.div>
        </div>
      </div>
      {error ? (
        <div className={styles.errorHint}>
          <p>歌单加载失败</p>
          <button className={`${styles.retryBtn} no-drag`} onClick={retry}>
            重试
          </button>
        </div>
      ) : (
        <motion.div
          className={styles.trackList}
          variants={fadeRise}
          initial="hidden"
          animate="visible"
          transition={{ ...springGentle, delay: 0.15 }}
        >
          <VirtualList
            total={total}
            rowHeight={TRACK_ROW_HEIGHT}
            scrollRef={pageRef}
            onRangeChange={ensureRange}
            renderRow={(i) => {
              const t = tracks[i]
              return t ? <TrackRow track={t} index={i} onPlay={() => playAt(i)} /> : <SkeletonTrackRow index={i} />
            }}
          />
        </motion.div>
      )}
      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
    </div>
  )
}
```

- [ ] **Step 3: 样式**

创建 `src/components/Playlist/PlaylistDetailView.module.css`。`.page`/`.detailHeader`/`.backBtn`/`.detailMeta`/`.detailCover`/`.detailTitle`/`.detailSub` **从 `src/pages/LibraryPage.module.css` 对应类原样复制**(执行时以该文件当前内容为准,保持视觉一致),`.trackList { padding: 0; }`,再追加骨架与错误态:

```css
/* 未加载行的 shimmer 占位:结构对齐 TrackRow(index/cover/两行文本),高度同 56px */
.skeletonRow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  height: 56px;
  box-sizing: border-box;
}

.skeletonIndex {
  width: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--sm-text-secondary);
  flex-shrink: 0;
}

.skeletonCover {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--sm-bg-elevated);
  flex-shrink: 0;
}

.skeletonLines {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.skeletonLines i {
  display: block;
  height: 10px;
  border-radius: 5px;
  background: var(--sm-bg-elevated);
  animation: skeletonPulse 1.4s var(--sm-ease-in-out) infinite;
}

.skeletonLines i:first-child { width: 40%; }
.skeletonLines i:last-child { width: 24%; height: 8px; animation-delay: 0.2s; }

@keyframes skeletonPulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

.errorHint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--sm-text-secondary);
}

.retryBtn {
  padding: 6px 20px;
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius-pill);
  background: var(--sm-bg-elevated);
  color: var(--sm-text-primary);
  cursor: pointer;
}
```

注意:`.skeletonRow` 的 gap/padding 若与 `TrackRow.module.css` 当前值不一致,以 TrackRow 为准对齐,保证占位行与真实行视觉对得上。

- [ ] **Step 4: LibraryPage 接入**

`src/pages/LibraryPage.tsx`:
- detail 分支整体替换为:

```tsx
  if (detail) {
    return <PlaylistDetailView playlist={detail.playlist} initialTracks={detail.tracks} layoutIdPrefix="library-cover" />
  }
```

- `openPlaylist` 改为直接导航(不再先拉全量,详情视图自己懒加载),删除 `loadingId` state 与 `service`:

```tsx
  function openPlaylist(playlist: Playlist) {
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'library', playlist })
  }
```

- PlaylistCard 的 onClick 相应改为 `onClick={() => openPlaylist(pl)}`。
- 清理不再使用的 import(`useMusicService`、`AnimatedTrackRow`、`GradientText`?——`GradientText` 列表页标题还在用,保留;`motion`/`fadeRise`/`springGentle` 若仅 detail 用则删)与 `playTrack`、滚动渐变的 detail 重置 effect。`useScrollGradient` 若仅 detail 在用也一并清理(列表页 `styles.page` 没挂 onScroll 的话)。以 typecheck 与"无未使用变量"为准。

- [ ] **Step 5: ExplorePage 接入**

`src/pages/ExplorePage.tsx`:
- detail 分支整体替换为:

```tsx
  if (detail) {
    return <PlaylistDetailView playlist={detail.playlist} initialTracks={detail.tracks} layoutIdPrefix="explore-cover" />
  }
```

- `openDaily`/`openRadar` 不变(继续传全量 tracks,`initialTracks` 直接落缓存零请求)。
- 清理 detail 分支独占的 import(`AnimatedTrackRow` 等)。`playTrack` 若仍被 Stack 卡等使用则保留。

- [ ] **Step 6: 验证 + 提交**

Run: `npm run typecheck && npm test`
Expected: 全过

再跑 `npm run dev` 手测:我的库 → 打开一个歌单,详情立即出现(标题/封面/总数),前 100 首有内容,往下滚出现骨架行并逐窗填充;把滚动条直接拖到底,尾部窗口能加载出来;每日推荐/雷达进详情不发骨架请求(DevTools Network 无 `/api/playlist/tracks`)。

```bash
git add src/components/Playlist/PlaylistDetailView.tsx src/components/Playlist/PlaylistDetailView.module.css src/stores/navigation.ts src/pages/LibraryPage.tsx src/pages/ExplorePage.tsx
git commit -m "feat: 共用歌单详情视图,接入懒加载与虚拟列表"
```

---

### Task 8: 队列 pending 占位播放 + QueuePanel 骨架行

**Files:**
- Modify: `src/stores/playlist.ts`
- Modify: `src/components/Player/QueuePanel.tsx`
- Modify: `src/components/Player/QueuePanel.module.css`

**Interfaces:**
- Consumes: Task 4 `serviceFor`;`Track.pending`
- Produces: `playAt/next/prev/setQueue` 对 pending 曲目透明——先补详情回填队列再播;详情失败凭 id 兜底直接播(网易 URL 只需 id)

- [ ] **Step 1: playlist store 改造**

`src/stores/playlist.ts`:顶部加 `import { serviceFor } from '../lib/service-registry'`,在 `create` 之前加模块级函数:

```ts
/** pending 占位曲目:先按 id 补详情;失败则去掉 pending 标记凭 id 兜底直接播(网易播放 URL 只需 id)。 */
async function resolvePending(track: Track): Promise<Track> {
  try {
    const [full] = await serviceFor(track.source).getTracksByIds([track.id])
    if (full) return full
  } catch {
    /* 详情失败走兜底 */
  }
  return { ...track, pending: false, name: track.name || '未知曲目' }
}
```

`setQueue`/`playAt`/`next`/`prev` 替换为:

```ts
  setQueue(tracks, startIndex = 0) {
    set({ queue: tracks, queueIndex: -1 })
    if (tracks.length) get().playAt(startIndex)
  },

  playAt(index) {
    const track = get().queue[index]
    if (!track) return
    set({ queueIndex: index })
    if (!track.pending) {
      void usePlayerStore.getState().loadTrack(track)
      return
    }
    void resolvePending(track).then((resolved) => {
      const { queue, queueIndex } = get()
      // 等待补详情期间用户已切歌/换队列:丢弃
      if (queueIndex !== index || String(queue[index]?.id) !== String(track.id)) return
      const nextQueue = [...queue]
      nextQueue[index] = resolved
      set({ queue: nextQueue })
      void usePlayerStore.getState().loadTrack(resolved)
    })
  },

  next() {
    const { queue, queueIndex } = get()
    if (!queue.length) return
    get().playAt((queueIndex + 1) % queue.length)
  },

  prev() {
    const { queue, queueIndex } = get()
    if (!queue.length) return
    get().playAt((queueIndex - 1 + queue.length) % queue.length)
  },
```

- [ ] **Step 2: QueuePanel 骨架行**

`src/components/Player/QueuePanel.tsx` 队列行的 `rowText` 部分改为:

```tsx
                    <span className={styles.rowText}>
                      {t.pending ? (
                        <span className={styles.rowSkeleton} aria-hidden="true">
                          <i />
                          <i />
                        </span>
                      ) : (
                        <>
                          <span className={styles.rowName}>{t.name}</span>
                          <span className={styles.rowArtist}>{t.artist}</span>
                        </>
                      )}
                    </span>
```

`src/components/Player/QueuePanel.module.css` 追加:

```css
/* pending 占位曲目:详情未补到,显示 shimmer 双行 */
.rowSkeleton {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 2px 0;
}

.rowSkeleton i {
  display: block;
  height: 9px;
  border-radius: 5px;
  background: var(--sm-bg-elevated);
  animation: queueSkeletonPulse 1.4s var(--sm-ease-in-out) infinite;
}

.rowSkeleton i:first-child { width: 55%; }
.rowSkeleton i:last-child { width: 32%; height: 7px; animation-delay: 0.2s; }

@keyframes queueSkeletonPulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
```

- [ ] **Step 3: 验证 + 提交**

Run: `npm run typecheck && npm test`
Expected: 全过

`npm run dev` 手测:大歌单详情页点"未加载区域"附近某首已加载歌 → 打开队列面板,总数 = 歌单总数,远处曲目是骨架行;点一首骨架行 → 短暂等待后正常播放且该行变为真实歌名;下一首/上一首跨 pending 曲目正常。

```bash
git add src/stores/playlist.ts src/components/Player/QueuePanel.tsx src/components/Player/QueuePanel.module.css
git commit -m "feat: 队列支持 pending 占位曲目,播到再补详情"
```

---

### Task 9: PlaylistPreviewModal 迁移 + 移除 getPlaylistDetail 与 AnimatedTrackRow

**Files:**
- Modify: `src/components/Explore/PlaylistPreviewModal.tsx`
- Modify: `src/lib/music-service.ts`(删 `getPlaylistDetail`)
- Modify: `src/lib/netease-music-service.ts`(删实现)
- Modify: `src/lib/qq-music-service.ts`(删实现)
- Delete: `src/components/Explore/AnimatedTrackRow.tsx`、`src/components/Explore/AnimatedTrackRow.module.css`(Task 7 后无使用方)

**Interfaces:**
- Consumes: Task 5 `useLazyPlaylist`(与详情页共用缓存:弹窗拉过骨架,进详情页零请求)

- [ ] **Step 1: 改写 PlaylistPreviewModal**

`src/components/Explore/PlaylistPreviewModal.tsx` 整体改写:hook 需要非空 playlist,把面板抽成内部组件。

```tsx
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLazyPlaylist } from '../../hooks/useLazyPlaylist'
import { usePlaylistStore } from '../../stores/playlist'
import { useNavigationStore } from '../../stores/navigation'
import { springGentle } from '../../lib/motion-presets'
import type { Playlist } from '../../types/domain'
import styles from './PlaylistPreviewModal.module.css'

interface PlaylistPreviewModalProps {
  playlist: Playlist | null
  onClose(): void
}

/** 面板内容:拆出来保证 useLazyPlaylist 拿到非空 playlist(与详情页共用缓存,进详情零请求)。 */
function PreviewPanel({ playlist, onClose }: { playlist: Playlist; onClose(): void }) {
  const { total, tracks, loading, makeQueue } = useLazyPlaylist(playlist)

  function playAll() {
    if (total === 0) return
    usePlaylistStore.getState().setQueue(makeQueue(), 0)
    onClose()
  }

  function playTrack(index: number) {
    usePlaylistStore.getState().setQueue(makeQueue(), index)
  }

  function openDetail() {
    if (total === 0) return
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist })
    onClose()
  }

  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={springGentle}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        {playlist.cover ? <img className={styles.cover} src={playlist.cover} alt="" /> : <div className={styles.cover} />}
        <div className={styles.meta}>
          <h3 className={styles.name}>{playlist.name}</h3>
          {playlist.description && <p className={styles.desc}>{playlist.description}</p>}
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">✕</button>
      </div>
      <div className={styles.actions}>
        <button className={styles.playAll} onClick={playAll} disabled={total === 0}>▶ 播放全部</button>
        <button className={styles.openBtn} onClick={openDetail} disabled={total === 0}>进入歌单</button>
        <span className={styles.count}>{loading ? '加载中…' : `${total} 首`}</span>
      </div>
      <div className={styles.list}>
        {/* 预览只展示已加载详情的前缀批次;完整列表进详情页看 */}
        {tracks.map((t, i) =>
          t ? (
            <button key={`${String(t.id)}-${i}`} className={styles.row} onClick={() => playTrack(i)}>
              <span className={styles.index}>{i + 1}</span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{t.name}</span>
                <span className={styles.rowArtist}>{t.artist}</span>
              </span>
            </button>
          ) : null
        )}
      </div>
    </motion.div>
  )
}

/** 歌单小卡预览:简介 + 可滚动曲目,可播放全部或进入完整详情页。 */
export function PlaylistPreviewModal({ playlist, onClose }: PlaylistPreviewModalProps) {
  useEffect(() => {
    if (!playlist) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playlist, onClose])

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
          <PreviewPanel playlist={playlist} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

注意:原文件若有本计划未覆盖的近期用户改动(工作区是 dirty 的),以现场文件为准做等价迁移,不要盲目整文件覆盖。

- [ ] **Step 2: 移除 getPlaylistDetail**

- `src/lib/music-service.ts`:删除接口里的 `getPlaylistDetail(id: unknown): Promise<Track[]>`。
- `src/lib/netease-music-service.ts`、`src/lib/qq-music-service.ts`:删除对应实现方法。
- 全局确认无残留调用:`grep -rn "getPlaylistDetail" src overlays` 应无结果。

- [ ] **Step 3: 删除 AnimatedTrackRow**

先确认无使用方:`grep -rn "AnimatedTrackRow" src overlays` 只剩其自身文件,然后:

```bash
git rm src/components/Explore/AnimatedTrackRow.tsx src/components/Explore/AnimatedTrackRow.module.css
```

若 grep 仍有使用方(说明 Task 7 清理不全),先修调用处再删。

- [ ] **Step 4: 验证 + 提交**

Run: `npm run typecheck && npm test`
Expected: 全过

```bash
git add src/components/Explore/PlaylistPreviewModal.tsx src/lib/music-service.ts src/lib/netease-music-service.ts src/lib/qq-music-service.ts
git commit -m "refactor: 预览弹窗迁移到懒加载骨架,移除 getPlaylistDetail 与 AnimatedTrackRow"
```

---

### Task 10: 端到端验证(500+ 真实歌单)

**Files:** 无新改动(只验证;发现问题按 systematic-debugging 处理后补修)

- [ ] **Step 1: 全量静态验证**

Run: `npm run typecheck && npm test`
Expected: 全过

- [ ] **Step 2: 真机验证清单**

`npm run dev` 启动(已登录网易账号),逐项确认:

1. **500+ 歌单总数**:我的库打开 >500 首的歌单,标题下"N 首"= 网易客户端里的真实总数(不再是 500)。
2. **秒开**:详情页立即出现(不等全量),前 100 首有内容。
3. **滚动条随机访问**:把滚动条直接拖到最底部,能看到骨架行 → 1-2 秒内填充为真实曲目;中部任意位置同理。
4. **跳播未加载曲目**:点第 600 首附近一行(或骨架填充后的行)能正常播放。
5. **播放全部覆盖全量**:详情页点第 1 首,打开队列面板,队列总数 = 歌单总数;拖到队列尾部点一首 pending 骨架行,能播且行内文字补齐。
6. **每日推荐/雷达**:进详情正常显示与播放(走 initialTracks,Network 面板无 `/api/playlist/tracks` 请求)。
7. **预览弹窗**:探索页开歌单小卡,总数正确、播放全部可用;"进入歌单"后详情页不重复发骨架请求(共用缓存)。
8. **QQ 音源**:切到 QQ,打开一个歌单详情,列表/播放正常(全量路径,无骨架行)。
9. **快速切换竞态**:快速连开两个歌单详情(开 A → 立即返回 → 开 B),B 的列表内容正确无串台。
10. **主题/滚动渐变**:亮暗主题下骨架行颜色正常,顶部/底部滚动渐变遮罩行为不变。

(可用项目既有的 Electron playwright 实测方法自动化其中 1-5 项;不可用时人工过一遍。)

- [ ] **Step 3: 收尾**

全部通过后,如有验证期修复,逐项小提交。然后向用户汇报验证结果与剩余风险。
