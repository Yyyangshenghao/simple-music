# QQ 探索页数据源补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 QQ 音源的探索页补齐"推荐歌单(真分页)"、"猜你喜欢"、"私人雷达"三块内容,结构对齐网易云音源。

**Architecture:** Server 端在 `server/lib/qq-client.ts` 新增三个 handler(`handleQQRadarSong`/`handleQQRecommendFeed`/`handleQQRecommendSongs`),`server/routes/qq-music.ts` 挂三条新路由;Client 端 `src/lib/qq-music-service.ts` 把 `getRecommendPlaylists` 改指向新路由、新增 `getDailySongs`/`getRadarPlaylist`;`src/pages/ExplorePage.tsx` 让每日推荐卡片按曲目 `source` 分支文案与跳转逻辑。

**Tech Stack:** TypeScript,Node 内嵌 HTTP server(`server/`),React + zustand(`src/`),vitest,electron-vite。

## Global Constraints

- `Track.duration` 全项目约定为毫秒(QQ 侧 `interval × 1000`),新代码沿用 `mapQQPlaylistTrack` 已有换算,不要另写。
- `Track`/`Playlist` 的 `id`/`source` 字段是本项目"跨音源路由"的关键依据(`serviceFor(数据.source)`),任何新建的 `Playlist`/`Track` 对象必须带正确的 `source`/`provider`,不能写死某个音源。
- 三个新接口(`GetRadarSong`/`GetRecommendFeed`/`get_radio_track`)都是逆向、无官方文档的 QQ 音乐接口,字段名不确定,本地无法用真实 QQ 登录态联调。所有解析代码必须走"多候选字段名 + 取第一个非空数组"的宽松写法(与 `qq-client.ts` 现有 `mapQQPlaylist`/`mapQQTrack` 风格一致),不允许假设字段名 100% 正确。
- 本仓库对 `server/lib/*-client.ts` 里依赖真实上游网络的 handler 从未写过带 mock 的单元测试(`npm test` 现有 12 个测试文件均不覆盖这类 handler)。因此本计划里每个 server 任务的"测试"步骤是 `npm run typecheck`(类型正确)+ 人工在真实 QQ 登录态下用运行中的 app 验证(见 Task 6),不额外造一套 mock 基础设施,遵循现状(YAGNI)。
- 不动 `docs/qq-music-api.md` 第 2 节列的其它未接入接口、不动"我的库"歌架(`ShelfScene`)的网易硬编码问题——两者都在 spec 的"非目标"里,明确排除。
- 参考 spec:`docs/superpowers/specs/2026-07-10-qq-explore-page-design.md`。

---

### Task 1: 私人雷达接口(server)

**Files:**
- Modify: `server/lib/qq-client.ts`(在 `handleQQUserPlaylists`/`handleQQPlaylistTracks` 之间插入新函数,约第 808~810 行之间)
- Modify: `server/routes/qq-music.ts`(import 新增 `handleQQRadarSong`;在 `/api/qq/user/playlists` 路由块之后、`/api/qq/playlist/tracks` 之前插入新路由)

**Interfaces:**
- Consumes:文件内已有的 `getQQLoginInfo(cookie: string): Promise<QQLoginInfo>`、`qqMusicRequest(cookie, payload): Promise<unknown>`、`mapQQPlaylistTrack(raw: unknown): Record<string, unknown>`、`rec`/`arr`/`str`(文件顶部本地工具函数,同文件内直接可用,无需 import)。
- Produces:`export async function handleQQRadarSong(cookie: string): Promise<Record<string, unknown>>`,返回形状 `{ provider: 'qq', playlist: Record<string, unknown> | null, tracks: Record<string, unknown>[] }`。Task 4 的 client 层依赖这个函数名和返回形状(`playlist`/`tracks` 字段名)。

- [ ] **Step 1: 在 `qq-client.ts` 插入 `handleQQRadarSong`**

在 `handleQQUserPlaylists` 函数结束的 `}`(第 808 行,紧接 `return { loggedIn: true, provider: 'qq', userId: uin, playlists }`)之后、`export async function handleQQPlaylistTracks` 之前插入:

```ts
export async function handleQQRadarSong(cookie: string): Promise<Record<string, unknown>> {
  const info = await getQQLoginInfo(cookie)
  if (!info.loggedIn) return { provider: 'qq', playlist: null, tracks: [] }
  const json = rec(
    await qqMusicRequest(cookie, {
      comm: { ct: 24, cv: 0 },
      radar: {
        module: 'music.recommend.TrackRelationServer',
        method: 'GetRadarSong',
        param: { Page: 1 },
      },
    })
  )
  const block = rec(json.radar)
  const data = rec(block.data)
  const rawList =
    [data.songList, data.vec_song, data.tracks, data.List, data.data].map(arr).find((list) => list.length) || []
  const tracks = rawList.map(mapQQPlaylistTrack).filter((s) => s.name && (s.mid || s.id))
  if (tracks.length === 0) return { provider: 'qq', playlist: null, tracks: [] }
  const playlist = {
    provider: 'qq',
    source: 'qq',
    type: 'playlist',
    id: 'qq-radar',
    name: '私人雷达',
    cover: str(tracks[0].cover),
    trackCount: tracks.length,
    playCount: 0,
    creator: 'QQ 音乐',
  }
  return { provider: 'qq', playlist, tracks }
}
```

- [ ] **Step 2: 在 `qq-music.ts` 接线路由**

在 `import { ... } from '../lib/qq-client'` 的花括号里加入 `handleQQRadarSong`(放在 `handleQQUserPlaylists,` 之后一行):

```ts
  handleQQUserPlaylists,
  handleQQRadarSong,
```

在 `/api/qq/user/playlists` 路由块的 `return true }`(第 165 行)之后、`/api/qq/playlist/tracks` 路由块(第 167 行)之前插入:

```ts
  if (pn === '/api/qq/radar') {
    try {
      const data = await handleQQRadarSong(getCookie(ctx, 'qq'))
      sendJson(res, data)
    } catch (err) {
      console.error('[QQRadar]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, playlist: null, tracks: [] }, 500)
    }
    return true
  }

```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 两套 tsconfig 均无报错退出。

- [ ] **Step 4: Commit**

```bash
git add server/lib/qq-client.ts server/routes/qq-music.ts
git commit -m "feat: QQ 私人雷达接口(GetRadarSong)"
```

---

### Task 2: 推荐歌单接口(server)

**Files:**
- Modify: `server/lib/qq-client.ts`(紧接 Task 1 新增的 `handleQQRadarSong` 之后插入)
- Modify: `server/routes/qq-music.ts`(紧接 Task 1 新增的 `/api/qq/radar` 路由块之后插入)

**Interfaces:**
- Consumes:同 Task 1 的本地工具函数;另需 `mapQQPlaylist(raw: unknown, kind: string): QQPlaylist`(文件内已有,第 500 行)。
- Produces:`export async function handleQQRecommendFeed(cookie: string, page: number): Promise<Record<string, unknown>>`,返回 `{ provider: 'qq', playlists: QQPlaylist[] }`。Task 4 依赖此函数名与 `playlists` 字段名。

- [ ] **Step 1: 在 `qq-client.ts` 插入 `handleQQRecommendFeed`**

紧接 Task 1 的 `handleQQRadarSong` 函数体之后插入:

```ts
export async function handleQQRecommendFeed(cookie: string, page: number): Promise<Record<string, unknown>> {
  const from = Math.max(0, page) * 20
  const json = rec(
    await qqMusicRequest(cookie, {
      comm: { ct: 24, cv: 0 },
      feed: {
        module: 'music.playlist.PlaylistSquare',
        method: 'GetRecommendFeed',
        param: { From: from, Size: 20 },
      },
    })
  )
  const block = rec(json.feed)
  const data = rec(block.data)
  const rawList =
    [data.content, data.List, data.v_playlist, data.playlist, data.disslist].map(arr).find((list) => list.length) ||
    []
  const playlists = rawList
    .map((item) => {
      const r = rec(item)
      return mapQQPlaylist(r.playlist || r.diss_info || r.content || r, 'discover')
    })
    .filter((pl) => pl.id && pl.name)
  return { provider: 'qq', playlists }
}
```

- [ ] **Step 2: 在 `qq-music.ts` 接线路由**

import 里 `handleQQRadarSong,` 之后加:

```ts
  handleQQRecommendFeed,
```

紧接 Task 1 的 `/api/qq/radar` 路由块之后插入:

```ts
  if (pn === '/api/qq/recommend/playlists') {
    try {
      const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0)
      const data = await handleQQRecommendFeed(getCookie(ctx, 'qq'), page)
      sendJson(res, data)
    } catch (err) {
      console.error('[QQRecommendFeed]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, playlists: [] }, 500)
    }
    return true
  }

```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add server/lib/qq-client.ts server/routes/qq-music.ts
git commit -m "feat: QQ 推荐歌单接口(GetRecommendFeed,真分页)"
```

---

### Task 3: 猜你喜欢接口(server)

**Files:**
- Modify: `server/lib/qq-client.ts`(紧接 Task 2 新增的 `handleQQRecommendFeed` 之后插入)
- Modify: `server/routes/qq-music.ts`(紧接 Task 2 新增的 `/api/qq/recommend/playlists` 路由块之后插入)

**Interfaces:**
- Consumes:同 Task 1 的本地工具函数与 `getQQLoginInfo`。
- Produces:`export async function handleQQRecommendSongs(cookie: string): Promise<Record<string, unknown>>`,返回 `{ provider: 'qq', songs: Record<string, unknown>[] }`。Task 4 依赖此函数名与 `songs` 字段名。

- [ ] **Step 1: 在 `qq-client.ts` 插入 `handleQQRecommendSongs`**

紧接 Task 2 的 `handleQQRecommendFeed` 函数体之后插入:

```ts
export async function handleQQRecommendSongs(cookie: string): Promise<Record<string, unknown>> {
  const info = await getQQLoginInfo(cookie)
  if (!info.loggedIn) return { provider: 'qq', songs: [] }
  const seen = new Set<string>()
  const songs: Record<string, unknown>[] = []
  for (let i = 0; i < 4 && songs.length < 20; i++) {
    let json: Record<string, unknown>
    try {
      json = rec(
        await qqMusicRequest(cookie, {
          comm: { ct: 24, cv: 0 },
          radio: {
            module: 'music.radioProxy.MbTrackRadioSvr',
            method: 'get_radio_track',
            param: {},
          },
        })
      )
    } catch (e) {
      console.warn('[QQRecommendSongs] batch failed:', (e as Error).message)
      break
    }
    const block = rec(json.radio)
    const data = rec(block.data)
    const rawList =
      [data.track, data.songList, data.vec_song, data.tracks].map(arr).find((list) => list.length) || []
    if (rawList.length === 0) break
    for (const raw of rawList) {
      const song = mapQQPlaylistTrack(raw)
      const key = str(song.mid) || str(song.id)
      if (!key || seen.has(key) || !song.name) continue
      seen.add(key)
      songs.push(song)
      if (songs.length >= 20) break
    }
  }
  return { provider: 'qq', songs }
}
```

- [ ] **Step 2: 在 `qq-music.ts` 接线路由**

import 里 `handleQQRecommendFeed,` 之后加:

```ts
  handleQQRecommendSongs,
```

紧接 Task 2 的 `/api/qq/recommend/playlists` 路由块之后插入:

```ts
  if (pn === '/api/qq/recommend/songs') {
    try {
      const data = await handleQQRecommendSongs(getCookie(ctx, 'qq'))
      sendJson(res, data)
    } catch (err) {
      console.error('[QQRecommendSongs]', err)
      sendJson(res, { provider: 'qq', error: (err as Error).message, songs: [] }, 500)
    }
    return true
  }

```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add server/lib/qq-client.ts server/routes/qq-music.ts
git commit -m "feat: QQ 猜你喜欢接口(get_radio_track,多次聚合去重)"
```

---

### Task 4: Client 层接入

**Files:**
- Modify: `src/lib/qq-music-service.ts`
- Modify: `src/lib/music-service.ts:18-21`(接口注释措辞)

**Interfaces:**
- Consumes:Task 1~3 产出的三个路由 `GET /api/qq/radar`、`GET /api/qq/recommend/playlists?page=`、`GET /api/qq/recommend/songs`,以及各自返回形状(`{playlist,tracks}` / `{playlists}` / `{songs}`)。
- Produces:`QQMusicService.getRecommendPlaylists(page?): Promise<Playlist[]>`(签名不变,数据源改变)、新增 `getDailySongs(): Promise<Track[]>`、新增 `getRadarPlaylist(): Promise<RadarPlaylist | null>`。Task 5 的 `ExplorePage.tsx` 依赖这两个新方法已存在于 `MusicService` 可选接口且被 QQ 实现(`service.getDailySongs?.()`/`service.getRadarPlaylist?.()` 调用点已存在,无需改 `ExplorePage.tsx` 的调用代码本身)。

- [ ] **Step 1: 替换 `getRecommendPlaylists` 实现**

编辑 `src/lib/qq-music-service.ts`,把:

```ts
export class QQMusicService implements MusicService {
  /** QQ 无公开歌单广场 cgi，改用已登录用户的创建+收藏歌单填充探索页 Stack；未登录返回空数组（原样隐藏）。 */
  async getRecommendPlaylists(): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/qq/user/playlists')
    return res.playlists ?? []
  }
```

替换为:

```ts
export class QQMusicService implements MusicService {
  async getRecommendPlaylists(page = 0): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/qq/recommend/playlists', { page })
    return res.playlists ?? []
  }
```

- [ ] **Step 2: 新增 `getDailySongs`/`getRadarPlaylist`,导入 `RadarPlaylist` 类型**

把文件顶部的:

```ts
import { api } from './api'
import type { MusicService, PlaylistSkeleton } from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'
```

改为:

```ts
import { api } from './api'
import type { MusicService, PlaylistSkeleton, RadarPlaylist } from './music-service'
import type { Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'
```

在文件末尾 `getLyrics` 方法(`async getLyrics(track: Track): Promise<LyricLine[]> { ... }`)之后、类结束的 `}` 之前追加:

```ts

  async getDailySongs(): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/recommend/songs')
    return res.songs ?? []
  }

  async getRadarPlaylist(): Promise<RadarPlaylist | null> {
    const res = await api.get<{ playlist: Playlist | null; tracks: Track[] }>('/api/qq/radar')
    if (!res.playlist || !res.tracks?.length) return null
    return { playlist: res.playlist, tracks: res.tracks }
  }
```

- [ ] **Step 3: 更新 `music-service.ts` 接口注释**

在 `src/lib/music-service.ts`,把:

```ts
  /** 每日歌曲推荐（网易专属；未实现的音源不渲染每日推荐卡）。 */
  getDailySongs?(): Promise<Track[]>
  /** 私人雷达歌单（网易专属；null = 不可用，隐藏卡片）。 */
  getRadarPlaylist?(): Promise<RadarPlaylist | null>
```

改为:

```ts
  /** 每日/猜你喜欢曲目推荐（可选；未实现的音源不渲染该卡片）。 */
  getDailySongs?(): Promise<Track[]>
  /** 私人雷达歌单（可选；null = 不可用，隐藏卡片）。 */
  getRadarPlaylist?(): Promise<RadarPlaylist | null>
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: 无报错(`QQMusicService` 结构性满足 `MusicService` 的可选方法签名)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/qq-music-service.ts src/lib/music-service.ts
git commit -m "feat: QQMusicService 接入推荐歌单/猜你喜欢/私人雷达三个新接口"
```

---

### Task 5: ExplorePage 每日推荐卡片按音源分支

**Files:**
- Modify: `src/pages/ExplorePage.tsx:95-109`(`openDaily` 函数)、`:130-139`(每日推荐 `HeroCard`)

**Interfaces:**
- Consumes:`Track.source: MusicSource`(`src/types/domain.ts` 已有字段,QQ 曲目的 `source` 恒为 `'qq'`,见 `mapQQPlaylistTrack`/`mapQQTrack` 的 `source: 'qq'`)。
- Produces:无新导出,纯组件内部行为改动。

**背景(为什么要动 `openDaily`)**:现有 `openDaily` 把点击卡片后打开的临时歌单写死 `provider: 'netease', source: 'netease', id: 'netease-daily-songs'`。项目约定"跨音源数据取 service 用 `serviceFor(数据.source)`"(见 `CLAUDE.md`),如果 QQ 的猜你喜欢曲目被塞进一个标着 `source: 'netease'` 的假歌单,后续任何按 `playlist.source` 选 service 的逻辑(比如歌单内再次刷新曲目、红心状态查询)都会被错误路由到网易云 service。这个卡片现在要同时服务两个音源,必须按实际曲目来源生成 `source`。

- [ ] **Step 1: 让 `openDaily` 按曲目来源生成歌单**

把:

```tsx
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
```

替换为:

```tsx
  function openDaily() {
    if (dailySongs.length === 0) return
    const src = dailySongs[0].source
    const pl: Playlist = {
      provider: src,
      source: src,
      type: 'playlist',
      id: `${src}-daily-songs`,
      name: src === 'qq' ? '猜你喜欢' : '每日推荐',
      cover: dailySongs[0]?.cover ?? '',
      trackCount: dailySongs.length,
      playCount: 0,
      creator: '',
    }
    useNavigationStore.getState().navigateTo({ type: 'playlist', from: 'explore', playlist: pl, tracks: dailySongs })
  }
```

- [ ] **Step 2: 每日推荐 `HeroCard` 按来源分支标题/副标题/徽标/layoutId**

把:

```tsx
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
```

替换为:

```tsx
            {dailySongs.length > 0 && (
              <HeroCard
                title={dailySongs[0].source === 'qq' ? '猜你喜欢' : '每日推荐'}
                subtitle={
                  dailySongs[0].source === 'qq'
                    ? `${dailySongs.length} 首 · 根据你的口味`
                    : `${dailySongs.length} 首 · 每天更新`
                }
                cover={dailySongs[0]?.cover}
                badge={dailySongs[0].source === 'qq' ? undefined : <span>{new Date().getDate()}</span>}
                layoutId={`explore-cover-${dailySongs[0].source}-daily-songs`}
                onClick={openDaily}
              />
            )}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add src/pages/ExplorePage.tsx
git commit -m "fix: 每日推荐卡片按曲目来源分支文案与 source,避免 QQ 数据挂网易 source"
```

---

### Task 6: 文档同步 + 全量验证

**Files:**
- Modify: `docs/qq-music-api.md`

**Interfaces:**
- Consumes:无(纯文档)。
- Produces:无。

- [ ] **Step 1: 追加已用路由到第 1 节表格**

在 `docs/qq-music-api.md` 第 1 节表格的 `GET /api/qq/user/playlists` 行之后插入三行(表格其余行不动):

```markdown
| `GET /api/qq/radar` | 私人雷达 | — | `music.recommend.TrackRelationServer/GetRadarSong` | `{ playlist, tracks }`;未登录或空结果返回 `playlist:null` | 已用 |
| `GET /api/qq/recommend/playlists` | 推荐歌单(真分页) | `page`(0 起) | `music.playlist.PlaylistSquare/GetRecommendFeed` | `{ playlists }`;`page` 映射 `From=page*20,Size=20` | 已用 |
| `GET /api/qq/recommend/songs` | 猜你喜欢 | — | `music.radioProxy.MbTrackRadioSvr/get_radio_track` | `{ songs }`;服务端循环最多 4 次按 mid 去重凑够 20 首 | 已用 |
```

- [ ] **Step 2: 更新第 3 节接入建议状态**

把第 3 节末尾的:

```markdown
**建议接入顺序**:雷达推荐(`GetRadarSong`,直接对标网易雷达且无需 hack)→ 推荐歌单(`GetRecommendFeed`,填补 QQ 音源探索页"无公开歌单广场"的空白,当前 `getRecommendPlaylists` 靠用户自有歌单顶替)→ 猜你喜欢(`get_radio_track`,作为"每日推荐"近似替代)。
```

改为:

```markdown
**接入状态**:雷达推荐(`GetRadarSong`)、推荐歌单(`GetRecommendFeed`)、猜你喜欢(`get_radio_track`)已于 2026-07-10 接入,见第 1 节路由表与 `docs/superpowers/specs/2026-07-10-qq-explore-page-design.md`。
```

- [ ] **Step 3: 全量验证**

Run: `npm run typecheck && npm test`
Expected: typecheck 两套 tsconfig 均通过;`npm test` 全部通过(不应少于改动前的 79 个测试)。

- [ ] **Step 4: Commit**

```bash
git add docs/qq-music-api.md
git commit -m "docs: 同步 QQ 探索页三个新接口到 qq-music-api.md"
```

- [ ] **Step 5: 人工验证清单(需要真实 QQ 登录态,在运行中的 app 里执行)**

```
npm run dev
```

然后:
1. 设置里切到 QQ 音源并登录(手动粘贴 cookie)。
2. 打开探索页,确认顶部出现"猜你喜欢"卡(无日期徽标)和"私人雷达"卡。
3. Stack 池子展示的是官方推荐歌单卡片(不是用户自己创建/收藏的歌单名字),往下滑到底触发翻页,确认能刷出新内容而不是一直重复同一批。
4. 点开"猜你喜欢"卡,确认进入的临时歌单标题是"猜你喜欢"、曲目可正常播放。
5. 点开"私人雷达"卡,确认曲目可正常播放。
6. 退出 QQ 登录,回到探索页,确认"猜你喜欢"/"私人雷达"卡片消失、不报错、不白屏(Stack 池子因 `GetRecommendFeed` 不依赖登录应仍有内容)。
7. 若某一步卡片空白但网络面板看到接口有响应,把该接口的实际响应 JSON 贴出来,回到 Task 1/2/3 对应的字段候选列表里补充正确字段名。
