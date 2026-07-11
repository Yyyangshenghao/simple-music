# 「漫游」页网易云写回真实歌单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「漫游」页网易云分支从纯本地 localStorage 临时歌单,改造成写回账号的真实歌单(固定名「每日漫游」,隐私歌单,靠简介水印+日期识别归属),本地只缓存歌单 id。QQ 分支完全不动。

**Architecture:** 新增一个简介构造/解析纯函数模块;`MusicService` 加 4 个网易专属可选方法(建歌单/按名找歌单/按 id 取歌单+简介+曲目/替换曲目/改简介,共 5 个,详见下);`roam` store 的 `generate()` 按 `service.createPlaylist` 是否存在分流,新增一个"打开页面时异步核实真实歌单状态"的方法;`RoamPage` 增加未登录禁用态与加载态。QQ 分支的所有现有代码路径不作任何修改。

**Tech Stack:** React 18 + TypeScript + zustand + vitest + Node HTTP server(`server/routes/netease.ts` + `server/lib/netease-client.ts`,底层 NeteaseCloudMusicApi 包)。

## Global Constraints

- 仅改造网易云分支;QQ 分支(`qq-music-service.ts`、`server/routes/qq-music.ts`)本次不动。
- 歌单名固定 `每日漫游`,建为隐私歌单(`privacy=10`)。
- 简介格式固定:`Simple Music · YYYY-MM-DD · 歌手A/歌手B/歌手C`(水印 `Simple Music`、日期、` / ` 分隔的歌手名单,三段用 ` · ` 分隔)。
- 同名但简介无水印的歌单视为不是本应用创建的,另建新的,不 touch 已有的。
- 网易云未登录(`settings.neteaseLoggedIn === false`)时「漫游」页直接禁用,不发任何请求,不提供本地兜底。
- 本地只缓存歌单 id(单独一个 localStorage key,与 QQ 现有的整份歌单缓存是两套独立存档),永不主动过期删除,只有按 id 查不到歌单时才清掉重新走查找流程。
- 每次"生成"复用同一个歌单实体(清空曲目重新塞入 + 覆盖简介),不新建"每日漫游 2"这类。
- 每首 `Track` 播放走 `serviceFor(track.source)`(既有约定,本次改造不影响播放路径)。
- 样式/动效改动(如有)沿用 `src/styles/tokens.css`、`src/lib/motion-presets.ts`,不写新魔法数值。

---

### Task 1:简介构造/解析纯函数

**Files:**
- Create: `src/lib/roam-description.ts`
- Test: `src/lib/roam-description.test.ts`

**Interfaces:**
- Consumes:无(纯字符串处理,无项目内依赖)。
- Produces(供 Task 4 使用):
  - `export interface ParsedRoamDescription { date: string; artistNames: string[] }`
  - `export function buildRoamDescription(date: string, artistNames: string[]): string`
  - `export function parseRoamDescription(description: string | undefined): ParsedRoamDescription | null`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/roam-description.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildRoamDescription, parseRoamDescription } from './roam-description'

describe('buildRoamDescription', () => {
  it('拼装水印/日期/歌手名单,用 · 分隔,歌手名单用 / 分隔', () => {
    expect(buildRoamDescription('2026-07-11', ['周杰伦', '邓紫棋'])).toBe(
      'Simple Music · 2026-07-11 · 周杰伦/邓紫棋'
    )
  })

  it('歌手名单为空时也能拼装(第三段为空字符串)', () => {
    expect(buildRoamDescription('2026-07-11', [])).toBe('Simple Music · 2026-07-11 · ')
  })
})

describe('parseRoamDescription', () => {
  it('build 后原样 parse 回来(round-trip)', () => {
    const desc = buildRoamDescription('2026-07-11', ['周杰伦', '邓紫棋', '林俊杰'])
    expect(parseRoamDescription(desc)).toEqual({
      date: '2026-07-11',
      artistNames: ['周杰伦', '邓紫棋', '林俊杰'],
    })
  })

  it('简介缺失返回 null', () => {
    expect(parseRoamDescription(undefined)).toBeNull()
  })

  it('简介不含水印返回 null(用户自建的同名歌单)', () => {
    expect(parseRoamDescription('随便写的简介 2026-07-11')).toBeNull()
  })

  it('日期格式不对返回 null', () => {
    expect(parseRoamDescription('Simple Music · 不是日期 · 周杰伦')).toBeNull()
  })

  it('段数不足返回 null', () => {
    expect(parseRoamDescription('Simple Music · 2026-07-11')).toBeNull()
  })

  it('容忍前后多余空白', () => {
    expect(parseRoamDescription('Simple Music ·  2026-07-11  · 周杰伦 / 邓紫棋')).toEqual({
      date: '2026-07-11',
      artistNames: ['周杰伦', '邓紫棋'],
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/roam-description.test.ts`
Expected: FAIL,报找不到 `./roam-description` 模块。

- [ ] **Step 3: 写最小实现**

创建 `src/lib/roam-description.ts`:

```ts
/** 「每日漫游」歌单简介的构造与解析:水印 + 日期 + 歌手名单,三段用 ' · ' 分隔,用于识别歌单归属与判断是否需要重新生成。 */

const WATERMARK = 'Simple Music'
const SEPARATOR = ' · '

export interface ParsedRoamDescription {
  date: string
  artistNames: string[]
}

export function buildRoamDescription(date: string, artistNames: string[]): string {
  return [WATERMARK, date, artistNames.join('/')].join(SEPARATOR)
}

export function parseRoamDescription(description: string | undefined): ParsedRoamDescription | null {
  if (!description || !description.includes(WATERMARK)) return null
  const parts = description.split(SEPARATOR)
  if (parts.length < 3) return null
  const date = parts[1]?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const artistNames = (parts[2] ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  return { date, artistNames }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/roam-description.test.ts`
Expected: PASS(7 个用例全过)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/roam-description.ts src/lib/roam-description.test.ts
git commit -m "feat: 新增漫游歌单简介水印构造/解析纯函数"
```

---

### Task 2:Server 新增/扩展路由(网易云)

**Files:**
- Modify: `server/routes/netease.ts`

**Interfaces:**
- Consumes:既有的 `call`/`has`/`asObj`/`asStr`/`requireLogin`/`getCookie`/`sendJson`/`readRequestBody`/`normalizeApiCode` 等 helper(文件顶部已 import,无需新增 import)。
- Produces(供 Task 3 使用):
  - `/api/user/playlists` 响应的每个 `playlists[]` 项新增 `description: string` 字段。
  - `/api/playlist/tracks` 响应的 `playlist` 对象新增 `description: string` 字段。
  - 新增 `POST /api/playlist/desc/update`:body `{ id, desc }` → `{ loggedIn: true, success: boolean, code: number, body }`。
  - 新增 `POST /api/playlist/remove-songs`:body `{ pid, ids }`(`ids` 逗号分隔)→ `{ loggedIn: true, pid, success: boolean, code: number, body }`。

- [ ] **Step 1:`/api/user/playlists` 补充 `description` 字段**

修改 `server/routes/netease.ts` 第 439-451 行(`/api/user/playlists` 路由内的 `list` 构造):

```ts
      const list = asArr(asObj(r.body).playlist).map((raw) => {
        const pl = asObj(raw)
        return {
          id: pl.id,
          name: pl.name,
          cover: asStr(pl.coverImgUrl),
          trackCount: asNum(pl.trackCount),
          playCount: asNum(pl.playCount),
          creator: asStr(asObj(pl.creator).nickname),
          subscribed: !!pl.subscribed,
          specialType: asNum(pl.specialType),
          description: asStr(pl.description),
        }
      })
```

- [ ] **Step 2:`/api/playlist/tracks` 补充 `description` 字段**

`getPlaylistSkeleton`(既有代码,`src/lib/netease-music-service.ts`)从来不读这个端点响应里的 `playlist` 字段,只用 `trackIds`/`tracks`,所以现有 `playlistMeta` 只给了 `id/name/cover/trackCount` 四个字段——这不是完整的领域层 `Playlist` 形状(缺 `provider`/`source`/`type`/`playCount`/`creator`),但这是既有代码本来就有的情况(`/api/user/playlists` 的既有映射同样不全,`getLikedPlaylist()` 早就这么用了),本次不重新整形,只加 `description` 一个字段,交由 Task 3 用一个只声明实际用到的字段的轻量类型来接。

修改 `server/routes/netease.ts` 第 815-843 行(`playlistMeta` 的类型与构造):

```ts
      let playlistMeta: { id: unknown; name: string; cover: string; trackCount: number; description: string } = {
        id,
        name: '',
        cover: '',
        trackCount: 0,
        description: '',
      }
      let trackIds: string[] = []
      let tracks: ReturnType<typeof mapSongRecord>[] = []
      let upstreamError: string | null = null

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
            description: asStr(pl.description),
          }
          trackIds = asArr(pl.trackIds)
            .map((t) => asStr(asObj(t).id))
            .filter(Boolean)
        } catch (err) {
          upstreamError = (err as Error).message
          console.warn('[PlaylistTracks] playlist_detail failed:', (err as Error).message)
        }
      }
```

(这段只在原有对象字面量里加了 `description` 字段,其余逻辑不变;下面第 2/3 步的 `song_detail`/`playlist_track_all` fallback 代码不用动。)

- [ ] **Step 3:新增两个路由**

在 `server/routes/netease.ts` 第 618 行(`/api/playlist/add-song` 路由块的收尾 `return true }` 之后)插入:

```ts

  // ---------- 更新歌单简介(漫游功能写"水印+日期+歌手名单"用) ----------
  if (pn === '/api/playlist/desc/update') {
    try {
      const info = await requireLogin(res, ctx, sendJson)
      if (!info) return true
      const cookie = getCookie(ctx, 'netease')
      const body = req.method === 'POST' ? await readRequestBody(req) : {}
      const id = body.id || url.searchParams.get('id')
      const desc = body.desc !== undefined ? String(body.desc) : (url.searchParams.get('desc') || '')
      if (!id) {
        sendJson(res, { error: 'Missing playlist id' }, 400)
        return true
      }
      const r = await call('playlist_desc_update', { id, desc, cookie, timestamp: Date.now() })
      const code = normalizeApiCode(r)
      const success = code === 200
      sendJson(res, { loggedIn: true, success, code, body: r.body || r }, success ? 200 : 409)
    } catch (err) {
      console.error('[PlaylistDescUpdate]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }

  // ---------- 从歌单批量删除曲目(漫游功能"清空重塞"用) ----------
  if (pn === '/api/playlist/remove-songs') {
    try {
      const info = await requireLogin(res, ctx, sendJson)
      if (!info) return true
      const cookie = getCookie(ctx, 'netease')
      const body = req.method === 'POST' ? await readRequestBody(req) : {}
      const pid = body.pid || url.searchParams.get('pid')
      const ids = body.ids || url.searchParams.get('ids')
      if (!pid || !ids) {
        sendJson(res, { error: 'Missing playlist id or song ids' }, 400)
        return true
      }
      const r = await call('playlist_tracks', { op: 'del', pid, tracks: String(ids), cookie, timestamp: Date.now() })
      const code = normalizeApiCode(r)
      const success = code === 200 && !asObj(r.body || r).error
      sendJson(res, { loggedIn: true, pid, success, code, body: r.body || r }, success ? 200 : (code === 401 ? 401 : 409))
    } catch (err) {
      console.error('[PlaylistRemoveSongs]', err)
      sendJson(res, { error: (err as Error).message }, 500)
    }
    return true
  }
```

- [ ] **Step 4:类型检查**

Run: `npm run typecheck`
Expected: 两套 tsconfig 全量通过,无报错。

- [ ] **Step 5:提交**

```bash
git add server/routes/netease.ts
git commit -m "feat: 网易云歌单接口补充 description 字段,新增改简介/批量删曲路由"
```

---

### Task 3:`MusicService` 新增网易专属可选方法

**Files:**
- Modify: `src/lib/music-service.ts`
- Modify: `src/lib/netease-music-service.ts`

**Interfaces:**
- Consumes:Task 2 新增的 3 个路由/字段(`/api/playlist/desc/update`、`/api/playlist/remove-songs`、`description` 字段)、既有 `/api/playlist/create`、`/api/playlist/add-song`、`/api/user/playlists`、`/api/playlist/tracks`。
- Produces(供 Task 4 使用,均为 `MusicService` 上的可选方法,仅 `NeteaseMusicService` 实现,`QQMusicService` 不声明):
  - `export interface PlaylistMeta { id: unknown; name: string; description: string }`(轻量类型,只声明漫游功能实际用到的字段——`/api/user/playlists`/`/api/playlist/tracks` 现有映射本来就不是完整的领域层 `Playlist` 形状,不额外声称拿到了 `Playlist` 的全部字段)
  - `findUserPlaylistsByName?(name: string): Promise<PlaylistMeta[]>`
  - `getPlaylistWithDescription?(id: unknown): Promise<{ playlist: PlaylistMeta; tracks: Track[] } | null>`
  - `createPlaylist?(name: string, opts: { private: boolean }): Promise<{ id: unknown }>`
  - `replacePlaylistTracks?(playlistId: unknown, currentTrackIds: unknown[], newTrackIds: unknown[]): Promise<boolean>`
  - `updatePlaylistDescription?(playlistId: unknown, description: string): Promise<boolean>`

- [ ] **Step 1:接口新增声明**

修改 `src/lib/music-service.ts`。文件里现有这两行(不要改动):

```ts
  /** "我喜欢的音乐"歌单（可选;null = 未登录或不可用）。 */
  getLikedPlaylist?(): Promise<Playlist | null>
```

在这两行**之后**追加(往 `MusicService` interface 里插入 5 个新的可选方法声明):

```ts
  /** 按名字列出账号歌单候选项（可选;仅网易实现,漫游功能用于识别归属;含 description 供调用方按业务规则筛选,如水印校验）。 */
  findUserPlaylistsByName?(name: string): Promise<PlaylistMeta[]>
  /** 按 id 取歌单当前 meta(含 description)+ 全部曲目（可选;仅网易实现）。找不到返回 null。 */
  getPlaylistWithDescription?(id: unknown): Promise<{ playlist: PlaylistMeta; tracks: Track[] } | null>
  /** 建歌单,返回新歌单 id（可选;仅网易实现）。 */
  createPlaylist?(name: string, opts: { private: boolean }): Promise<{ id: unknown }>
  /** 清空歌单当前曲目并替换为新的一批（可选;仅网易实现）。 */
  replacePlaylistTracks?(playlistId: unknown, currentTrackIds: unknown[], newTrackIds: unknown[]): Promise<boolean>
  /** 覆盖歌单简介（可选;仅网易实现）。 */
  updatePlaylistDescription?(playlistId: unknown, description: string): Promise<boolean>
```

在文件末尾 `PlaylistSkeleton` interface(文件最后几行)之后追加新类型:

```ts
/** 漫游功能用的轻量歌单 meta——只包含实际会用到的字段,不是完整的 Playlist。 */
export interface PlaylistMeta {
  id: unknown
  name: string
  description: string
}
```

（只新增上面这几处声明,文件其余内容不动;注意 `getLikedPlaylist?` 那行的原注释保持不变,只在其后追加。）

- [ ] **Step 2:网易实现**

修改 `src/lib/netease-music-service.ts`。先把顶部 import 从 `import type { MusicService, RadarPlaylist, PlaylistSkeleton } from './music-service'` 改为 `import type { MusicService, RadarPlaylist, PlaylistSkeleton, PlaylistMeta } from './music-service'`。然后在 `getRadarPlaylist` 方法(文件末尾,`}` 闭合 class 之前)之后追加:

```ts
  async findUserPlaylistsByName(name: string): Promise<PlaylistMeta[]> {
    const res = await api.get<{ playlists?: PlaylistMeta[] }>('/api/user/playlists')
    return (res.playlists ?? []).filter((p) => p.name === name)
  }

  async getPlaylistWithDescription(id: unknown): Promise<{ playlist: PlaylistMeta; tracks: Track[] } | null> {
    const res = await api.get<{ playlist?: PlaylistMeta | null; tracks?: Track[] }>('/api/playlist/tracks', { id: id as string | number })
    if (!res.playlist || !res.playlist.id) return null
    return { playlist: res.playlist, tracks: res.tracks ?? [] }
  }

  async createPlaylist(name: string, opts: { private: boolean }): Promise<{ id: unknown }> {
    const res = await api.post<{ playlist?: { id?: unknown } }>('/api/playlist/create', {
      name,
      privacy: opts.private ? '10' : '0',
    })
    const id = res.playlist?.id
    if (id === undefined || id === null) throw new Error('CREATE_PLAYLIST_FAILED')
    return { id }
  }

  async replacePlaylistTracks(playlistId: unknown, currentTrackIds: unknown[], newTrackIds: unknown[]): Promise<boolean> {
    if (currentTrackIds.length > 0) {
      await api.post('/api/playlist/remove-songs', { pid: playlistId, ids: currentTrackIds.map(String).join(',') })
    }
    if (newTrackIds.length > 0) {
      await api.post('/api/playlist/add-song', { pid: playlistId, ids: newTrackIds.map(String).join(',') })
    }
    return true
  }

  async updatePlaylistDescription(playlistId: unknown, description: string): Promise<boolean> {
    await api.post('/api/playlist/desc/update', { id: playlistId, desc: description })
    return true
  }
```

注意:`api.post`/`api.get` 内部 `fetch` 对非 2xx 响应会 `throw new Error('HTTP ' + status)`(见 `src/lib/api.ts:23-27`),Task 2 里新路由在失败时返回 409/401,因此这几个方法失败时会自然向上抛错,调用方(Task 4 的 `generate()`)按现有的 try/catch 处理即可,这里不需要额外判空/判 code。

- [ ] **Step 3:类型检查**

Run: `npm run typecheck`
Expected: 两套 tsconfig 全量通过。`qq-music-service.ts` 不需要任何改动(可选方法不实现即可,现有类已满足接口)。

- [ ] **Step 4:提交**

```bash
git add src/lib/music-service.ts src/lib/netease-music-service.ts
git commit -m "feat: MusicService 新增网易专属歌单读写方法(漫游功能用)"
```

---

### Task 4:`roam` store 改造(网易分流 + 真实歌单读写,QQ 分支不动)

**Files:**
- Modify: `src/stores/roam.ts`
- Modify: `src/stores/roam.test.ts`(既有测试文件,补充网易分支用例,QQ 相关既有用例不改)

**Interfaces:**
- Consumes:
  - Task 1 的 `buildRoamDescription`/`parseRoamDescription`(`src/lib/roam-description.ts`)
  - Task 3 的 5 个 `MusicService` 可选方法
  - 既有 `pickArtistTracks`/`buildRoamTracks`(`src/lib/roam-selection.ts`,不变)
  - 既有 `serviceFor`(`src/lib/service-registry.ts`)、`useSettingsStore.getState().activeSource`
- Produces(供 Task 5 的 `RoamPage.tsx` 使用):
  - `RoamPlaylist.artists` 类型从 `ArtistInfo[]` 改为 `{ name: string }[]`(结果态只展示数量,不需要完整 `ArtistInfo`;详情见下)。
  - `useRoamStore` 新增状态:`loading: boolean`、`neteasePlaylistId: unknown`、`neteaseHydrated: boolean`。
  - `useRoamStore` 新增方法:`ensureNeteaseHydrated(service: MusicService): Promise<void>`。
  - `generate()`/`reset()` 行为按下方描述调整,方法签名不变。

- [ ] **Step 1:改 `RoamPlaylist.artists` 类型 + 新增状态字段**

读取当前 `src/stores/roam.ts` 全文(Task 2/3 完成后未变,内容见本计划开头贴出的现状),按下面完整替换整个文件:

```ts
import { create } from 'zustand'
import { serviceFor } from '../lib/service-registry'
import { useSettingsStore } from './settings'
import { buildRoamTracks, pickArtistTracks, type RoamMode } from '../lib/roam-selection'
import { buildRoamDescription, parseRoamDescription } from '../lib/roam-description'
import type { MusicService } from '../lib/music-service'
import type { ArtistInfo, MusicSource, Track } from '../types/domain'

/**
 * 「漫游」歌单:
 * - QQ 音乐:纯本地 localStorage 临时歌单,仅当天有效,不回写账号(逻辑不变)。
 * - 网易云:写回账号里一个固定名为「每日漫游」的隐私歌单,本地只缓存歌单 id;
 *   归属靠简介水印(`Simple Music`)识别,是否需要重新生成靠简介里的日期判断。
 */

const STORAGE_KEY = 'simplemusic-roam-playlist'
const NETEASE_PLAYLIST_ID_KEY = 'simplemusic-roam-playlist-id-netease'
const NETEASE_PLAYLIST_NAME = '每日漫游'
export const MAX_ARTISTS = 5

export interface RoamPlaylist {
  date: string
  source: MusicSource
  mode: RoamMode
  artists: { name: string }[]
  tracks: Track[]
}

function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 读取 QQ 本地存档;日期不是今天或音源与当前 activeSource 不符则视为过期,返回 null。 */
function loadValidPlaylist(): RoamPlaylist | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as RoamPlaylist
    if (!data?.tracks || data.date !== todayKey() || data.source !== useSettingsStore.getState().activeSource) {
      return null
    }
    return data
  } catch {
    return null
  }
}

function loadCachedNeteasePlaylistId(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(NETEASE_PLAYLIST_ID_KEY)
}

function saveCachedNeteasePlaylistId(id: unknown): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(NETEASE_PLAYLIST_ID_KEY, String(id))
  } catch {
    /* 超配额放弃落盘,内存态仍可用 */
  }
}

function clearCachedNeteasePlaylistId(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(NETEASE_PLAYLIST_ID_KEY)
}

interface RoamStore {
  playlist: RoamPlaylist | null
  selectedArtists: ArtistInfo[]
  mode: RoamMode
  generating: boolean
  /** 网易云真实歌单异步核实中(打开页面时可能要拉网络)。 */
  loading: boolean
  /** 网易云「每日漫游」歌单的真实 id(不存在时为 null)。仅当次会话内存态,持久化在 NETEASE_PLAYLIST_ID_KEY。 */
  neteasePlaylistId: unknown
  /** 本次挂载/音源会话是否已尝试过网易云真实歌单核实(避免重复请求)。 */
  neteaseHydrated: boolean
  addArtist(artist: ArtistInfo): void
  removeArtist(id: unknown): void
  setMode(mode: RoamMode): void
  generate(): Promise<void>
  reset(): void
  /** 网易云专属:核实账号里是否已有可复用的「每日漫游」真实歌单,核实结果写入 playlist/neteasePlaylistId。QQ(service 未实现相关方法)直接 no-op。 */
  ensureNeteaseHydrated(service: MusicService): Promise<void>
}

export const useRoamStore = create<RoamStore>((set, get) => ({
  playlist: loadValidPlaylist(),
  selectedArtists: [],
  mode: 'hot',
  generating: false,
  loading: false,
  neteasePlaylistId: null,
  neteaseHydrated: false,

  addArtist(artist) {
    const { selectedArtists } = get()
    if (selectedArtists.length >= MAX_ARTISTS) return
    if (selectedArtists.some((a) => String(a.id) === String(artist.id))) return
    set({ selectedArtists: [...selectedArtists, artist] })
  },

  removeArtist(id) {
    set((s) => ({ selectedArtists: s.selectedArtists.filter((a) => String(a.id) !== String(id)) }))
  },

  setMode(mode) {
    set({ mode })
  },

  async ensureNeteaseHydrated(service) {
    if (get().neteaseHydrated) return
    if (!service.createPlaylist) return // QQ:不实现相关方法,no-op
    set({ neteaseHydrated: true, loading: true })
    try {
      let id: unknown = loadCachedNeteasePlaylistId()
      if (!id) {
        const candidates = await service.findUserPlaylistsByName!(NETEASE_PLAYLIST_NAME)
        const match = candidates.find((p) => parseRoamDescription(p.description) !== null)
        if (match) {
          id = match.id
          saveCachedNeteasePlaylistId(id)
        }
      }
      if (!id) {
        set({ loading: false })
        return // 没有可复用的,留在选歌手态,生成时会新建
      }
      const found = await service.getPlaylistWithDescription!(id)
      if (!found) {
        clearCachedNeteasePlaylistId()
        set({ loading: false })
        return // 缓存的 id 查无此歌单(被删了),留在选歌手态
      }
      set({ neteasePlaylistId: id })
      const parsed = parseRoamDescription(found.playlist.description)
      if (parsed && parsed.date === todayKey()) {
        set({
          playlist: {
            date: parsed.date,
            source: 'netease',
            mode: get().mode,
            artists: parsed.artistNames.map((name) => ({ name })),
            tracks: found.tracks,
          },
          loading: false,
        })
      } else {
        set({ loading: false }) // 简介过期/解不出来,留在选歌手态;neteasePlaylistId 已缓存,生成时复用
      }
    } catch {
      set({ loading: false })
    }
  },

  async generate() {
    const { selectedArtists, mode } = get()
    if (selectedArtists.length === 0) return
    set({ generating: true })
    const source = useSettingsStore.getState().activeSource
    const service = serviceFor(source)
    const picks = await Promise.all(
      selectedArtists.map(async (artist) => {
        try {
          const pool = await service.getArtistSongs(artist.id)
          return pickArtistTracks(pool, mode)
        } catch {
          return []
        }
      })
    )
    const tracks = buildRoamTracks(picks)
    const artists = selectedArtists.map((a) => ({ name: a.name }))
    const date = todayKey()

    if (service.createPlaylist) {
      // 网易云:写回真实歌单
      try {
        let id = get().neteasePlaylistId
        let currentTrackIds: unknown[] = []
        if (id) {
          const found = await service.getPlaylistWithDescription!(id)
          if (found) {
            currentTrackIds = found.tracks.map((t) => t.id)
          } else {
            id = null // 缓存的 id 已失效(被删了)
          }
        }
        if (!id) {
          const created = await service.createPlaylist!(NETEASE_PLAYLIST_NAME, { private: true })
          id = created.id
        }
        await service.replacePlaylistTracks!(id, currentTrackIds, tracks.map((t) => t.id))
        await service.updatePlaylistDescription!(
          id,
          buildRoamDescription(date, artists.map((a) => a.name))
        )
        saveCachedNeteasePlaylistId(id)
        set({
          playlist: { date, source, mode, artists, tracks },
          neteasePlaylistId: id,
          generating: false,
          selectedArtists: [],
        })
      } catch {
        set({ generating: false }) // 失败:留在选歌手态,不清 selectedArtists,方便重试
      }
      return
    }

    // QQ / 本地路径,逻辑不变
    const playlist: RoamPlaylist = { date, source, mode, artists, tracks }
    set({ playlist, generating: false, selectedArtists: [] })
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist))
      } catch {
        /* 超配额放弃落盘,内存态仍可用 */
      }
    }
  },

  reset() {
    set({ playlist: null, selectedArtists: [], mode: 'hot', loading: false, neteaseHydrated: false })
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  }
}))
```

**关键点说明(供实现时核对,不是需要额外写的代码):**
- `neteasePlaylistId` 不在 `reset()` 里清空——它是"永不主动过期"的缓存,只有 `ensureNeteaseHydrated`/`generate()` 内部按 id 查无歌单时才会 `clearCachedNeteasePlaylistId()`(注意:`generate()` 里查无歌单时只是把局部变量 `id` 置 `null` 走新建分支,并**没有**调用 `clearCachedNeteasePlaylistId()`——这是有意的,因为紧接着就会 `createPlaylist` 产生新 id 并 `saveCachedNeteasePlaylistId` 覆盖,不需要中间清空这一步)。
- QQ 分支(`service.createPlaylist` 为 `undefined`)完全走文件最下方"QQ / 本地路径"那几行,与改造前逐字一致,不引入任何新变量或新判断。
- `RoamPage.tsx`(Task 5)里已有的"切音源/离页再回来发现 source 不匹配就 `reset()`"那段逻辑(现有代码,本任务不改)在 `reset()` 内新增了 `neteaseHydrated: false`,所以切源之后再切回网易云会重新触发一次 `ensureNeteaseHydrated`——这正是我们想要的(可能中途别的设备改过歌单,或者跨天了)。

- [ ] **Step 2:补充/调整测试**

打开 `src/stores/roam.test.ts`。既有内容(第 1-93 行)**逐字保留,一行不改**——关键前提是既有 `serviceFor` mock 工厂返回的对象没有 `createPlaylist`,所以既有 7 个用例在新版 `generate()` 里依然会走"QQ / 本地路径"分支,行为不受影响。

把现有第 27-29 行:

```ts
vi.mock('../lib/service-registry', () => ({
  serviceFor: () => ({ getArtistSongs })
}))
```

改成(改用一个可变的模块级变量 `currentService`,默认还是原来那个只有 `getArtistSongs` 的本地路径 mock,新增的网易分支用例通过 `beforeEach`/`afterEach` 切换它,不影响既有用例):

```ts
const findUserPlaylistsByName = vi.fn(async (_name: string) => [] as MockNeteasePlaylist[])
const getPlaylistWithDescription = vi.fn(async (_id: unknown) => null as { playlist: MockNeteasePlaylist; tracks: Track[] } | null)
const createPlaylist = vi.fn(async (_name: string, _opts: { private: boolean }) => ({ id: 'new-pid' }))
const replacePlaylistTracks = vi.fn(async (_id: unknown, _cur: unknown[], _next: unknown[]) => true)
const updatePlaylistDescription = vi.fn(async (_id: unknown, _desc: string) => true)

interface MockNeteasePlaylist {
  id: unknown
  name: string
  description: string
}

function mkNeteasePlaylist(overrides: Partial<Pick<MockNeteasePlaylist, 'id' | 'description'>> = {}): MockNeteasePlaylist {
  return {
    id: overrides.id ?? 'pid-1',
    name: '每日漫游',
    description: overrides.description ?? '',
  }
}

const localOnlyService = { getArtistSongs }
const neteaseRealService = {
  getArtistSongs,
  findUserPlaylistsByName,
  getPlaylistWithDescription,
  createPlaylist,
  replacePlaylistTracks,
  updatePlaylistDescription,
}

let currentService: typeof localOnlyService | typeof neteaseRealService = localOnlyService

vi.mock('../lib/service-registry', () => ({
  serviceFor: () => currentService
}))
```

在既有 `describe('roam store', ...)` 块(第 37-93 行)的 `beforeEach` 里追加一行 `currentService = localOnlyService`(防御性:确保这组用例不受其他 describe 块状态影响,不管测试执行顺序):

```ts
  beforeEach(() => {
    currentService = localOnlyService
    useRoamStore.setState({ playlist: null, selectedArtists: [], mode: 'hot', generating: false })
    getArtistSongs.mockClear()
    getArtistSongs.mockImplementation(async (id: unknown) => POOLS[String(id)] ?? [])
  })
```

在文件末尾(既有 `describe` 块的闭合 `})` 之后)追加新的 describe 块:

```ts

describe('roam store — 网易云真实歌单分支', () => {
  beforeEach(() => {
    currentService = neteaseRealService
    useRoamStore.setState({
      playlist: null,
      selectedArtists: [],
      mode: 'hot',
      generating: false,
      loading: false,
      neteasePlaylistId: null,
      neteaseHydrated: false,
    })
    findUserPlaylistsByName.mockClear()
    getPlaylistWithDescription.mockClear()
    createPlaylist.mockClear()
    replacePlaylistTracks.mockClear()
    updatePlaylistDescription.mockClear()
    findUserPlaylistsByName.mockResolvedValue([])
    getPlaylistWithDescription.mockResolvedValue(null)
    createPlaylist.mockResolvedValue({ id: 'new-pid' })
    replacePlaylistTracks.mockResolvedValue(true)
    updatePlaylistDescription.mockResolvedValue(true)
  })

  afterEach(() => {
    currentService = localOnlyService
  })

  it('ensureNeteaseHydrated:无缓存 id、账号里也没有匹配歌单 → 留在选歌手态', async () => {
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(useRoamStore.getState().playlist).toBeNull()
    expect(useRoamStore.getState().neteasePlaylistId).toBeNull()
    expect(useRoamStore.getState().loading).toBe(false)
  })

  it('ensureNeteaseHydrated:账号里有同名但无水印的歌单 → 不采用,留在选歌手态', async () => {
    findUserPlaylistsByName.mockResolvedValue([mkNeteasePlaylist({ description: '我自己写的简介' })])
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(useRoamStore.getState().playlist).toBeNull()
    expect(useRoamStore.getState().neteasePlaylistId).toBeNull()
  })

  it('ensureNeteaseHydrated:命中带水印且日期为今天的歌单 → 直接进入结果态', async () => {
    // 按本地时区取日期(与 roam.ts 内 todayKey() 的算法一致),不用 toISOString()(那是 UTC,
    // 在 UTC- 时区的深夜/UTC+ 时区的凌晨跑测试会跟本地日期差一天,导致这个用例偶发失败)。
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const pl = mkNeteasePlaylist({ id: 'pid-9', description: `Simple Music · ${todayStr} · 周杰伦/邓紫棋` })
    findUserPlaylistsByName.mockResolvedValue([pl])
    getPlaylistWithDescription.mockResolvedValue({ playlist: pl, tracks: [mkTrack(1, 0)] })
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    const { playlist, neteasePlaylistId } = useRoamStore.getState()
    expect(neteasePlaylistId).toBe('pid-9')
    expect(playlist).not.toBeNull()
    expect(playlist!.artists).toEqual([{ name: '周杰伦' }, { name: '邓紫棋' }])
    expect(playlist!.tracks).toHaveLength(1)
  })

  it('ensureNeteaseHydrated:命中歌单但简介日期不是今天 → 留在选歌手态,但缓存 id 供生成时复用', async () => {
    const pl = mkNeteasePlaylist({ id: 'pid-9', description: 'Simple Music · 2000-01-01 · 周杰伦' })
    findUserPlaylistsByName.mockResolvedValue([pl])
    getPlaylistWithDescription.mockResolvedValue({ playlist: pl, tracks: [] })
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(useRoamStore.getState().playlist).toBeNull()
    expect(useRoamStore.getState().neteasePlaylistId).toBe('pid-9')
  })

  it('ensureNeteaseHydrated:重复调用只请求一次(neteaseHydrated 守卫)', async () => {
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    await useRoamStore.getState().ensureNeteaseHydrated(neteaseRealService as unknown as MusicService)
    expect(findUserPlaylistsByName).toHaveBeenCalledTimes(1)
  })

  it('generate:无可复用歌单 → 新建 + 加曲目 + 写简介', async () => {
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot', neteasePlaylistId: null })
    await useRoamStore.getState().generate()
    expect(createPlaylist).toHaveBeenCalledWith('每日漫游', { private: true })
    expect(replacePlaylistTracks).toHaveBeenCalledWith('new-pid', [], expect.any(Array))
    expect(updatePlaylistDescription).toHaveBeenCalledWith('new-pid', expect.stringContaining('Simple Music'))
    const { playlist, neteasePlaylistId, selectedArtists } = useRoamStore.getState()
    expect(neteasePlaylistId).toBe('new-pid')
    expect(playlist!.tracks).toHaveLength(10)
    expect(selectedArtists).toEqual([])
  })

  it('generate:已有可复用歌单(neteasePlaylistId 命中)→ 不新建,清空旧曲目再加新的', async () => {
    getPlaylistWithDescription.mockResolvedValueOnce({
      playlist: mkNeteasePlaylist({ id: 'pid-1' }),
      tracks: [mkTrack(9, 0), mkTrack(9, 1)],
    })
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot', neteasePlaylistId: 'pid-1' })
    await useRoamStore.getState().generate()
    expect(createPlaylist).not.toHaveBeenCalled()
    expect(replacePlaylistTracks).toHaveBeenCalledWith('pid-1', ['9-0', '9-1'], expect.any(Array))
  })

  it('generate:缓存的 neteasePlaylistId 已失效(查无歌单)→ 走新建', async () => {
    getPlaylistWithDescription.mockResolvedValueOnce(null)
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot', neteasePlaylistId: 'stale-pid' })
    await useRoamStore.getState().generate()
    expect(createPlaylist).toHaveBeenCalled()
  })

  it('generate:任一步抛错 → generating 回 false,selectedArtists 不清空', async () => {
    replacePlaylistTracks.mockRejectedValueOnce(new Error('boom'))
    useRoamStore.setState({ selectedArtists: [mkArtist(1)], mode: 'hot', neteasePlaylistId: null })
    await useRoamStore.getState().generate()
    expect(useRoamStore.getState().generating).toBe(false)
    expect(useRoamStore.getState().selectedArtists).toHaveLength(1)
    expect(useRoamStore.getState().playlist).toBeNull()
  })
})
```

别忘了把文件顶部的 import 从 `import { describe, it, expect, vi, beforeEach } from 'vitest'` 改成 `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'`(新增用到 `afterEach`),并新增 `import type { MusicService } from '../lib/music-service'`。

网易分支覆盖:
- `ensureNeteaseHydrated`:无缓存无命中、命中但无水印、命中且日期为今天(进结果态)、命中但日期过期(留选歌手态但缓存 id)、重复调用去重(守卫生效)。
- `generate()`:无可复用歌单新建、已有可复用歌单复用(清旧曲目再加新)、缓存 id 失效兜底新建、任一步抛错时的失败态。

- [ ] **Step 3:运行测试确认通过**

Run: `npx vitest run src/stores/roam.test.ts`
Expected: PASS,既有 7 个 QQ 用例 + 新增网易用例全部通过。

- [ ] **Step 4:全量类型检查 + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 两者均干净通过。

- [ ] **Step 5:提交**

```bash
git add src/stores/roam.ts src/stores/roam.test.ts
git commit -m "feat: roam store 网易云分支改为读写真实歌单,QQ 分支不变"
```

---

### Task 5:`RoamPage.tsx` 未登录禁用态 + 加载态 + 挂载时核实真实歌单

**Files:**
- Modify: `src/pages/RoamPage.tsx`(新增的禁用态/加载态复用已有的 `styles.page`/`styles.inner`/`styles.title`/`styles.subtitle` 类,`src/pages/RoamPage.module.css` 不需要改动)

**Interfaces:**
- Consumes:Task 4 的 `useRoamStore` 新增字段/方法(`loading`、`ensureNeteaseHydrated`)、既有 `useSettingsStore` 的 `neteaseLoggedIn`、`activeSource`。
- Produces:无(叶子页面组件,无下游消费方)。

- [ ] **Step 1:新增未登录禁用态 + 加载态 + 挂载核实**

修改 `src/pages/RoamPage.tsx`:

在顶部 selector 区(第 16-26 行附近)追加一行:

```ts
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const loading = useRoamStore((s) => s.loading)
```

在现有的 `useEffect(() => { ... }, [activeSource])`(第 38-46 行,处理跨音源清空的那个 effect)**之后**新增一个 effect:

```ts
  // 网易云:挂载/切回网易云时核实账号里是否已有可复用的「每日漫游」真实歌单
  useEffect(() => {
    if (activeSource !== 'netease' || !neteaseLoggedIn) return
    void useRoamStore.getState().ensureNeteaseHydrated(service)
  }, [activeSource, neteaseLoggedIn, service])
```

在组件渲染逻辑最前面(`const searchSeq = useRef(0)` 之后、`if (playlist) {` 之前的任意位置,建议紧接在 `playAt` 函数定义之后、`if (playlist)` 之前)插入未登录禁用态的提前返回:

```ts
  if (activeSource === 'netease' && !neteaseLoggedIn) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}><GradientText>漫游</GradientText></h1>
          <p className={styles.subtitle}>登录网易云账号后才能使用「漫游」</p>
        </div>
      </div>
    )
  }

  if (activeSource === 'netease' && loading && !playlist) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <h1 className={styles.title}><GradientText>漫游</GradientText></h1>
          <p className={styles.subtitle}>正在核实账号里的漫游歌单…</p>
        </div>
      </div>
    )
  }
```

（QQ 分支:`activeSource !== 'netease'` 时上面两个提前返回都不触发,渲染逻辑与改造前完全一致。）

- [ ] **Step 2:类型检查**

Run: `npm run typecheck`
Expected: 干净通过。

- [ ] **Step 3:全量测试**

Run: `npm test`
Expected: 全部通过(本任务不新增自动化测试,页面组件按项目既有约定无测试文件)。

- [ ] **Step 4:提交**

```bash
git add src/pages/RoamPage.tsx
git commit -m "feat: 漫游页新增网易云未登录禁用态与真实歌单核实加载态"
```

- [ ] **Step 5:Electron 真实账号手动验证**

Run: `npm run dev`,用真实已登录网易云账号:
1. 切到网易云音源,进入「漫游」,首次应显示"正在核实…"后落到选歌手态(账号里还没有「每日漫游」)。
2. 选 2-3 位歌手生成 → 结果态展示曲目;用网易云官方 App/网页版确认账号里出现了一个名为「每日漫游」的**隐私**歌单,简介形如 `Simple Music · 今天日期 · 歌手名单`,曲目一致。
3. 退出应用重新打开,再次进入「漫游」应直接展示同一份结果(核实到简介日期是今天)。
4. 点"重新选择"→ 换一批歌手再次生成 → 官方 App 里确认**同一个歌单 id**(不是新建了一个)的曲目已被替换、简介日期/歌手名单已更新。
5. 手动把网易云里这个「每日漫游」歌单删除,回到应用「漫游」页(需要重新触发核实,如切换音源再切回或重启应用)→ 应回到选歌手态并在下次生成时新建一个。
6. QQ 音源下的「漫游」行为应与本次改造前完全一致(纯本地,不受影响)——抽查一次生成流程确认无回归。

## 计划自查记录

- **spec 覆盖**:识别与生成流程(Task 4 的 `ensureNeteaseHydrated`/`generate`)、简介格式构造解析(Task 1)、Server 改动(Task 2:description 字段 + 两个新路由)、`MusicService` 可选方法(Task 3)、未登录禁用态(Task 5)、QQ 分支不变(Task 4/5 均显式保留 QQ 路径逐字不动)、明确不做的几项(未在任何任务中引入)——spec 各章节均有对应任务落地。
- **占位符扫描**:初稿里 Task 4 Step 2 曾留过一段"故意留空占位"的测试用例,自查时已发现并替换成完整可运行代码(含 `currentService` 可切换 mock 的具体实现);Task 2 初稿曾让 `/api/playlist/tracks` 的 `playlist` 冒充完整 `Playlist` 形状,自查时改为按实际返回字段声明的轻量 `PlaylistMeta` 类型;`ensureNeteaseHydrated` 测试用例里"今天日期"初稿用了 `toISOString()`(UTC,与 `todayKey()` 的本地时区算法不一致,在时区边界会偶发失败),已改为按本地时区分量计算。全文现无 TBD/占位。
- **类型一致性**:`RoamPlaylist.artists` 类型变更(`ArtistInfo[]` → `{name:string}[]`)在 Task 4 中一次性改完(类型定义 + `generate()`/`ensureNeteaseHydrated()` 两处构造点),`RoamPage.tsx`(Task 5)对 `playlist.artists` 只用 `.length`,不受类型变更影响,已核对无需改动。`MusicService` 5 个新方法名/签名(含新增的 `PlaylistMeta` 类型)在 Task 3(声明+实现)与 Task 4(调用方)之间逐一核对一致。
