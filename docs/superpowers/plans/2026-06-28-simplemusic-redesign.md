# SimpleMusic UI 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Mineradio 重品牌为 SimpleMusic，重建导航结构（顶部标签 + 探索/我的库/设置页面 + 歌手页），引入 CSS token 系统（浅色/深色双模式），并抽象 MusicService 统一接口。

**Architecture:** 使用 Zustand `navigationStore` 管理页面视图（替代 React Router），每个页面是独立的 `src/pages/` 组件；MusicService 接口在 `src/lib/` 层实现，`useMusicService()` hook 根据 `activeSource` 设置返回对应实例；CSS Custom Properties 作为全局 token，由 `src/styles/tokens.css` 集中定义。

**Tech Stack:** React 18, TypeScript, Zustand, CSS Modules + CSS Custom Properties, GSAP 3（已引入），Electron + electron-vite

## Global Constraints

- App 名称: `SimpleMusic`，`package.json` `productName: "SimpleMusic"`，`version: "1.0.0"`
- CSS token 命名前缀：`--sm-`（sm = SimpleMusic）
- MusicService 接口方法名不可改变，QQ Music 实现可先返回空数组占位
- 移除 ShelfScene 从主 UI，但不删除文件（保留功能代码）
- `prefers-reduced-motion` 时所有动画 duration 归零
- 每个 task 完成后必须通过 `npm run typecheck`

---

## 文件结构总览

**新建文件：**
- `src/styles/tokens.css` — CSS custom properties（颜色、圆角、模糊）
- `src/lib/music-service.ts` — MusicService interface + Banner 类型
- `src/lib/netease-music-service.ts` — NetEase 实现
- `src/lib/qq-music-service.ts` — QQ Music 存根
- `src/hooks/useMusicService.ts` — 返回当前激活 service 实例的 hook
- `src/stores/navigation.ts` — 页面视图状态
- `src/pages/ExplorePage.tsx` + `.module.css` — 探索首页
- `src/pages/LibraryPage.tsx` + `.module.css` — 我的库
- `src/pages/SettingsPage.tsx` + `.module.css` — 设置页
- `src/pages/ArtistPage.tsx` + `.module.css` — 歌手详情页
- `src/components/Layout/AppShell.tsx` + `.module.css` — 主内容区切换
- `src/components/Layout/SearchPill.tsx` + `.module.css` — 可展开搜索胶囊
- `src/components/Layout/SourceSwitcher.tsx` + `.module.css` — 音源徽标+切换
- `src/components/Explore/HeroBanner.tsx` + `.module.css` — Hero 轮播
- `src/components/Explore/CardRail.tsx` + `.module.css` — 横向卡片轨道
- `src/components/Explore/PlaylistCard.tsx` + `.module.css` — 歌单卡片
- `src/components/Explore/TrackRow.tsx` + `.module.css` — 歌曲行

**修改文件：**
- `package.json` — rename + version
- `src/styles/global.css` — import tokens，支持 color-scheme
- `src/App.tsx` — 引入 AppShell，移除旧顶部按钮和 ShelfScene
- `src/App.module.css` — 清理旧布局样式
- `src/stores/settings.ts` — 添加 activeSource、themeMode、audioQuality
- `src/types/domain.ts` — 添加 Banner 接口
- `server/routes/netease.ts` — 添加 banner、artist、recommend 端点
- `src/components/Layout/TitleBar.tsx` — 全面重设计
- `src/components/Layout/TitleBar.module.css` — 重写
- `src/components/Player/TrackInfo.tsx` — 歌手名可点击

---

## Task 1: App 重命名

**Files:**
- Modify: `package.json`
- Modify: `src/stores/settings.ts:6` (STORAGE_KEY)
- Modify: `src/components/Layout/TitleBar.tsx` (productName 文本)

**Interfaces:**
- Produces: 无类型变化，仅配置更新

- [ ] **Step 1: 更新 package.json**

将以下字段：
```json
{
  "name": "mineradio-next",
  "productName": "Mineradio",
  "version": "2.0.0",
  "description": "沉浸式音乐播放器（TypeScript + React 重写版）",
  "author": "Mineradio"
}
```
改为：
```json
{
  "name": "simplemusic",
  "productName": "SimpleMusic",
  "version": "1.0.0",
  "description": "简约音乐播放器",
  "author": "Yangshenghao"
}
```

- [ ] **Step 2: 更新 settings store 的 STORAGE_KEY**

`src/stores/settings.ts:6`:
```ts
const STORAGE_KEY = 'simplemusic-settings'
```

- [ ] **Step 3: 更新 exportArchive 默认名**

`src/stores/settings.ts:93`:
```ts
exportArchive(name = 'SimpleMusic 存档') {
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add package.json src/stores/settings.ts
git commit -m "chore: rename app to SimpleMusic v1.0.0"
```

---

## Task 2: CSS Token 系统 + 浅色/深色模式

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: CSS Custom Properties 供所有 `.module.css` 文件通过 `var(--sm-*)` 使用

- [ ] **Step 1: 创建 `src/styles/tokens.css`**

```css
/* ── 浅色模式（默认）── */
:root {
  --sm-bg-base:       #f5f7fa;
  --sm-bg-elevated:   rgba(255, 255, 255, 0.72);
  --sm-bg-overlay:    rgba(255, 255, 255, 0.88);
  --sm-accent:        #4a90d9;
  --sm-accent-warm:   #ff9a3c;
  --sm-text-primary:  #1a1f2e;
  --sm-text-secondary:#6b7280;
  --sm-border:        rgba(0, 0, 0, 0.08);
  --sm-shadow:        0 4px 24px rgba(0, 0, 0, 0.10);
  --sm-blur:          blur(32px);
  --sm-radius-card:   16px;
  --sm-radius-pill:   999px;
  --sm-ease-out:      cubic-bezier(0.16, 1, 0.3, 1);
  --sm-ease-in-out:   cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── 深色模式 ── */
@media (prefers-color-scheme: dark) {
  :root {
    --sm-bg-base:        #10141e;
    --sm-bg-elevated:    rgba(20, 30, 55, 0.65);
    --sm-bg-overlay:     rgba(15, 22, 42, 0.80);
    --sm-accent:         #5da3f0;
    --sm-accent-warm:    #ffad5c;
    --sm-text-primary:   #e8ecf5;
    --sm-text-secondary: #8a95b0;
    --sm-border:         rgba(255, 255, 255, 0.08);
    --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.40);
  }
}

/* ── 手动 theme 覆盖 ── */
[data-theme="light"] {
  --sm-bg-base:        #f5f7fa;
  --sm-bg-elevated:    rgba(255, 255, 255, 0.72);
  --sm-bg-overlay:     rgba(255, 255, 255, 0.88);
  --sm-accent:         #4a90d9;
  --sm-accent-warm:    #ff9a3c;
  --sm-text-primary:   #1a1f2e;
  --sm-text-secondary: #6b7280;
  --sm-border:         rgba(0, 0, 0, 0.08);
  --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.10);
}

[data-theme="dark"] {
  --sm-bg-base:        #10141e;
  --sm-bg-elevated:    rgba(20, 30, 55, 0.65);
  --sm-bg-overlay:     rgba(15, 22, 42, 0.80);
  --sm-accent:         #5da3f0;
  --sm-accent-warm:    #ffad5c;
  --sm-text-primary:   #e8ecf5;
  --sm-text-secondary: #8a95b0;
  --sm-border:         rgba(255, 255, 255, 0.08);
  --sm-shadow:         0 4px 24px rgba(0, 0, 0, 0.40);
}

/* ── 无障碍：去除动画 ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: 更新 `src/styles/global.css`**

替换全文为：
```css
@import './tokens.css';

:root {
  color-scheme: light dark;
}

* {
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  margin: 0;
}

body {
  font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: var(--sm-text-primary);
  background: var(--sm-bg-base);
  overflow: hidden;
  transition: background 350ms var(--sm-ease-in-out), color 200ms var(--sm-ease-in-out);
}

.desktop-shell {
  -webkit-app-region: drag;
}

button, input, a, .no-drag {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css src/styles/global.css
git commit -m "feat(tokens): add CSS token system with light/dark mode"
```

---

## Task 3: Settings Store 扩展

**Files:**
- Modify: `src/stores/settings.ts`

**Interfaces:**
- Produces:
  - `useSettingsStore` 新增字段：`activeSource: 'netease' | 'qq'`、`themeMode: 'auto' | 'light' | 'dark'`、`audioQuality: 'standard' | 'higher' | 'exhigh' | 'lossless'`
  - `setActiveSource(s)`、`setThemeMode(m)`、`setAudioQuality(q)` 方法

- [ ] **Step 1: 更新 `src/stores/settings.ts`**

在 `PersistedSettings` interface 添加：
```ts
interface PersistedSettings {
  hotkeys: HotkeyBinding[]
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  liveBackgroundKeep: boolean
  lyricsPanelMode: 'lyrics' | '3d'
  activeSource: 'netease' | 'qq'
  themeMode: 'auto' | 'light' | 'dark'
  audioQuality: 'standard' | 'higher' | 'exhigh' | 'lossless'
}
```

在 `SettingsStore` interface 添加：
```ts
setActiveSource(s: 'netease' | 'qq'): void
setThemeMode(m: 'auto' | 'light' | 'dark'): void
setAudioQuality(q: 'standard' | 'higher' | 'exhigh' | 'lossless'): void
```

在 `create()` 初始值添加：
```ts
activeSource: 'netease',
themeMode: 'auto',
audioQuality: 'lossless',
```

在 actions 区块添加：
```ts
setActiveSource(s) { set({ activeSource: s }); get().saveToLocal() },
setThemeMode(m) { set({ themeMode: m }); get().saveToLocal() },
setAudioQuality(q) { set({ audioQuality: q }); get().saveToLocal() },
```

在 `saveToLocal` 解构中添加三个新字段，在 `loadFromLocal` `set()` 中也加上默认值：
```ts
activeSource: data.activeSource ?? 'netease',
themeMode: data.themeMode ?? 'auto',
audioQuality: data.audioQuality ?? 'lossless',
```

- [ ] **Step 2: 在 App.tsx 添加 theme 同步效果**

在 `src/App.tsx` 的 `useEffect` 中加入（与现有 `loadFromLocal` 的 useEffect 合并或新增一个）：

```tsx
useEffect(() => {
  const sync = () => {
    const mode = useSettingsStore.getState().themeMode
    const root = document.documentElement
    if (mode === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', mode)
  }
  sync()
  return useSettingsStore.subscribe(sync)
}, [])
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/stores/settings.ts src/App.tsx
git commit -m "feat(settings): add activeSource, themeMode, audioQuality fields"
```

---

## Task 4: Domain 类型 + MusicService 接口

**Files:**
- Modify: `src/types/domain.ts`
- Create: `src/lib/music-service.ts`

**Interfaces:**
- Produces:
  - `Banner` 类型（domain.ts）
  - `MusicService` interface（music-service.ts）

- [ ] **Step 1: 在 `src/types/domain.ts` 末尾添加 Banner**

```ts
export interface Banner {
  id: string | number
  title: string
  subtitle?: string
  cover: string
  track?: Track
  playlist?: Playlist
}
```

- [ ] **Step 2: 创建 `src/lib/music-service.ts`**

```ts
import type { Track, Playlist, LyricLine, ArtistInfo, Banner } from '../types/domain'

export interface MusicService {
  getRecommendBanners(): Promise<Banner[]>
  getRecommendPlaylists(): Promise<Playlist[]>
  getNewSongs(): Promise<Track[]>
  getPlaylistDetail(id: unknown): Promise<Track[]>
  searchTracks(keyword: string): Promise<Track[]>
  searchArtists(keyword: string): Promise<ArtistInfo[]>
  getArtistDetail(id: unknown): Promise<ArtistInfo>
  getArtistSongs(id: unknown): Promise<Track[]>
  getArtistAlbums(id: unknown): Promise<Playlist[]>
  getTrackUrl(track: Track): Promise<string>
  getLyrics(track: Track): Promise<LyricLine[]>
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/types/domain.ts src/lib/music-service.ts
git commit -m "feat(types): add Banner type + MusicService interface"
```

---

## Task 5: 服务端 — NetEase 新端点

**Files:**
- Modify: `server/routes/netease.ts`
- Modify: `server/lib/netease-client.ts`

**Interfaces:**
- Produces:
  - `GET /api/netease/banner` → `{ banners: Banner[] }`
  - `GET /api/netease/recommend/playlists` → `{ playlists: MappedPlaylist[] }`
  - `GET /api/netease/recommend/songs` → `{ songs: MappedSong[] }`
  - `GET /api/netease/artist/detail?id=` → `{ artist: ArtistInfo }`
  - `GET /api/netease/artist/songs?id=&limit=` → `{ songs: MappedSong[] }`
  - `GET /api/netease/artist/albums?id=&limit=` → `{ albums: MappedPlaylist[] }`

- [ ] **Step 1: 在 `server/lib/netease-client.ts` 末尾添加 artist 映射函数**

```ts
export interface MappedArtistDetail {
  id: unknown
  name: string
  avatar: string
  musicSize: number
  songNum: number
  source: 'netease'
}

export function mapArtistDetail(raw: unknown): MappedArtistDetail {
  const a = asObj(raw)
  const basic = asObj(a.artist || a)
  return {
    id: basic.id ?? basic.artistId,
    name: asStr(basic.name),
    avatar: asStr(basic.picUrl || basic.img1v1Url || basic.avatar || ''),
    musicSize: asNum(basic.musicSize),
    songNum: asNum(basic.songNum || basic.musicSize),
    source: 'netease',
  }
}

export function mapAlbum(raw: unknown): MappedPlaylist {
  const a = asObj(raw)
  return {
    id: a.id,
    name: asStr(a.name),
    cover: asStr(a.picUrl || a.coverImgUrl || ''),
    trackCount: asNum(a.size || a.trackCount),
    playCount: 0,
    creator: '',
    tag: '专辑',
    source: 'netease',
    type: 'album',
    provider: 'netease',
  }
}
```

- [ ] **Step 2: 在 `server/routes/netease.ts` 添加新路由**

在现有路由处理函数的 `if/else` 链中，紧接 `/api/search` 之后添加：

```ts
// ---------- Banner ----------
if (pn === '/api/netease/banner') {
  try {
    const cookie = getCookie(ctx, 'netease')
    const resp = await call('banner', { type: 0, cookie })
    const banners = asArr(asObj(resp.body).banners || []).slice(0, 5).map((b) => {
      const item = asObj(b)
      const song = asObj(item.song || {})
      return {
        id: item.bannerId || item.targetId,
        title: asStr(item.typeTitle || song.name || ''),
        subtitle: asStr(song.name ? mapArtists(asArr(song.ar || [])).map((a) => a.name).join('、') : ''),
        cover: asStr(item.pic || item.imageUrl || ''),
        track: song.id ? mapSongRecord(song) : undefined,
      }
    })
    sendJson(res, { banners })
  } catch (err) {
    console.error('[Banner]', err)
    sendJson(res, { banners: [] }, 500)
  }
  return true
}

// ---------- Recommend Playlists ----------
if (pn === '/api/netease/recommend/playlists') {
  try {
    const cookie = getCookie(ctx, 'netease')
    const [personalized, recommend] = await Promise.allSettled([
      call('personalized', { limit: 8, cookie, timestamp: Date.now() }),
      call('recommend_resource', { cookie, timestamp: Date.now() }),
    ])
    const fromPersonalized = personalized.status === 'fulfilled'
      ? asArr(asObj(personalized.value.body).result || []).map((pl) => mapDiscoverPlaylist(pl, '推荐歌单')).filter((pl) => pl.id && pl.name).slice(0, 8)
      : []
    const fromRecommend = recommend.status === 'fulfilled'
      ? asArr(asObj(asObj(recommend.value.body).recommend || recommend.value.body).recommend || asObj(recommend.value.body).data || []).map((pl) => mapDiscoverPlaylist(pl, '私人推荐')).filter((pl) => pl.id && pl.name).slice(0, 6)
      : []
    const seen = new Set<unknown>()
    const playlists = [...fromPersonalized, ...fromRecommend].filter((pl) => { if (seen.has(pl.id)) return false; seen.add(pl.id); return true })
    sendJson(res, { playlists })
  } catch (err) {
    console.error('[RecommendPlaylists]', err)
    sendJson(res, { playlists: [] }, 500)
  }
  return true
}

// ---------- Recommend Songs ----------
if (pn === '/api/netease/recommend/songs') {
  try {
    const cookie = getCookie(ctx, 'netease')
    const resp = await call('recommend_songs', { cookie, timestamp: Date.now() })
    const body = asObj(resp.body)
    const data = asObj(body.data)
    const raw = data.dailySongs || data.recommend || body.recommend
    const songs = asArr(raw).map(mapSongRecord).filter((s) => s.id && s.name).slice(0, 20)
    sendJson(res, { songs })
  } catch (err) {
    console.error('[RecommendSongs]', err)
    sendJson(res, { songs: [] }, 500)
  }
  return true
}

// ---------- Artist Detail ----------
if (pn === '/api/netease/artist/detail') {
  try {
    const cookie = getCookie(ctx, 'netease')
    const id = url.searchParams.get('id') || ''
    const resp = await call('artist_detail', { id, cookie })
    const body = asObj(resp.body)
    const raw = asObj(body.data || body).artist || asObj(body.data || body)
    sendJson(res, { artist: mapArtistDetail(raw) })
  } catch (err) {
    console.error('[ArtistDetail]', err)
    sendJson(res, { error: (err as Error).message }, 500)
  }
  return true
}

// ---------- Artist Songs ----------
if (pn === '/api/netease/artist/songs') {
  try {
    const cookie = getCookie(ctx, 'netease')
    const id = url.searchParams.get('id') || ''
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const resp = await call('artist_songs', { id, limit, offset: 0, cookie })
    const body = asObj(resp.body)
    const songs = asArr(body.songs || body.data || []).map(mapSongRecord).filter((s) => s.id && s.name)
    sendJson(res, { songs })
  } catch (err) {
    console.error('[ArtistSongs]', err)
    sendJson(res, { songs: [] }, 500)
  }
  return true
}

// ---------- Artist Albums ----------
if (pn === '/api/netease/artist/albums') {
  try {
    const cookie = getCookie(ctx, 'netease')
    const id = url.searchParams.get('id') || ''
    const limit = parseInt(url.searchParams.get('limit') || '20')
    const resp = await call('artist_album', { id, limit, offset: 0, cookie })
    const body = asObj(resp.body)
    const albums = asArr(body.hotAlbums || body.albums || []).map(mapAlbum).filter((a) => a.id && a.name)
    sendJson(res, { albums })
  } catch (err) {
    console.error('[ArtistAlbums]', err)
    sendJson(res, { albums: [] }, 500)
  }
  return true
}
```

注意：需要在该文件顶部 import 中加入 `mapArtistDetail` 和 `mapAlbum`：
```ts
import {
  // ...existing imports...
  mapArtistDetail,
  mapAlbum,
} from '../lib/netease-client'
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 无错误

- [ ] **Step 4: 手动测试（dev 模式下）**

```bash
npm run server:dev &
curl "http://localhost:PORT/api/netease/banner"
curl "http://localhost:PORT/api/netease/recommend/playlists"
```
Expected: 返回含 `banners`/`playlists` 数组的 JSON（未登录时可能为空，但结构正确）

- [ ] **Step 5: Commit**

```bash
git add server/routes/netease.ts server/lib/netease-client.ts
git commit -m "feat(server): add netease banner, recommend, artist endpoints"
```

---

## Task 6: NeteaseMusicService + QQMusicService + useMusicService

**Files:**
- Create: `src/lib/netease-music-service.ts`
- Create: `src/lib/qq-music-service.ts`
- Create: `src/hooks/useMusicService.ts`

**Interfaces:**
- Consumes: `MusicService` interface（Task 4），`useSettingsStore`（Task 3），`api` from `src/lib/api`
- Produces: `useMusicService()` → `MusicService`

- [ ] **Step 1: 创建 `src/lib/netease-music-service.ts`**

```ts
import { api } from './api'
import type { MusicService } from './music-service'
import type { Banner, Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export class NeteaseMusicService implements MusicService {
  async getRecommendBanners(): Promise<Banner[]> {
    const res = await api.get<{ banners: Banner[] }>('/api/netease/banner')
    return res.banners ?? []
  }

  async getRecommendPlaylists(): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/netease/recommend/playlists')
    return res.playlists ?? []
  }

  async getNewSongs(): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/netease/recommend/songs')
    return res.songs ?? []
  }

  async getPlaylistDetail(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/playlist/detail', { id })
    return res.songs ?? []
  }

  async searchTracks(keyword: string): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/search', { keywords: keyword, limit: 20 })
    return res.songs ?? []
  }

  async searchArtists(keyword: string): Promise<ArtistInfo[]> {
    const res = await api.get<{ artists: ArtistInfo[] }>('/api/search/artists', { keywords: keyword, limit: 5 })
    return (res.artists ?? []).map((a) => ({ ...a, source: 'netease' as const }))
  }

  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    const res = await api.get<{ artist: ArtistInfo }>('/api/netease/artist/detail', { id })
    return res.artist
  }

  async getArtistSongs(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/netease/artist/songs', { id, limit: 50 })
    return res.songs ?? []
  }

  async getArtistAlbums(id: unknown): Promise<Playlist[]> {
    const res = await api.get<{ albums: Playlist[] }>('/api/netease/artist/albums', { id, limit: 20 })
    return res.albums ?? []
  }

  async getTrackUrl(track: Track): Promise<string> {
    const res = await api.get<{ url: string }>('/api/song/url', { id: track.id })
    return res.url ?? ''
  }

  async getLyrics(track: Track): Promise<LyricLine[]> {
    const res = await api.get<{ lines: LyricLine[] }>('/api/lyric', { id: track.id })
    return res.lines ?? []
  }
}
```

- [ ] **Step 2: 创建 `src/lib/qq-music-service.ts`**

```ts
import { api } from './api'
import type { MusicService } from './music-service'
import type { Banner, Track, Playlist, LyricLine, ArtistInfo } from '../types/domain'

export class QQMusicService implements MusicService {
  async getRecommendBanners(): Promise<Banner[]> { return [] }
  async getRecommendPlaylists(): Promise<Playlist[]> {
    const res = await api.get<{ playlists: Playlist[] }>('/api/qq/playlists/discover')
    return res.playlists ?? []
  }
  async getNewSongs(): Promise<Track[]> { return [] }
  async getPlaylistDetail(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/playlist/detail', { id })
    return res.songs ?? []
  }
  async searchTracks(keyword: string): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/search', { keywords: keyword, limit: 20 })
    return res.songs ?? []
  }
  async searchArtists(keyword: string): Promise<ArtistInfo[]> {
    const res = await api.get<{ artists: ArtistInfo[] }>('/api/qq/search/artists', { keywords: keyword, limit: 5 })
    return (res.artists ?? []).map((a) => ({ ...a, source: 'qq' as const }))
  }
  async getArtistDetail(id: unknown): Promise<ArtistInfo> {
    const res = await api.get<{ artist: ArtistInfo }>('/api/qq/artist/detail', { id })
    return res.artist
  }
  async getArtistSongs(id: unknown): Promise<Track[]> {
    const res = await api.get<{ songs: Track[] }>('/api/qq/artist/songs', { id })
    return res.songs ?? []
  }
  async getArtistAlbums(id: unknown): Promise<Playlist[]> {
    const res = await api.get<{ albums: Playlist[] }>('/api/qq/artist/albums', { id })
    return res.albums ?? []
  }
  async getTrackUrl(track: Track): Promise<string> {
    const res = await api.get<{ url: string }>('/api/qq/song/url', { id: track.id, mid: track.mid })
    return res.url ?? ''
  }
  async getLyrics(track: Track): Promise<LyricLine[]> {
    const res = await api.get<{ lines: LyricLine[] }>('/api/qq/lyric', { id: track.id, mid: track.mid })
    return res.lines ?? []
  }
}
```

- [ ] **Step 3: 创建 `src/hooks/useMusicService.ts`**

```ts
import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settings'
import { NeteaseMusicService } from '../lib/netease-music-service'
import { QQMusicService } from '../lib/qq-music-service'
import type { MusicService } from '../lib/music-service'

const netease = new NeteaseMusicService()
const qq = new QQMusicService()

export function useMusicService(): MusicService {
  const activeSource = useSettingsStore((s) => s.activeSource)
  return useMemo(() => (activeSource === 'qq' ? qq : netease), [activeSource])
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/lib/netease-music-service.ts src/lib/qq-music-service.ts src/hooks/useMusicService.ts
git commit -m "feat(service): add NeteaseMusicService, QQMusicService, useMusicService hook"
```

---

## Task 7: Navigation Store + AppShell

**Files:**
- Create: `src/stores/navigation.ts`
- Create: `src/components/Layout/AppShell.tsx`
- Create: `src/components/Layout/AppShell.module.css`
- Modify: `src/App.tsx`
- Modify: `src/App.module.css`

**Interfaces:**
- Produces:
  - `useNavigationStore` with `currentView`, `navigateTo(view)`, `goBack()`
  - `AppView` type: `'explore' | 'library' | 'settings' | { type: 'artist'; id: unknown; source: 'netease' | 'qq' }`
  - `AppShell` component: renders correct page based on `currentView`

- [ ] **Step 1: 创建 `src/stores/navigation.ts`**

```ts
import { create } from 'zustand'

export type AppView =
  | 'explore'
  | 'library'
  | 'settings'
  | { type: 'artist'; id: unknown; source: 'netease' | 'qq' }

interface NavigationStore {
  currentView: AppView
  history: AppView[]
  navigateTo(view: AppView): void
  goBack(): void
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  currentView: 'explore',
  history: [],

  navigateTo(view) {
    set((s) => ({ currentView: view, history: [...s.history, s.currentView] }))
  },

  goBack() {
    const { history } = get()
    if (history.length === 0) return
    const prev = history[history.length - 1]
    set({ currentView: prev, history: history.slice(0, -1) })
  },
}))
```

- [ ] **Step 2: 创建 `src/components/Layout/AppShell.tsx`**

```tsx
import { lazy, Suspense } from 'react'
import { useNavigationStore } from '../../stores/navigation'
import styles from './AppShell.module.css'

const ExplorePage = lazy(() => import('../../pages/ExplorePage').then((m) => ({ default: m.ExplorePage })))
const LibraryPage = lazy(() => import('../../pages/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('../../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ArtistPage = lazy(() => import('../../pages/ArtistPage').then((m) => ({ default: m.ArtistPage })))

export function AppShell() {
  const view = useNavigationStore((s) => s.currentView)

  const renderPage = () => {
    if (view === 'explore') return <ExplorePage />
    if (view === 'library') return <LibraryPage />
    if (view === 'settings') return <SettingsPage />
    if (typeof view === 'object' && view.type === 'artist') {
      return <ArtistPage id={view.id} source={view.source} />
    }
    return <ExplorePage />
  }

  return (
    <div className={styles.shell}>
      <Suspense fallback={<div className={styles.loading} />}>
        {renderPage()}
      </Suspense>
    </div>
  )
}
```

- [ ] **Step 3: 创建 `src/components/Layout/AppShell.module.css`**

```css
.shell {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.loading {
  width: 100%;
  height: 100%;
  background: var(--sm-bg-base);
}
```

- [ ] **Step 4: 创建占位页面文件（供 AppShell lazy import）**

创建 `src/pages/ExplorePage.tsx`：
```tsx
export function ExplorePage() {
  return <div style={{ padding: 24, color: 'var(--sm-text-primary)' }}>探索页（开发中）</div>
}
```

创建 `src/pages/LibraryPage.tsx`：
```tsx
export function LibraryPage() {
  return <div style={{ padding: 24, color: 'var(--sm-text-primary)' }}>我的库（开发中）</div>
}
```

创建 `src/pages/SettingsPage.tsx`：
```tsx
export function SettingsPage() {
  return <div style={{ padding: 24, color: 'var(--sm-text-primary)' }}>设置（开发中）</div>
}
```

创建 `src/pages/ArtistPage.tsx`：
```tsx
interface ArtistPageProps { id: unknown; source: 'netease' | 'qq' }
export function ArtistPage({ id, source }: ArtistPageProps) {
  return <div style={{ padding: 24, color: 'var(--sm-text-primary)' }}>歌手页 {String(id)} {source}（开发中）</div>
}
```

- [ ] **Step 5: 更新 `src/App.tsx` 使用 AppShell，移除旧顶部按钮和 ShelfScene**

```tsx
import { useEffect } from 'react'
import styles from './App.module.css'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useAudio } from './hooks/useAudio'
import { useDesktopLyricsSync } from './hooks/useDesktopLyricsSync'
import { useWallpaperSync } from './hooks/useWallpaperSync'
import { useLyricsFetch } from './hooks/useLyricsFetch'
import { useSettingsStore } from './stores/settings'
import { WindowChrome } from './components/Layout/WindowChrome'
import { TitleBar } from './components/Layout/TitleBar'
import { AppShell } from './components/Layout/AppShell'
import { PlayerBar } from './components/Player/PlayerBar'
import { LyricsPanel } from './components/Lyrics/LyricsPanel'
import { useState } from 'react'

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
        <TitleBar />
        <AppShell />
        <PlayerBar onOpenLyrics={() => setLyricsOpen(true)} />
        <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
      </div>
    </WindowChrome>
  )
}
```

- [ ] **Step 6: 更新 `src/App.module.css`**

```css
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--sm-bg-base);
}
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```
Expected: 无错误

- [ ] **Step 8: 视觉检查**

```bash
npm run dev
```
Expected: 应用启动，显示 TitleBar + "探索页（开发中）" + PlayerBar，背景色跟随系统深浅模式

- [ ] **Step 9: Commit**

```bash
git add src/stores/navigation.ts src/components/Layout/AppShell.tsx src/components/Layout/AppShell.module.css src/pages/ src/App.tsx src/App.module.css
git commit -m "feat(shell): add navigation store + AppShell with lazy page routing"
```

---

## Task 8: TitleBar 重设计

**Files:**
- Modify: `src/components/Layout/TitleBar.tsx`
- Modify: `src/components/Layout/TitleBar.module.css`
- Create: `src/components/Layout/SearchPill.tsx`
- Create: `src/components/Layout/SearchPill.module.css`
- Create: `src/components/Layout/SourceSwitcher.tsx`
- Create: `src/components/Layout/SourceSwitcher.module.css`

**Interfaces:**
- Consumes: `useNavigationStore.navigateTo()`，`useSettingsStore.activeSource`，`useMusicService`
- Produces: 完整的顶栏（交通灯 + SearchPill + 居中标签 + SourceSwitcher + Avatar）

- [ ] **Step 1: 创建 `src/components/Layout/SearchPill.tsx`**

```tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import type { FormEvent } from 'react'
import { gsap } from 'gsap'
import { useNavigationStore } from '../../stores/navigation'
import { useMusicService } from '../../hooks/useMusicService'
import { usePlaylistStore } from '../../stores/playlist'
import type { Track, ArtistInfo } from '../../types/domain'
import styles from './SearchPill.module.css'

export function SearchPill() {
  const [expanded, setExpanded] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [songs, setSongs] = useState<Track[]>([])
  const [artists, setArtists] = useState<ArtistInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)

  const pillRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const service = useMusicService()
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  const expand = useCallback(() => {
    setExpanded(true)
    gsap.fromTo(pillRef.current, { width: 36 }, { width: 240, duration: 0.3, ease: 'power2.out' })
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const collapse = useCallback(() => {
    gsap.to(pillRef.current, {
      width: 36, duration: 0.25, ease: 'power2.in',
      onComplete: () => { setExpanded(false); setKeyword(''); setSongs([]); setArtists([]); setDropOpen(false) },
    })
  }, [])

  useEffect(() => {
    if (!dropOpen) return
    const handler = (e: MouseEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
        setDropOpen(false)
      }
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDropOpen(false); collapse() } }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc) }
  }, [dropOpen, collapse])

  async function runSearch() {
    const q = keyword.trim()
    if (!q || loading) return
    setLoading(true)
    setDropOpen(true)
    try {
      const [foundSongs, foundArtists] = await Promise.allSettled([
        service.searchTracks(q),
        service.searchArtists(q),
      ])
      setSongs(foundSongs.status === 'fulfilled' ? foundSongs.value : [])
      setArtists(foundArtists.status === 'fulfilled' ? foundArtists.value : [])
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
    collapse()
  }

  function pickArtist(artist: ArtistInfo) {
    navigateTo({ type: 'artist', id: artist.id, source: artist.source })
    collapse()
  }

  return (
    <div className={styles.wrapper} ref={pillRef}>
      {!expanded ? (
        <button className={`${styles.icon} no-drag`} onClick={expand} aria-label="搜索">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className={`${styles.input} no-drag`}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌曲、歌手…"
          />
          <button type="button" className={`${styles.closeBtn} no-drag`} onClick={collapse} aria-label="关闭">✕</button>
        </form>
      )}

      {dropOpen && (songs.length > 0 || artists.length > 0 || loading) && (
        <div className={styles.dropdown}>
          {loading && <p className={styles.hint}>搜索中…</p>}
          {!loading && artists.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>歌手</div>
              {artists.map((a, i) => (
                <button key={`a-${i}`} className={`${styles.artistRow} no-drag`} onClick={() => pickArtist(a)}>
                  {a.avatar && <img className={styles.avatar} src={a.avatar} alt="" loading="lazy" />}
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && songs.length > 0 && (
            <div className={styles.section}>
              {artists.length > 0 && <div className={styles.sectionLabel}>歌曲</div>}
              {songs.slice(0, 8).map((s, i) => (
                <button key={`s-${i}`} className={`${styles.songRow} no-drag`} onClick={() => pickSong(i)}>
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
      )}
    </div>
  )
}
```

- [ ] **Step 2: 创建 `src/components/Layout/SearchPill.module.css`**

```css
.wrapper {
  position: relative;
  width: 36px;
  height: 32px;
  flex-shrink: 0;
}

.icon {
  width: 36px;
  height: 32px;
  border-radius: var(--sm-radius-pill);
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  color: var(--sm-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

.icon:hover { color: var(--sm-text-primary); background: var(--sm-bg-overlay); }

.form {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius-pill);
  overflow: hidden;
  padding: 0 8px 0 12px;
  gap: 4px;
}

.input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--sm-text-primary);
  font-size: 13px;
  min-width: 0;
}

.input::placeholder { color: var(--sm-text-secondary); }

.closeBtn {
  background: none;
  border: none;
  color: var(--sm-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  line-height: 1;
}

.dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 320px;
  background: var(--sm-bg-overlay);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius-card);
  box-shadow: var(--sm-shadow);
  padding: 8px 0;
  z-index: 200;
  animation: dropIn 180ms var(--sm-ease-out);
}

@keyframes dropIn {
  from { opacity: 0; transform: scale(0.96) translateY(-4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.hint { padding: 12px 16px; color: var(--sm-text-secondary); font-size: 13px; margin: 0; }

.section { padding: 4px 0; }

.sectionLabel {
  padding: 4px 16px;
  font-size: 11px;
  font-weight: 600;
  color: var(--sm-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.artistRow, .songRow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 16px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sm-text-primary);
  font-size: 13px;
  text-align: left;
  transition: background 120ms;
}

.artistRow:hover, .songRow:hover { background: var(--sm-bg-elevated); }

.avatar, .cover {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.cover { border-radius: 6px; }

.songInfo { display: flex; flex-direction: column; min-width: 0; }
.songName { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.songArtist { font-size: 11px; color: var(--sm-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 3: 创建 `src/components/Layout/SourceSwitcher.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react'
import { useSettingsStore } from '../../stores/settings'
import styles from './SourceSwitcher.module.css'

const SOURCES = [
  { key: 'netease' as const, label: '网易云' },
  { key: 'qq' as const, label: 'QQ 音乐' },
]

export function SourceSwitcher() {
  const [open, setOpen] = useState(false)
  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)
  const ref = useRef<HTMLDivElement>(null)

  const current = SOURCES.find((s) => s.key === activeSource) ?? SOURCES[0]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className={styles.root} ref={ref}>
      <button className={`${styles.badge} no-drag`} onClick={() => setOpen((v) => !v)}>
        <span className={styles.dot} />
        {current.label}
      </button>
      {open && (
        <div className={styles.menu}>
          {SOURCES.map((s) => (
            <button
              key={s.key}
              className={`${styles.option} no-drag ${s.key === activeSource ? styles.active : ''}`}
              onClick={() => { setActiveSource(s.key); setOpen(false) }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 创建 `src/components/Layout/SourceSwitcher.module.css`**

```css
.root { position: relative; }

.badge {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--sm-radius-pill);
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  color: var(--sm-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 150ms;
}

.badge:hover { background: var(--sm-bg-overlay); color: var(--sm-text-primary); }

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sm-accent);
}

.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--sm-bg-overlay);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: 10px;
  box-shadow: var(--sm-shadow);
  padding: 4px;
  z-index: 200;
  animation: dropIn 160ms var(--sm-ease-out);
}

@keyframes dropIn {
  from { opacity: 0; transform: scale(0.95) translateY(-4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.option {
  display: block;
  width: 100%;
  padding: 7px 14px;
  background: none;
  border: none;
  color: var(--sm-text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  border-radius: 7px;
  transition: background 120ms;
}

.option:hover { background: var(--sm-bg-elevated); }
.option.active { color: var(--sm-accent); font-weight: 500; }
```

- [ ] **Step 5: 重写 `src/components/Layout/TitleBar.tsx`**

```tsx
import { useNavigationStore } from '../../stores/navigation'
import type { AppView } from '../../stores/navigation'
import { SearchPill } from './SearchPill'
import { SourceSwitcher } from './SourceSwitcher'
import styles from './TitleBar.module.css'

const TABS: { view: AppView; label: string }[] = [
  { view: 'explore', label: '探索' },
  { view: 'library', label: '我的库' },
  { view: 'settings', label: '设置' },
]

export function TitleBar() {
  const currentView = useNavigationStore((s) => s.currentView)
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  const activeTab = typeof currentView === 'string' ? currentView : null

  return (
    <header className={`${styles.bar} desktop-shell`}>
      {/* 左侧：traffic lights 占位 + 搜索 */}
      <div className={styles.left}>
        <div className={styles.trafficLights} aria-hidden="true" />
        <SearchPill />
      </div>

      {/* 中间：标签导航（绝对居中） */}
      <nav className={styles.tabs} aria-label="主导航">
        {TABS.map(({ view, label }) => (
          <button
            key={String(view)}
            className={`${styles.tab} no-drag ${activeTab === view ? styles.active : ''}`}
            onClick={() => navigateTo(view)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* 右侧：音源切换 + 头像 */}
      <div className={styles.right}>
        <SourceSwitcher />
        <button className={`${styles.avatar} no-drag`} aria-label="账户">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
          </svg>
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 6: 重写 `src/components/Layout/TitleBar.module.css`**

```css
.bar {
  position: relative;
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 12px;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border-bottom: 1px solid var(--sm-border);
  flex-shrink: 0;
  z-index: 100;
}

/* macOS traffic lights 占位（约 72px） */
.trafficLights {
  width: 72px;
  height: 12px;
  flex-shrink: 0;
}

.left {
  display: flex;
  align-items: center;
  gap: 10px;
  position: absolute;
  left: 12px;
}

/* 绝对居中，不受左右影响 */
.tabs {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius-pill);
  padding: 3px;
}

.tab {
  padding: 5px 16px;
  border-radius: var(--sm-radius-pill);
  background: none;
  border: none;
  color: var(--sm-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 180ms var(--sm-ease-out), color 180ms;
  white-space: nowrap;
}

.tab:hover { color: var(--sm-text-primary); }

.tab.active {
  background: var(--sm-bg-overlay);
  color: var(--sm-text-primary);
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
}

.right {
  display: flex;
  align-items: center;
  gap: 8px;
  position: absolute;
  right: 12px;
}

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  color: var(--sm-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 150ms;
}

.avatar:hover { background: var(--sm-bg-overlay); color: var(--sm-text-primary); }
```

- [ ] **Step 7: Typecheck + 视觉检查**

```bash
npm run typecheck
npm run dev
```
Expected: TitleBar 显示搜索胶囊（左）+ 三标签居中 + 音源/头像（右），点击搜索后胶囊展开并显示输入框，标签居中位置不变

- [ ] **Step 8: Commit**

```bash
git add src/components/Layout/TitleBar.tsx src/components/Layout/TitleBar.module.css src/components/Layout/SearchPill.tsx src/components/Layout/SearchPill.module.css src/components/Layout/SourceSwitcher.tsx src/components/Layout/SourceSwitcher.module.css
git commit -m "feat(titlebar): redesign with SearchPill, centered tabs, SourceSwitcher"
```

---

## Task 9: 探索页

**Files:**
- Modify: `src/pages/ExplorePage.tsx`
- Create: `src/pages/ExplorePage.module.css`
- Create: `src/components/Explore/HeroBanner.tsx` + `.module.css`
- Create: `src/components/Explore/CardRail.tsx` + `.module.css`
- Create: `src/components/Explore/PlaylistCard.tsx` + `.module.css`
- Create: `src/components/Explore/TrackRow.tsx` + `.module.css`

**Interfaces:**
- Consumes: `useMusicService()`, `usePlaylistStore`, `useNavigationStore`
- Produces: 完整探索页（Hero + 今日推荐轨道 + 推荐歌单轨道 + 新歌速递列表）

- [ ] **Step 1: 创建 `src/components/Explore/TrackRow.tsx`**

```tsx
import type { Track } from '../../types/domain'
import styles from './TrackRow.module.css'

interface TrackRowProps {
  track: Track
  index?: number
  onPlay(): void
}

export function TrackRow({ track, index, onPlay }: TrackRowProps) {
  return (
    <button className={`${styles.row} no-drag`} onClick={onPlay}>
      {index !== undefined && <span className={styles.index}>{index + 1}</span>}
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

- [ ] **Step 2: 创建 `src/components/Explore/TrackRow.module.css`**

```css
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 16px;
  background: none;
  border: none;
  color: var(--sm-text-primary);
  cursor: pointer;
  text-align: left;
  border-radius: 10px;
  transition: background 120ms;
}

.row:hover { background: var(--sm-bg-elevated); }

.index { width: 20px; text-align: right; color: var(--sm-text-secondary); font-size: 13px; flex-shrink: 0; }

.cover {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.info { flex: 1; min-width: 0; display: flex; flex-direction: column; }

.name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artist {
  font-size: 12px;
  color: var(--sm-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.duration { font-size: 12px; color: var(--sm-text-secondary); flex-shrink: 0; }
```

- [ ] **Step 3: 创建 `src/components/Explore/PlaylistCard.tsx` + `.module.css`**

```tsx
import type { Playlist } from '../../types/domain'
import styles from './PlaylistCard.module.css'

interface PlaylistCardProps {
  playlist: Playlist
  onClick(): void
}

export function PlaylistCard({ playlist, onClick }: PlaylistCardProps) {
  return (
    <button className={`${styles.card} no-drag`} onClick={onClick}>
      <div className={styles.coverWrap}>
        {playlist.cover
          ? <img className={styles.cover} src={playlist.cover} alt="" loading="lazy" />
          : <div className={styles.coverFallback} />}
      </div>
      <p className={styles.name}>{playlist.name}</p>
      <p className={styles.meta}>{playlist.trackCount} 首</p>
    </button>
  )
}
```

```css
/* PlaylistCard.module.css */
.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 160px;
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--sm-text-primary);
  text-align: left;
  padding: 0;
}

.coverWrap {
  width: 160px;
  height: 160px;
  border-radius: var(--sm-radius-card);
  overflow: hidden;
  transition: transform 200ms var(--sm-ease-out), box-shadow 200ms;
}

.card:hover .coverWrap {
  transform: translateY(-4px) scale(1.02);
  box-shadow: var(--sm-shadow);
}

.cover { width: 100%; height: 100%; object-fit: cover; }

.coverFallback { width: 100%; height: 100%; background: var(--sm-bg-elevated); }

.name {
  margin: 8px 0 2px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 160px;
}

.meta { margin: 0; font-size: 11px; color: var(--sm-text-secondary); }
```

- [ ] **Step 4: 创建 `src/components/Explore/CardRail.tsx` + `.module.css`**

```tsx
import type { ReactNode } from 'react'
import styles from './CardRail.module.css'

interface CardRailProps {
  title: string
  children: ReactNode
}

export function CardRail({ title, children }: CardRailProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>{title}</h2>
      <div
        className={styles.rail}
        onWheel={(e) => {
          e.preventDefault()
          e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {children}
      </div>
    </section>
  )
}
```

```css
/* CardRail.module.css */
.section { margin-bottom: 32px; }

.title {
  font-size: 18px;
  font-weight: 700;
  color: var(--sm-text-primary);
  margin: 0 0 16px;
  padding: 0 24px;
}

.rail {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 4px 24px 12px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  /* 两端渐隐 */
  -webkit-mask-image: linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%);
  mask-image: linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%);
}

.rail::-webkit-scrollbar { display: none; }
```

- [ ] **Step 5: 创建 `src/components/Explore/HeroBanner.tsx`**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import type { Banner } from '../../types/domain'
import { usePlaylistStore } from '../../stores/playlist'
import styles from './HeroBanner.module.css'

interface HeroBannerProps {
  banners: Banner[]
}

function extractColor(img: HTMLImageElement): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 16; canvas.height = 16
    const ctx = canvas.getContext('2d')
    if (!ctx) return '#10141e'
    ctx.drawImage(img, 0, 0, 16, 16)
    const d = ctx.getImageData(4, 4, 8, 8).data
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++ }
    return `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`
  } catch { return '#10141e' }
}

export function HeroBanner({ banners }: HeroBannerProps) {
  const [idx, setIdx] = useState(0)
  const [bgColor, setBgColor] = useState('#10141e')
  const imgRef = useRef<HTMLImageElement>(null)

  const current = banners[idx]

  const onImgLoad = useCallback(() => {
    if (imgRef.current) setBgColor(extractColor(imgRef.current))
  }, [])

  useEffect(() => {
    if (banners.length <= 1) return
    const t = setInterval(() => setIdx((i) => (i + 1) % banners.length), 5000)
    return () => clearInterval(t)
  }, [banners.length])

  function play() {
    if (!current) return
    if (current.track) {
      usePlaylistStore.getState().setQueue([current.track], 0)
    }
  }

  if (!current) return null

  return (
    <div
      className={styles.hero}
      style={{ '--hero-bg': bgColor } as React.CSSProperties}
    >
      <div className={styles.bg} />
      <div className={styles.content}>
        <img
          ref={imgRef}
          className={styles.cover}
          src={current.cover}
          alt=""
          crossOrigin="anonymous"
          onLoad={onImgLoad}
        />
        <div className={styles.text}>
          <h1 className={styles.title}>{current.title}</h1>
          {current.subtitle && <p className={styles.subtitle}>{current.subtitle}</p>}
          {current.track && (
            <button className={`${styles.playBtn} no-drag`} onClick={play}>
              ▶ 立即播放
            </button>
          )}
        </div>
      </div>
      {banners.length > 1 && (
        <div className={styles.dots}>
          {banners.map((_, i) => (
            <button
              key={i}
              className={`${styles.dot} no-drag ${i === idx ? styles.dotActive : ''}`}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: 创建 `src/components/Explore/HeroBanner.module.css`**

```css
.hero {
  position: relative;
  height: 300px;
  overflow: hidden;
  flex-shrink: 0;
}

.bg {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 30% 50%, var(--hero-bg, #10141e) 0%, var(--sm-bg-base) 100%);
  transition: background 800ms var(--sm-ease-in-out);
}

.content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 32px;
  height: 100%;
  padding: 40px 48px;
}

.cover {
  width: 200px;
  height: 200px;
  border-radius: var(--sm-radius-card);
  object-fit: cover;
  box-shadow: 0 8px 40px rgba(0,0,0,0.4);
  flex-shrink: 0;
  transition: opacity 400ms var(--sm-ease-in-out);
}

.text { display: flex; flex-direction: column; gap: 8px; }

.title {
  font-size: 28px;
  font-weight: 700;
  color: var(--sm-text-primary);
  margin: 0;
  line-height: 1.2;
}

.subtitle {
  font-size: 15px;
  color: var(--sm-text-secondary);
  margin: 0;
}

.playBtn {
  margin-top: 8px;
  align-self: flex-start;
  padding: 10px 24px;
  border-radius: var(--sm-radius-pill);
  background: var(--sm-accent);
  color: #fff;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 150ms, transform 150ms;
}

.playBtn:hover { opacity: 0.9; transform: scale(1.02); }

.dots {
  position: absolute;
  bottom: 16px;
  right: 24px;
  display: flex;
  gap: 6px;
  z-index: 2;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255,255,255,0.4);
  border: none;
  cursor: pointer;
  transition: background 200ms, transform 200ms;
}

.dot.dotActive { background: #fff; transform: scale(1.3); }
```

- [ ] **Step 7: 完成 `src/pages/ExplorePage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { usePlaylistStore } from '../stores/playlist'
import { HeroBanner } from '../components/Explore/HeroBanner'
import { CardRail } from '../components/Explore/CardRail'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { TrackRow } from '../components/Explore/TrackRow'
import type { Banner, Playlist, Track } from '../types/domain'
import styles from './ExplorePage.module.css'

export function ExplorePage() {
  const service = useMusicService()
  const [banners, setBanners] = useState<Banner[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [songs, setSongs] = useState<Track[]>([])

  useEffect(() => {
    void service.getRecommendBanners().then(setBanners).catch(() => {})
    void service.getRecommendPlaylists().then(setPlaylists).catch(() => {})
    void service.getNewSongs().then(setSongs).catch(() => {})
  }, [service])

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  return (
    <div className={styles.page}>
      {banners.length > 0 && <HeroBanner banners={banners} />}

      {playlists.length > 0 && (
        <CardRail title="推荐歌单">
          {playlists.map((pl, i) => (
            <PlaylistCard
              key={String(pl.id) + i}
              playlist={pl}
              onClick={() => playTrack(pl.tracks ?? [], 0)}
            />
          ))}
        </CardRail>
      )}

      {songs.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>今日推荐</h2>
          <div className={styles.trackList}>
            {songs.map((s, i) => (
              <TrackRow key={String(s.id) + i} track={s} index={i} onPlay={() => playTrack(songs, i)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 8: 创建 `src/pages/ExplorePage.module.css`**

```css
.page {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--sm-border) transparent;
}

.section { margin-bottom: 32px; }

.sectionTitle {
  font-size: 18px;
  font-weight: 700;
  color: var(--sm-text-primary);
  margin: 0 0 12px;
  padding: 0 24px;
}

.trackList { padding: 0 8px; }
```

- [ ] **Step 9: Typecheck + 视觉检查**

```bash
npm run typecheck
npm run dev
```
Expected: 探索页显示 Hero Banner + 歌单卡片轨道 + 推荐歌曲列表，hover 效果正常

- [ ] **Step 10: Commit**

```bash
git add src/pages/ExplorePage.tsx src/pages/ExplorePage.module.css src/components/Explore/
git commit -m "feat(explore): add ExplorePage with HeroBanner, CardRail, TrackRow"
```

---

## Task 10: 我的库页面

**Files:**
- Modify: `src/pages/LibraryPage.tsx`
- Create: `src/pages/LibraryPage.module.css`

**Interfaces:**
- Consumes: `useMusicService()`, `usePlaylistStore`, `useNavigationStore`
- Produces: 三子标签页（歌单/收藏/最近播放）+ 歌单点击进详情

- [ ] **Step 1: 完成 `src/pages/LibraryPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { usePlaylistStore } from '../stores/playlist'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { TrackRow } from '../components/Explore/TrackRow'
import type { Playlist, Track } from '../types/domain'
import styles from './LibraryPage.module.css'

type SubTab = 'playlists' | 'favorites' | 'recent'

export function LibraryPage() {
  const [tab, setTab] = useState<SubTab>('playlists')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [detail, setDetail] = useState<{ playlist: Playlist; tracks: Track[] } | null>(null)

  const service = useMusicService()
  const playlistsFromStore = usePlaylistStore((s) => s.playlists)

  useEffect(() => {
    setPlaylists(playlistsFromStore)
    if (playlistsFromStore.length === 0) {
      void usePlaylistStore.getState().loadUserPlaylists()
    }
  }, [playlistsFromStore])

  async function openPlaylist(playlist: Playlist) {
    const tracks = await service.getPlaylistDetail(playlist.id)
    setDetail({ playlist, tracks })
  }

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  if (detail) {
    return (
      <div className={styles.page}>
        <div className={styles.detailHeader}>
          <button className={`${styles.backBtn} no-drag`} onClick={() => setDetail(null)}>← 返回</button>
          <div className={styles.detailMeta}>
            {detail.playlist.cover && (
              <img className={styles.detailCover} src={detail.playlist.cover} alt="" />
            )}
            <div>
              <h1 className={styles.detailTitle}>{detail.playlist.name}</h1>
              <p className={styles.detailSub}>{detail.tracks.length} 首</p>
            </div>
          </div>
        </div>
        <div className={styles.trackList}>
          {detail.tracks.map((t, i) => (
            <TrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>我的库</h1>
        <div className={styles.subTabs}>
          {(['playlists', 'favorites', 'recent'] as SubTab[]).map((t) => (
            <button
              key={t}
              className={`${styles.subTab} no-drag ${tab === t ? styles.subTabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {{ playlists: '歌单', favorites: '收藏', recent: '最近播放' }[t]}
            </button>
          ))}
        </div>
      </div>

      {tab === 'playlists' && (
        <div className={styles.grid}>
          {playlists.map((pl, i) => (
            <PlaylistCard key={String(pl.id) + i} playlist={pl} onClick={() => void openPlaylist(pl)} />
          ))}
        </div>
      )}

      {tab === 'favorites' && (
        <div className={styles.emptyHint}>
          <p>收藏功能即将上线</p>
        </div>
      )}

      {tab === 'recent' && (
        <div className={styles.emptyHint}>
          <p>最近播放功能即将上线</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 创建 `src/pages/LibraryPage.module.css`**

```css
.page {
  height: 100%;
  overflow-y: auto;
  padding: 24px 24px 80px;
}

.header {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 24px;
}

.pageTitle { font-size: 24px; font-weight: 700; color: var(--sm-text-primary); margin: 0; }

.subTabs {
  display: flex;
  gap: 4px;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius-pill);
  padding: 3px;
}

.subTab {
  padding: 5px 14px;
  border-radius: var(--sm-radius-pill);
  background: none;
  border: none;
  color: var(--sm-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

.subTab:hover { color: var(--sm-text-primary); }
.subTab.subTabActive { background: var(--sm-bg-overlay); color: var(--sm-text-primary); }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 24px;
}

.trackList { padding: 0; }

.detailHeader { margin-bottom: 24px; }

.backBtn {
  background: none;
  border: none;
  color: var(--sm-accent);
  font-size: 14px;
  cursor: pointer;
  padding: 0 0 12px;
}

.detailMeta { display: flex; align-items: center; gap: 20px; }

.detailCover {
  width: 80px;
  height: 80px;
  border-radius: 12px;
  object-fit: cover;
}

.detailTitle { font-size: 22px; font-weight: 700; margin: 0 0 4px; color: var(--sm-text-primary); }
.detailSub { font-size: 13px; color: var(--sm-text-secondary); margin: 0; }

.emptyHint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--sm-text-secondary);
  font-size: 14px;
}
```

- [ ] **Step 3: Typecheck + 视觉检查**

```bash
npm run typecheck
npm run dev
```
Expected: 我的库显示歌单网格，子标签切换正常，点击歌单进入详情

- [ ] **Step 4: Commit**

```bash
git add src/pages/LibraryPage.tsx src/pages/LibraryPage.module.css
git commit -m "feat(library): add LibraryPage with playlist grid and sub-tabs"
```

---

## Task 11: 歌手页

**Files:**
- Modify: `src/pages/ArtistPage.tsx`
- Create: `src/pages/ArtistPage.module.css`
- Create: `src/components/Artist/ArtistHeader.tsx` + `.module.css`

**Interfaces:**
- Consumes: `useMusicService()`, `useNavigationStore.goBack()`
- Props: `ArtistPage({ id: unknown, source: 'netease' | 'qq' })`
- Produces: 完整歌手详情页（Hero header + 热门单曲/专辑/相似歌手）

- [ ] **Step 1: 创建 `src/components/Artist/ArtistHeader.tsx` + `.module.css`**

```tsx
import { useRef, useState } from 'react'
import type { ArtistInfo } from '../../types/domain'
import styles from './ArtistHeader.module.css'

function extractColor(img: HTMLImageElement): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 16; canvas.height = 16
    const ctx = canvas.getContext('2d')
    if (!ctx) return '#10141e'
    ctx.drawImage(img, 0, 0, 16, 16)
    const d = ctx.getImageData(4, 4, 8, 8).data
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++ }
    return `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`
  } catch { return '#10141e' }
}

interface ArtistHeaderProps {
  artist: ArtistInfo
  onPlayAll(): void
}

export function ArtistHeader({ artist, onPlayAll }: ArtistHeaderProps) {
  const [bgColor, setBgColor] = useState('#10141e')
  const imgRef = useRef<HTMLImageElement>(null)

  return (
    <div className={styles.header} style={{ '--artist-bg': bgColor } as React.CSSProperties}>
      <div className={styles.bg} />
      <div className={styles.content}>
        {artist.avatar && (
          <img
            ref={imgRef}
            className={styles.avatar}
            src={artist.avatar}
            alt=""
            crossOrigin="anonymous"
            onLoad={() => { if (imgRef.current) setBgColor(extractColor(imgRef.current)) }}
          />
        )}
        <div className={styles.info}>
          <h1 className={styles.name}>{artist.name}</h1>
          <p className={styles.meta}>
            {artist.musicSize ? `${artist.musicSize} 首单曲` : ''}
          </p>
          <button className={`${styles.playAll} no-drag`} onClick={onPlayAll}>▶ 播放全部</button>
        </div>
      </div>
    </div>
  )
}
```

```css
/* ArtistHeader.module.css */
.header {
  position: relative;
  height: 240px;
  overflow: hidden;
  flex-shrink: 0;
}

.bg {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 20% 50%, var(--artist-bg, #10141e) 0%, var(--sm-bg-base) 100%);
  transition: background 600ms var(--sm-ease-in-out);
}

.content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 28px;
  height: 100%;
  padding: 32px 48px;
}

.avatar {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 8px 40px rgba(0,0,0,0.4);
  flex-shrink: 0;
}

.info { display: flex; flex-direction: column; gap: 6px; }

.name { font-size: 32px; font-weight: 800; color: var(--sm-text-primary); margin: 0; }

.meta { font-size: 14px; color: var(--sm-text-secondary); margin: 0; }

.playAll {
  margin-top: 4px;
  align-self: flex-start;
  padding: 8px 20px;
  border-radius: var(--sm-radius-pill);
  background: var(--sm-accent);
  color: #fff;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 150ms;
}

.playAll:hover { opacity: 0.88; }
```

- [ ] **Step 2: 完成 `src/pages/ArtistPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { useNavigationStore } from '../stores/navigation'
import { usePlaylistStore } from '../stores/playlist'
import { ArtistHeader } from '../components/Artist/ArtistHeader'
import { TrackRow } from '../components/Explore/TrackRow'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { CardRail } from '../components/Explore/CardRail'
import type { ArtistInfo, Track, Playlist } from '../types/domain'
import styles from './ArtistPage.module.css'

type ArtistTab = 'songs' | 'albums'

interface ArtistPageProps {
  id: unknown
  source: 'netease' | 'qq'
}

export function ArtistPage({ id }: ArtistPageProps) {
  const [artist, setArtist] = useState<ArtistInfo | null>(null)
  const [songs, setSongs] = useState<Track[]>([])
  const [albums, setAlbums] = useState<Playlist[]>([])
  const [tab, setTab] = useState<ArtistTab>('songs')
  const service = useMusicService()
  const goBack = useNavigationStore((s) => s.goBack)

  useEffect(() => {
    setArtist(null); setSongs([]); setAlbums([])
    void service.getArtistDetail(id).then(setArtist).catch(() => {})
    void service.getArtistSongs(id).then(setSongs).catch(() => {})
    void service.getArtistAlbums(id).then(setAlbums).catch(() => {})
  }, [id, service])

  function playAll() {
    if (songs.length) usePlaylistStore.getState().setQueue(songs, 0)
  }

  function playTrack(index: number) {
    usePlaylistStore.getState().setQueue(songs, index)
  }

  return (
    <div className={styles.page}>
      <button className={`${styles.back} no-drag`} onClick={goBack}>← 返回</button>

      {artist && <ArtistHeader artist={artist} onPlayAll={playAll} />}

      <div className={styles.subTabs}>
        {(['songs', 'albums'] as ArtistTab[]).map((t) => (
          <button
            key={t}
            className={`${styles.subTab} no-drag ${tab === t ? styles.active : ''}`}
            onClick={() => setTab(t)}
          >
            {{ songs: '热门单曲', albums: '专辑' }[t]}
          </button>
        ))}
      </div>

      {tab === 'songs' && (
        <div className={styles.trackList}>
          {songs.map((s, i) => (
            <TrackRow key={String(s.id) + i} track={s} index={i} onPlay={() => playTrack(i)} />
          ))}
        </div>
      )}

      {tab === 'albums' && albums.length > 0 && (
        <CardRail title="">
          {albums.map((a, i) => (
            <PlaylistCard key={String(a.id) + i} playlist={a} onClick={() => {}} />
          ))}
        </CardRail>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 创建 `src/pages/ArtistPage.module.css`**

```css
.page { height: 100%; overflow-y: auto; }

.back {
  display: block;
  background: none;
  border: none;
  color: var(--sm-accent);
  font-size: 14px;
  cursor: pointer;
  padding: 12px 24px;
}

.subTabs {
  display: flex;
  gap: 4px;
  padding: 16px 24px 0;
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border-bottom: 1px solid var(--sm-border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.subTab {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--sm-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: color 150ms, border-color 150ms;
}

.subTab.active { color: var(--sm-accent); border-bottom-color: var(--sm-accent); }

.trackList { padding: 8px; }
```

- [ ] **Step 4: Typecheck + 视觉检查**

```bash
npm run typecheck
npm run dev
```
搜索一个歌手，从搜索结果点击歌手名，确认导航到歌手页并显示正确内容

- [ ] **Step 5: Commit**

```bash
git add src/pages/ArtistPage.tsx src/pages/ArtistPage.module.css src/components/Artist/
git commit -m "feat(artist): add ArtistPage with header, songs, albums tabs"
```

---

## Task 12: 设置页重设计

**Files:**
- Modify: `src/pages/SettingsPage.tsx`
- Create: `src/pages/SettingsPage.module.css`

**Interfaces:**
- Consumes: `useSettingsStore` (themeMode, activeSource, audioQuality, setThemeMode, setActiveSource, setAudioQuality, neteaseLoggedIn)

- [ ] **Step 1: 完成 `src/pages/SettingsPage.tsx`**

```tsx
import { useSettingsStore } from '../stores/settings'
import styles from './SettingsPage.module.css'

type ThemeMode = 'auto' | 'light' | 'dark'
type AudioQuality = 'standard' | 'higher' | 'exhigh' | 'lossless'

export function SettingsPage() {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)
  const audioQuality = useSettingsStore((s) => s.audioQuality)
  const setAudioQuality = useSettingsStore((s) => s.setAudioQuality)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>设置</h1>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>账户</h2>
        <div className={styles.row}>
          <div className={styles.rowIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
            </svg>
          </div>
          <span className={styles.rowLabel}>{neteaseLoggedIn ? '已登录网易云' : '未登录'}</span>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>外观</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>主题模式</span>
          <div className={styles.segControl}>
            {(['auto', 'light', 'dark'] as ThemeMode[]).map((m) => (
              <button
                key={m}
                className={`${styles.seg} no-drag ${themeMode === m ? styles.segActive : ''}`}
                onClick={() => setThemeMode(m)}
              >
                {{ auto: '自动', light: '浅色', dark: '深色' }[m]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>音乐</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>音源</span>
          <div className={styles.segControl}>
            {(['netease', 'qq'] as const).map((s) => (
              <button
                key={s}
                className={`${styles.seg} no-drag ${activeSource === s ? styles.segActive : ''}`}
                onClick={() => setActiveSource(s)}
              >
                {{ netease: '网易云', qq: 'QQ 音乐' }[s]}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>音质偏好</span>
          <div className={styles.segControl}>
            {(['standard', 'higher', 'exhigh', 'lossless'] as AudioQuality[]).map((q) => (
              <button
                key={q}
                className={`${styles.seg} no-drag ${audioQuality === q ? styles.segActive : ''}`}
                onClick={() => setAudioQuality(q)}
              >
                {{ standard: '标准', higher: '高品质', exhigh: '极高', lossless: '无损' }[q]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>关于</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>SimpleMusic</span>
          <span className={styles.rowValue}>v1.0.0</span>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: 创建 `src/pages/SettingsPage.module.css`**

```css
.page {
  height: 100%;
  overflow-y: auto;
  padding: 24px 24px 80px;
  max-width: 640px;
}

.title { font-size: 24px; font-weight: 700; color: var(--sm-text-primary); margin: 0 0 24px; }

.group {
  background: var(--sm-bg-elevated);
  backdrop-filter: var(--sm-blur);
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius-card);
  margin-bottom: 16px;
  overflow: hidden;
}

.groupTitle {
  font-size: 11px;
  font-weight: 600;
  color: var(--sm-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 12px 16px 8px;
  margin: 0;
  border-bottom: 1px solid var(--sm-border);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  gap: 16px;
  border-bottom: 1px solid var(--sm-border);
}

.row:last-child { border-bottom: none; }

.rowIcon { color: var(--sm-text-secondary); display: flex; align-items: center; }

.rowLabel { font-size: 14px; color: var(--sm-text-primary); flex: 1; }

.rowValue { font-size: 13px; color: var(--sm-text-secondary); }

.segControl {
  display: flex;
  gap: 2px;
  background: var(--sm-bg-base);
  border: 1px solid var(--sm-border);
  border-radius: var(--sm-radius-pill);
  padding: 2px;
}

.seg {
  padding: 4px 12px;
  border-radius: var(--sm-radius-pill);
  background: none;
  border: none;
  font-size: 12px;
  color: var(--sm-text-secondary);
  cursor: pointer;
  transition: background 150ms, color 150ms;
  white-space: nowrap;
}

.seg:hover { color: var(--sm-text-primary); }
.seg.segActive { background: var(--sm-bg-overlay); color: var(--sm-text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
```

- [ ] **Step 3: Typecheck + 视觉检查**

```bash
npm run typecheck
npm run dev
```
切换「设置」标签，验证主题模式切换能改变 app 外观

- [ ] **Step 4: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.module.css
git commit -m "feat(settings): redesign settings page with grouped controls"
```

---

## Task 13: PlayerBar 歌手名可点击导航

**Files:**
- Modify: `src/components/Player/TrackInfo.tsx`
- Modify: `src/components/Player/TrackInfo.module.css`

**Interfaces:**
- Consumes: `useNavigationStore.navigateTo()`, `usePlayerStore` (current track)
- Produces: 歌手名变为可点击链接，点击 → 跳转歌手页

- [ ] **Step 1: 修改 `src/components/Player/TrackInfo.tsx`**

读取当前 TrackInfo.tsx 内容后，在歌手名渲染处改为可点击 button：

找到渲染 `track.artist` 的位置，改为：
```tsx
import { useNavigationStore } from '../../stores/navigation'
import { usePlayerStore } from '../../stores/player'

// 在组件内：
const navigateTo = useNavigationStore((s) => s.navigateTo)
const track = usePlayerStore((s) => s.currentTrack)

// 歌手名渲染改为：
<button
  className={`${styles.artist} no-drag`}
  onClick={() => {
    if (track?.artistId) {
      navigateTo({ type: 'artist', id: track.artistId, source: track.source ?? 'netease' })
    }
  }}
  style={{ cursor: track?.artistId ? 'pointer' : 'default' }}
>
  {track?.artist ?? ''}
</button>
```

- [ ] **Step 2: 在 `TrackInfo.module.css` 添加歌手按钮样式**

```css
.artist {
  background: none;
  border: none;
  padding: 0;
  color: var(--sm-text-secondary);
  font-size: 12px;
  text-align: left;
  transition: color 150ms;
}

.artist:hover { color: var(--sm-accent); }
```

（保留或覆盖已有 `.artist` 样式，确保不破坏现有布局）

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/components/Player/TrackInfo.tsx src/components/Player/TrackInfo.module.css
git commit -m "feat(player): make artist name clickable to navigate to artist page"
```

---

## Task 14: 动画 Polish — 页面过渡 + 滚动进入

**Files:**
- Modify: `src/components/Layout/AppShell.tsx`
- Modify: `src/components/Layout/AppShell.module.css`
- Modify: `src/styles/tokens.css`（已有，补 keyframes）

**Interfaces:**
- Produces: 页面切换淡入动画 + 卡片滚动进入动画

- [ ] **Step 1: 在 AppShell.module.css 添加页面过渡动画**

在 `AppShell.module.css` 末尾添加：
```css
.pageEnter {
  animation: pageEnter 220ms var(--sm-ease-out) forwards;
}

@keyframes pageEnter {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: 在 AppShell.tsx 给渲染的页面加动画 key**

```tsx
const viewKey = typeof view === 'string' ? view : `${view.type}-${String(view.id)}`

return (
  <div className={styles.shell}>
    <Suspense fallback={<div className={styles.loading} />}>
      <div key={viewKey} className={styles.pageEnter}>
        {renderPage()}
      </div>
    </Suspense>
  </div>
)
```

- [ ] **Step 3: 创建通用 useScrollReveal hook**

创建 `src/hooks/useScrollReveal.ts`：
```ts
import { useEffect, useRef } from 'react'

export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.style.opacity = '1'
          el.style.transform = 'translateY(0)'
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    el.style.opacity = '0'
    el.style.transform = 'translateY(20px)'
    el.style.transition = 'opacity 320ms var(--sm-ease-out), transform 320ms var(--sm-ease-out)'
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}
```

- [ ] **Step 4: 在 CardRail 和 ExplorePage section 应用 useScrollReveal**

在 `CardRail.tsx` 的 `.section` 元素上：
```tsx
import { useScrollReveal } from '../../hooks/useScrollReveal'

export function CardRail({ title, children }: CardRailProps) {
  const ref = useScrollReveal<HTMLElement>()
  return (
    <section className={styles.section} ref={ref}>
      ...
    </section>
  )
}
```

- [ ] **Step 5: Typecheck + 视觉检查**

```bash
npm run typecheck
npm run dev
```
切换标签页时观察淡入动画，向下滚动探索页观察区块逐一出现效果

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout/AppShell.tsx src/components/Layout/AppShell.module.css src/hooks/useScrollReveal.ts src/components/Explore/CardRail.tsx
git commit -m "feat(animation): add page transition and scroll-reveal animations"
```

---

## 自检：Spec 覆盖率

| Spec 需求 | 覆盖 Task |
|---|---|
| App 重命名 SimpleMusic v1.0.0 | Task 1 |
| CSS token + 浅色/深色模式 | Task 2 |
| Settings: activeSource, themeMode, audioQuality | Task 3 |
| MusicService 统一接口 + Banner 类型 | Task 4 |
| 服务端 banner/artist/recommend 端点 | Task 5 |
| NeteaseMusicService + QQMusicService 存根 | Task 6 |
| Navigation store + AppShell | Task 7 |
| TitleBar: SearchPill + 居中标签 + SourceSwitcher | Task 8 |
| 探索页: HeroBanner + CardRail + TrackRow | Task 9 |
| 我的库: 歌单网格 + 子标签 + 详情 | Task 10 |
| 歌手页（新功能）| Task 11 |
| 设置页重设计 | Task 12 |
| PlayerBar 歌手名导航 | Task 13 |
| 动画系统（过渡 + 滚动进入） | Task 14 |
| ShelfScene 移出主 UI | Task 7（App.tsx 重构时移除） |
| prefers-reduced-motion | Task 2（tokens.css）|
