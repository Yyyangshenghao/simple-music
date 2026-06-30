# Animated Track List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有歌曲列表添加滚动进入/离开动画（scale + opacity），使用 motion 的 useInView + 渐变遮罩

**Architecture:** 创建 AnimatedTrackRow 包装现有 TrackRow，用 motion.div + useInView 实现每个 item 独立的视口检测；渐变遮罩通过 position:sticky 放在页面滚动容器内

**Tech Stack:** React 18, TypeScript, motion v12, CSS Modules

## Global Constraints

- motion v12.42.1 已安装，从 `motion/react` 导入
- CSS 变量 `--sm-bg-base` 用于渐变颜色（深色 #0c0c0c / 浅色 #f0f0f0）
- 不引入新依赖
- 保持现有 TrackRow 不变，通过包装组件扩展

---

### Task 1: 创建共享渐变 CSS

**Files:**
- Create: `src/styles/scroll-gradients.css`
- Modify: `src/main.tsx` — 添加全局 CSS import

**Interfaces:**
- Produces: `.topGradient` / `.bottomGradient` 全局 CSS 类名（非 CSS Module）

- [ ] **Step 1: 写 CSS 文件**

文件: `src/styles/scroll-gradients.css`

```css
/* 页面滚动容器内的渐变遮罩。配合 position: sticky 使用，
   通过 height:0 + 伪元素 absolute 实现不占流的覆盖层。 */

.topGradient {
  position: sticky;
  top: 0;
  height: 0;
  z-index: 1;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.topGradient::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50px;
  background: linear-gradient(to bottom, var(--sm-bg-base), transparent);
  pointer-events: none;
}

.bottomGradient {
  position: sticky;
  bottom: 0;
  height: 0;
  z-index: 1;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.bottomGradient::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 100px;
  background: linear-gradient(to top, var(--sm-bg-base), transparent);
  pointer-events: none;
}
```

- [ ] **Step 2: 在 main.tsx 中导入全局 CSS**

在 `src/main.tsx` 顶部 import 区域添加：

```tsx
import './styles/scroll-gradients.css'
```

具体位置：在现有 `import './styles/tokens.css'` 附近。

- [ ] **Step 3: 提交**

```bash
git add src/styles/scroll-gradients.css src/main.tsx
git commit -m "feat: add shared scroll gradient overlay styles"
```

---

### Task 2: 创建 AnimatedTrackRow 组件

**Files:**
- Create: `src/components/Explore/AnimatedTrackRow.tsx`
- Create: `src/components/Explore/AnimatedTrackRow.module.css`

**Interfaces:**
- Consumes: `Track` from `../../types/domain`, `TrackRow` from `./TrackRow`
- Produces: `<AnimatedTrackRow track={Track} index={number} onPlay={()=>void} delay={number?} />`

- [ ] **Step 1: 创建 CSS Module**

文件: `src/components/Explore/AnimatedTrackRow.module.css`

```css
.wrapper {
  margin-bottom: 4px;
  cursor: pointer;
}
```

- [ ] **Step 2: 创建组件**

文件: `src/components/Explore/AnimatedTrackRow.tsx`

```tsx
import { useRef } from 'react'
import { motion, useInView } from 'motion/react'
import type { Track } from '../../types/domain'
import { TrackRow } from './TrackRow'
import styles from './AnimatedTrackRow.module.css'

interface AnimatedTrackRowProps {
  track: Track
  index: number
  onPlay(): void
  delay?: number
}

export function AnimatedTrackRow({ track, index, onPlay, delay = 0.1 }: AnimatedTrackRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.5, triggerOnce: false })

  return (
    <motion.div
      ref={ref}
      className={styles.wrapper}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={inView ? { scale: 1, opacity: 1 } : { scale: 0.7, opacity: 0 }}
      transition={{ duration: 0.2, delay }}
    >
      <TrackRow track={track} index={index} onPlay={onPlay} />
    </motion.div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add src/components/Explore/AnimatedTrackRow.tsx src/components/Explore/AnimatedTrackRow.module.css
git commit -m "feat: add AnimatedTrackRow component with scroll-driven scale/fade"
```

---

### Task 3: 更新 ExplorePage

**Files:**
- Modify: `src/pages/ExplorePage.tsx`
- Modify: `src/pages/ExplorePage.module.css`

**Interfaces:**
- Consumes: `AnimatedTrackRow` from `../components/Explore/AnimatedTrackRow`
- Changes: 2处 `TrackRow` → `AnimatedTrackRow`，添加渐变层 + scroll 处理

- [ ] **Step 1: 更新 ExplorePage.module.css**

给 `.page` 添加 `position: relative`（渐变 sticky 定位需要）：

```css
.page {
  position: relative;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--sm-border) transparent;
}
/* 其余样式不变 */
```

- [ ] **Step 2: 更新 ExplorePage.tsx**

改动点：
1. import `AnimatedTrackRow` 替代 `TrackRow`
2. 添加 `useRef`, `useCallback` 管理滚动渐变状态
3. 两个列表（今日推荐 + 歌单详情）的 `TrackRow` 改为 `AnimatedTrackRow`
4. `.page` 内添加渐变 div + onScroll

完整改动后的文件：

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { usePlaylistStore } from '../stores/playlist'
import { HeroBanner } from '../components/Explore/HeroBanner'
import { CardRail } from '../components/Explore/CardRail'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { AnimatedTrackRow } from '../components/Explore/AnimatedTrackRow'
import type { Banner, Playlist, Track } from '../types/domain'
import styles from './ExplorePage.module.css'

export function ExplorePage() {
  const service = useMusicService()
  const [banners, setBanners] = useState<Banner[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [songs, setSongs] = useState<Track[]>([])
  const [detail, setDetail] = useState<{ playlist: Playlist; tracks: Track[] } | null>(null)
  const [loadingId, setLoadingId] = useState<unknown>(null)

  // 渐变遮罩状态
  const [topOpacity, setTopOpacity] = useState(0)
  const [bottomOpacity, setBottomOpacity] = useState(0)

  useEffect(() => {
    void service.getRecommendBanners().then(setBanners).catch(() => {})
    void service.getRecommendPlaylists().then(setPlaylists).catch(() => {})
    void service.getNewSongs().then(setSongs).catch(() => {})
  }, [service])

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  async function openPlaylist(pl: Playlist) {
    setLoadingId(pl.id)
    try {
      const tracks = await service.getPlaylistDetail(pl.id)
      setDetail({ playlist: pl, tracks })
    } finally {
      setLoadingId(null)
    }
  }

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    setTopOpacity(Math.min(scrollTop / 50, 1))
    const bottomDistance = scrollHeight - (scrollTop + clientHeight)
    setBottomOpacity(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 50, 1))
  }, [])

  if (detail) {
    return (
      <div className={styles.page} onScroll={handleScroll}>
        <div className="topGradient" style={{ opacity: topOpacity }} />
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
            <AnimatedTrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} />
          ))}
        </div>
        <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
      </div>
    )
  }

  return (
    <div className={styles.page} onScroll={handleScroll}>
      <div className="topGradient" style={{ opacity: topOpacity }} />

      {banners.length > 0 && <HeroBanner banners={banners} />}

      {playlists.length > 0 && (
        <CardRail title="推荐歌单">
          {playlists.map((pl, i) => (
            <PlaylistCard
              key={String(pl.id) + i}
              playlist={pl}
              onClick={() => { if (!loadingId) void openPlaylist(pl) }}
            />
          ))}
        </CardRail>
      )}

      {songs.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>今日推荐</h2>
          <div className={styles.trackList}>
            {songs.map((s, i) => (
              <AnimatedTrackRow key={String(s.id) + i} track={s} index={i} onPlay={() => playTrack(songs, i)} />
            ))}
          </div>
        </section>
      )}

      <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add src/pages/ExplorePage.tsx src/pages/ExplorePage.module.css
git commit -m "feat: add scroll animation and gradients to ExplorePage"
```

---

### Task 4: 更新 LibraryPage

**Files:**
- Modify: `src/pages/LibraryPage.tsx`
- Modify: `src/pages/LibraryPage.module.css`

**Interfaces:**
- Consumes: `AnimatedTrackRow` from `../components/Explore/AnimatedTrackRow`
- Changes: 歌单详情列表 `TrackRow` → `AnimatedTrackRow`，添加渐变层

- [ ] **Step 1: 更新 LibraryPage.module.css**

给 `.page` 添加 `position: relative`（渐变 sticky 定位需要）：

```css
.page {
  position: relative;
  height: 100%;
  overflow-y: auto;
  padding: 24px 24px 80px;
}
/* 其余样式不变 */
```

- [ ] **Step 2: 更新 LibraryPage.tsx**

改动点：
1. import `AnimatedTrackRow` 替代 `TrackRow`
2. 添加 `useCallback` 管理滚动渐变状态
3. 歌单详情列表的 `TrackRow` 改为 `AnimatedTrackRow`
4. `.page` 内添加渐变 div + onScroll

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useMusicService } from '../hooks/useMusicService'
import { usePlaylistStore } from '../stores/playlist'
import { PlaylistCard } from '../components/Explore/PlaylistCard'
import { AnimatedTrackRow } from '../components/Explore/AnimatedTrackRow'
import type { Playlist, Track } from '../types/domain'
import styles from './LibraryPage.module.css'

type SubTab = 'playlists' | 'favorites' | 'recent'

export function LibraryPage() {
  const [tab, setTab] = useState<SubTab>('playlists')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [detail, setDetail] = useState<{ playlist: Playlist; tracks: Track[] } | null>(null)
  const [loadingId, setLoadingId] = useState<unknown>(null)

  // 渐变遮罩状态
  const [topOpacity, setTopOpacity] = useState(0)
  const [bottomOpacity, setBottomOpacity] = useState(0)

  const service = useMusicService()
  const playlistsFromStore = usePlaylistStore((s) => s.playlists)

  useEffect(() => {
    setPlaylists(playlistsFromStore)
    if (playlistsFromStore.length === 0) {
      void usePlaylistStore.getState().loadUserPlaylists()
    }
  }, [playlistsFromStore])

  async function openPlaylist(playlist: Playlist) {
    setLoadingId(playlist.id)
    try {
      const tracks = await service.getPlaylistDetail(playlist.id)
      setDetail({ playlist, tracks })
    } finally {
      setLoadingId(null)
    }
  }

  function playTrack(list: Track[], index: number) {
    usePlaylistStore.getState().setQueue(list, index)
  }

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    setTopOpacity(Math.min(scrollTop / 50, 1))
    const bottomDistance = scrollHeight - (scrollTop + clientHeight)
    setBottomOpacity(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 50, 1))
  }, [])

  if (detail) {
    return (
      <div className={styles.page} onScroll={handleScroll}>
        <div className="topGradient" style={{ opacity: topOpacity }} />
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
            <AnimatedTrackRow key={String(t.id) + i} track={t} index={i} onPlay={() => playTrack(detail.tracks, i)} />
          ))}
        </div>
        <div className="bottomGradient" style={{ opacity: bottomOpacity }} />
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
            <PlaylistCard
              key={String(pl.id) + i}
              playlist={pl}
              onClick={() => { if (!loadingId) void openPlaylist(pl) }}
            />
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

**注意**: LibraryPage 主视图（歌单 grid / 收藏 / 最近播放）没有曲目列表，不需要渐变。只有进入歌单详情（`if (detail)` 分支）时才需要渐变动画。

- [ ] **Step 3: 提交**

```bash
git add src/pages/LibraryPage.tsx src/pages/LibraryPage.module.css
git commit -m "feat: add scroll animation and gradients to LibraryPage detail view"
```

---

### Task 5: 验证

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 2: 手动验证 ExplorePage**
  - 打开首页，滚动到"今日推荐"区域
  - 确认歌曲行进入视口时有 scale 0.7→1 + opacity 0→1 动画
  - 确认滚动离开视口后重新进入时动画再次触发
  - 确认顶部和底部渐变遮罩随滚动位置平滑过渡
  - 点击歌单进入详情页，同样验证

- [ ] **Step 3: 手动验证 LibraryPage**
  - 切换到"我的库"，点击一个歌单进入详情
  - 上下滚动歌曲列表，确认动画正常
  - 确认渐变遮罩正常

- [ ] **Step 4: 边界情况检查**
  - 今日推荐为空时（无 songs），页面不报错
  - 歌单详情歌曲不足一屏时，底部渐变 opacity 为 0
  - 快速滚动时动画流畅，无卡顿
