# TopBar 布局重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有左侧竖向图标条替换为横向 TopBar，启用 macOS 原生 traffic lights，并把来源切换/账号设置收进头像下拉菜单。

**Architecture:** 保留 WindowChrome 容器但去掉玻璃效果，Electron 窗口改为 `titleBarStyle: 'hiddenInset'`。新增 `TopBar`（搜索 + 导航 Tab + 头像）和 `AvatarMenu`（来源切换 + 账号设置 + 设置入口）两个独立组件，替换整个 LeftStrip 及其 modules。

**Tech Stack:** Electron 29+, React 18, Zustand, CSS Modules, Vitest

## Global Constraints

- 不引入任何新依赖
- 所有交互元素必须设 `-webkit-app-region: no-drag`，TopBar 其余区域设 `drag`
- 只用现有 CSS token（`--sm-bg-*`, `--sm-accent`, `--sm-text-*`, `--sm-border`, `--sm-ease-out`）
- TypeScript 严格模式，不允许 `any`
- 不改动 PlayerBar、AppShell 内部页面、歌词面板

---

## File Map

| 状态 | 路径 | 职责 |
|------|------|------|
| **修改** | `electron/modules/window-manager.ts` | 改 titleBarStyle，去掉 frame/transparent |
| **修改** | `electron/ipc/window.ts` | 添加 window:maximize 处理器 |
| **修改** | `electron/preload/index.ts` | 暴露 maximize 方法 |
| **修改** | `src/components/Layout/WindowChrome.tsx` | 简化，去掉 isFocused 订阅 |
| **修改** | `src/components/Layout/WindowChrome.module.css` | 去玻璃效果，改纯色背景 |
| **新建** | `src/components/Layout/TopBar.tsx` | 导航 Tab + 后退 + 搜索 + 头像按钮 |
| **新建** | `src/components/Layout/TopBar.module.css` | TopBar 样式 |
| **新建** | `src/components/Layout/AvatarMenu.tsx` | 头像下拉：来源 + 账号 + 设置 |
| **新建** | `src/components/Layout/AvatarMenu.module.css` | AvatarMenu 样式 |
| **修改** | `src/App.tsx` | 用 TopBar 替换 LeftStrip，去掉 content 包裹 |
| **修改** | `src/App.module.css` | 去掉 .content 规则 |
| **删除** | `src/components/Layout/LeftStrip.tsx` + `.css` | 全部废弃 |
| **删除** | `src/components/Layout/modules/NavModule.tsx` + `.css` | 逻辑迁入 TopBar |
| **删除** | `src/components/Layout/modules/SearchModule.tsx` + `.css` | 逻辑迁入 TopBar |
| **删除** | `src/components/Layout/modules/SourceModule.tsx` + `.css` | 逻辑迁入 AvatarMenu |
| **删除** | `src/components/Layout/modules/AccountModule.tsx` + `.css` | 逻辑迁入 AvatarMenu |
| **删除** | `src/components/Layout/modules/useHoverPanel.ts` | hover panel 模式废弃 |

---

## Task 1: Electron 窗口配置 + IPC

**Files:**
- Modify: `electron/modules/window-manager.ts:201-221`
- Modify: `electron/ipc/window.ts`
- Modify: `electron/preload/index.ts`

**Interfaces:**
- Produces: `window.desktop.maximize(): Promise<void>` 可在渲染层调用

- [ ] **Step 1: 修改 window-manager.ts**

将 `createMainWindow` 函数中的 `BrowserWindow` 配置（约第 201 行）从：

```ts
mainWindow = new BrowserWindow({
  ...initialBounds,
  minWidth: MIN_WINDOWED_WIDTH,
  minHeight: MIN_WINDOWED_HEIGHT,
  show: false,
  frame: false,
  fullscreen: false,
  transparent: true,
  backgroundColor: '#00000000',
  hasShadow: true,
  autoHideMenuBar: true,
  title: APP_NAME,
  webPreferences: {
    preload: join(import.meta.dirname, '../preload/index.mjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: false,
    additionalArguments: [`--mineradio-server-port=${serverPort}`]
  }
})
```

改为：

```ts
mainWindow = new BrowserWindow({
  ...initialBounds,
  minWidth: MIN_WINDOWED_WIDTH,
  minHeight: MIN_WINDOWED_HEIGHT,
  show: false,
  titleBarStyle: 'hiddenInset',
  trafficLightPosition: { x: 16, y: 14 },
  fullscreen: false,
  backgroundColor: '#0a101c',
  hasShadow: true,
  autoHideMenuBar: true,
  title: APP_NAME,
  webPreferences: {
    preload: join(import.meta.dirname, '../preload/index.mjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: false,
    additionalArguments: [`--mineradio-server-port=${serverPort}`]
  }
})
```

- [ ] **Step 2: 在 electron/ipc/window.ts 添加 maximize 处理器**

在 `registerWindowIpc` 函数的 `window:close` 处理器之后添加：

```ts
ipcMain.handle('window:maximize', () => {
  const win = getMainWindow()
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
```

- [ ] **Step 3: 在 electron/preload/index.ts 暴露 maximize**

在 `close: (): Promise<void> => ipcRenderer.invoke('window:close'),` 这一行之后添加：

```ts
maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
```

- [ ] **Step 4: 类型检查**

```bash
npx tsc --noEmit
```

期望输出：无错误（或仅已有的不相关警告）。

- [ ] **Step 5: Commit**

```bash
git add electron/modules/window-manager.ts electron/ipc/window.ts electron/preload/index.ts
git commit -m "feat(electron): switch to titleBarStyle hiddenInset, add window:maximize IPC"
```

---

## Task 2: WindowChrome 简化

**Files:**
- Modify: `src/components/Layout/WindowChrome.tsx`
- Modify: `src/components/Layout/WindowChrome.module.css`

**Interfaces:**
- Consumes: `useWindowStore((s) => s.isFullScreen)` — 仅保留全屏订阅
- Produces: 简化的 `.chrome` 容器（纯色背景，无玻璃效果）

- [ ] **Step 1: 修改 WindowChrome.tsx**

将全文替换为：

```tsx
import type { ReactNode } from 'react'
import { useWindowStore } from '../../stores/window'
import styles from './WindowChrome.module.css'

interface WindowChromeProps {
  children: ReactNode
}

export function WindowChrome({ children }: WindowChromeProps) {
  const isFullScreen = useWindowStore((s) => s.isFullScreen)
  return (
    <div className={`${styles.chrome}${isFullScreen ? ` ${styles.fullScreen}` : ''}`}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: 修改 WindowChrome.module.css**

将全文替换为：

```css
.chrome {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--sm-bg-base);
}

.fullScreen {
  /* 全屏时已铺满整屏，无需额外覆盖 */
}
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit
```

期望：无新增错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/WindowChrome.tsx src/components/Layout/WindowChrome.module.css
git commit -m "refactor(chrome): simplify WindowChrome to plain dark background"
```

---

## Task 3: TopBar 组件

**Files:**
- Create: `src/components/Layout/TopBar.tsx`
- Create: `src/components/Layout/TopBar.module.css`

**Interfaces:**
- Consumes:
  - `useNavigationStore((s) => s.currentView)` — `AppView`
  - `useNavigationStore((s) => s.history)` — `AppView[]`
  - `useNavigationStore((s) => s.navigateTo)` — `(view: AppView) => void`
  - `useNavigationStore((s) => s.goBack)` — `() => void`
  - `useMusicService()` — `MusicService`（有 `.searchTracks(q: string)` 和 `.searchArtists(q: string)`）
  - `usePlaylistStore.getState().setQueue(songs, index)` — 选歌播放
  - `AvatarMenu` 组件（Task 4 产出）
- Produces: `export function TopBar(): JSX.Element`

- [ ] **Step 1: 创建 TopBar.tsx**

```tsx
import { useState, useRef } from 'react'
import type { FormEvent } from 'react'
import { useNavigationStore } from '../../stores/navigation'
import type { AppView } from '../../stores/navigation'
import { useMusicService } from '../../hooks/useMusicService'
import { usePlaylistStore } from '../../stores/playlist'
import type { Track, ArtistInfo } from '../../types/domain'
import { AvatarMenu } from './AvatarMenu'
import styles from './TopBar.module.css'

const NAV_TABS: { view: AppView; label: string }[] = [
  { view: 'explore', label: '探索' },
  { view: 'library', label: '我的库' },
]

export function TopBar() {
  const currentView = useNavigationStore((s) => s.currentView)
  const history = useNavigationStore((s) => s.history)
  const navigateTo = useNavigationStore((s) => s.navigateTo)
  const goBack = useNavigationStore((s) => s.goBack)

  const [keyword, setKeyword] = useState('')
  const [songs, setSongs] = useState<Track[]>([])
  const [artists, setArtists] = useState<ArtistInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const service = useMusicService()

  async function runSearch() {
    const q = keyword.trim()
    if (!q || loading) return
    setLoading(true)
    try {
      const [s, a] = await Promise.allSettled([
        service.searchTracks(q),
        service.searchArtists(q),
      ])
      setSongs(s.status === 'fulfilled' ? s.value : [])
      setArtists(a.status === 'fulfilled' ? a.value : [])
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void runSearch()
  }

  function clearSearch() {
    setKeyword('')
    setSongs([])
    setArtists([])
  }

  function pickSong(index: number) {
    usePlaylistStore.getState().setQueue(songs, index)
    clearSearch()
    inputRef.current?.blur()
  }

  function pickArtist(artist: ArtistInfo) {
    navigateTo({ type: 'artist', id: artist.id, source: artist.source })
    clearSearch()
    inputRef.current?.blur()
  }

  const hasResults = songs.length > 0 || artists.length > 0
  const showDropdown = searchFocused && (keyword.length > 0 || loading || hasResults)

  return (
    <div className={styles.bar}>
      {/* Left: traffic lights 留白 + 后退按钮 */}
      <div className={styles.left}>
        <button
          className={styles.backBtn}
          onClick={goBack}
          disabled={history.length === 0}
          aria-label="后退"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* Center: 导航 Tab（绝对居中） */}
      <div className={styles.center}>
        {NAV_TABS.map((tab) => (
          <button
            key={tab.view as string}
            className={`${styles.tab} ${currentView === tab.view ? styles.tabActive : ''}`}
            onClick={() => navigateTo(tab.view)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Right: 搜索框 + 头像 */}
      <div className={styles.right}>
        <div className={styles.searchWrap}>
          <form className={styles.searchForm} onSubmit={handleSubmit}>
            <svg className={styles.searchIcon} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              className={styles.searchInput}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="搜索歌曲、歌手…"
            />
          </form>

          {showDropdown && (
            <div className={styles.searchDropdown}>
              {loading && <p className={styles.searchHint}>搜索中…</p>}
              {!loading && keyword.length > 0 && !hasResults && (
                <p className={styles.searchHint}>无结果</p>
              )}
              {!loading && artists.length > 0 && (
                <div>
                  <div className={styles.searchSection}>歌手</div>
                  {artists.map((a, i) => (
                    <button key={`a-${i}`} className={styles.artistRow} onMouseDown={() => pickArtist(a)}>
                      {a.avatar && <img className={styles.rowAvatar} src={a.avatar} alt="" loading="lazy" />}
                      <span>{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {!loading && songs.length > 0 && (
                <div>
                  {artists.length > 0 && <div className={styles.searchSection}>歌曲</div>}
                  {songs.slice(0, 8).map((s, i) => (
                    <button key={`s-${i}`} className={styles.songRow} onMouseDown={() => pickSong(i)}>
                      {s.cover && <img className={styles.rowCover} src={s.cover} alt="" loading="lazy" />}
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

        <div className={styles.avatarWrap}>
          <button
            className={styles.avatarBtn}
            onClick={() => setAvatarMenuOpen((v) => !v)}
            aria-label="账户菜单"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z" />
            </svg>
          </button>
          {avatarMenuOpen && (
            <AvatarMenu onClose={() => setAvatarMenuOpen(false)} />
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 TopBar.module.css**

```css
.bar {
  display: flex;
  align-items: center;
  height: 44px;
  flex-shrink: 0;
  padding: 0 12px 0 80px;
  background: var(--sm-bg-elevated);
  border-bottom: 1px solid var(--sm-border);
  position: relative;
  z-index: 100;
  -webkit-app-region: drag;
}

/* ---- Left ---- */
.left {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  -webkit-app-region: no-drag;
}

.backBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--sm-text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.backBtn:hover:not(:disabled) {
  background: var(--sm-border);
  color: var(--sm-text-primary);
}

.backBtn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* ---- Center ---- */
.center {
  display: flex;
  align-items: center;
  gap: 2px;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  -webkit-app-region: no-drag;
}

.tab {
  padding: 5px 14px;
  border: none;
  background: transparent;
  color: var(--sm-text-secondary);
  font-size: 13px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.tab:hover {
  color: var(--sm-text-primary);
}

.tabActive {
  color: var(--sm-accent);
  font-weight: 600;
}

/* ---- Right ---- */
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

/* Search */
.searchWrap {
  position: relative;
}

.searchForm {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--sm-bg-base);
  border: 1px solid var(--sm-border);
  border-radius: 8px;
  padding: 5px 10px;
  width: 180px;
  transition: width 0.2s var(--sm-ease-out), border-color 0.15s;
}

.searchForm:focus-within {
  width: 240px;
  border-color: var(--sm-accent);
}

.searchIcon {
  flex-shrink: 0;
  color: var(--sm-text-secondary);
}

.searchInput {
  border: none;
  background: transparent;
  color: var(--sm-text-primary);
  font-size: 13px;
  outline: none;
  width: 100%;
}

.searchInput::placeholder {
  color: var(--sm-text-secondary);
}

.searchDropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 300px;
  background: var(--sm-bg-overlay);
  border: 1px solid var(--sm-border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  max-height: 400px;
  overflow-y: auto;
  z-index: 500;
}

.searchHint {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--sm-text-secondary);
  margin: 0;
}

.searchSection {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sm-text-secondary);
}

.artistRow,
.songRow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--sm-text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.artistRow:hover,
.songRow:hover {
  background: var(--sm-bg-elevated);
}

.rowAvatar,
.rowCover {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.rowCover {
  border-radius: 4px;
}

.songInfo {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.songName {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.songArtist {
  font-size: 11px;
  color: var(--sm-text-secondary);
}

/* Avatar */
.avatarWrap {
  position: relative;
}

.avatarBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--sm-border);
  background: var(--sm-bg-base);
  color: var(--sm-text-secondary);
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.avatarBtn:hover {
  background: var(--sm-bg-elevated);
  color: var(--sm-text-primary);
}
```

- [ ] **Step 3: 类型检查（局部）**

```bash
npx tsc --noEmit 2>&1 | grep -v "AvatarMenu"
```

期望：唯一错误是 `Cannot find module './AvatarMenu'`（Task 4 补上）；其他无新增错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/TopBar.tsx src/components/Layout/TopBar.module.css
git commit -m "feat(layout): add TopBar component with nav tabs, search, and avatar button"
```

---

## Task 4: AvatarMenu 组件

**Files:**
- Create: `src/components/Layout/AvatarMenu.tsx`
- Create: `src/components/Layout/AvatarMenu.module.css`

**Interfaces:**
- Consumes:
  - `useSettingsStore` — `activeSource`, `setActiveSource`, `neteaseLoggedIn`, `qqLoggedIn`, `setNeteaseLoggedIn`, `setQQLoggedIn`
  - `useNavigationStore((s) => s.navigateTo)` — 跳转 settings
  - `window.desktop?.openNeteaseLogin()` → `Promise<LoginResult>`
  - `window.desktop?.clearNeteaseLogin()` → `Promise<OkResult>`
  - `window.desktop?.openQQLogin()` → `Promise<LoginResult>`
  - `window.desktop?.clearQQLogin()` → `Promise<OkResult>`
  - `api.post(path, body?)` — 服务端登出
- Produces: `export function AvatarMenu({ onClose }: { onClose: () => void }): JSX.Element`

- [ ] **Step 1: 创建 AvatarMenu.tsx**

```tsx
import { useState } from 'react'
import { useSettingsStore } from '../../stores/settings'
import { useNavigationStore } from '../../stores/navigation'
import { api } from '../../lib/api'
import type { LoginResult } from '../../types/ipc'
import styles from './AvatarMenu.module.css'

const SOURCES = [
  { key: 'netease' as const, label: '网易云' },
  { key: 'qq' as const, label: 'QQ 音乐' },
]

interface AvatarMenuProps {
  onClose: () => void
}

export function AvatarMenu({ onClose }: AvatarMenuProps) {
  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const qqLoggedIn = useSettingsStore((s) => s.qqLoggedIn)
  const setNeteaseLoggedIn = useSettingsStore((s) => s.setNeteaseLoggedIn)
  const setQQLoggedIn = useSettingsStore((s) => s.setQQLoggedIn)
  const navigateTo = useNavigationStore((s) => s.navigateTo)

  const [accountOpen, setAccountOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const loginNetease = () => {
    void (async () => {
      setBusy(true)
      try {
        const r = (await window.desktop?.openNeteaseLogin()) as LoginResult | undefined
        if (r?.ok && r.cookie) {
          await api.post('/api/login/cookie', { cookie: r.cookie })
          setNeteaseLoggedIn(true)
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const logoutNetease = () => {
    void (async () => {
      setBusy(true)
      try {
        await window.desktop?.clearNeteaseLogin()
        await api.post('/api/logout')
        setNeteaseLoggedIn(false)
      } finally {
        setBusy(false)
      }
    })()
  }

  const loginQQ = () => {
    void (async () => {
      setBusy(true)
      try {
        const r = (await window.desktop?.openQQLogin()) as LoginResult | undefined
        if (r?.ok && r.cookie) {
          await api.post('/api/qq/login/cookie', { cookie: r.cookie })
          setQQLoggedIn(true)
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const logoutQQ = () => {
    void (async () => {
      setBusy(true)
      try {
        await window.desktop?.clearQQLogin()
        await api.post('/api/qq/logout')
        setQQLoggedIn(false)
      } finally {
        setBusy(false)
      }
    })()
  }

  const openSettings = () => {
    navigateTo('settings')
    onClose()
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.menu}>
        {/* 来源切换 */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>音乐来源</div>
          <div className={styles.sourceRow}>
            {SOURCES.map((s) => (
              <button
                key={s.key}
                className={`${styles.sourceBtn} ${activeSource === s.key ? styles.sourceBtnActive : ''}`}
                onClick={() => setActiveSource(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.divider} />

        {/* 账号设置（inline 展开） */}
        <button className={styles.menuRow} onClick={() => setAccountOpen((v) => !v)}>
          <span>账号设置</span>
          <svg
            className={`${styles.chevron} ${accountOpen ? styles.chevronOpen : ''}`}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {accountOpen && (
          <div className={styles.accountSection}>
            <div className={styles.accountRow}>
              <div className={styles.accountInfo}>
                <span className={styles.platform}>网易云音乐</span>
                <span className={`${styles.loginState} ${neteaseLoggedIn ? styles.loggedIn : ''}`}>
                  {neteaseLoggedIn ? '已登录' : '未登录'}
                </span>
              </div>
              {neteaseLoggedIn ? (
                <button className={styles.ghostBtn} disabled={busy} onClick={logoutNetease}>退出</button>
              ) : (
                <button className={styles.primaryBtn} disabled={busy} onClick={loginNetease}>登录</button>
              )}
            </div>

            <div className={styles.accountRow}>
              <div className={styles.accountInfo}>
                <span className={styles.platform}>QQ 音乐</span>
                <span className={`${styles.loginState} ${qqLoggedIn ? styles.loggedIn : ''}`}>
                  {qqLoggedIn ? '已登录' : '未登录'}
                </span>
              </div>
              {qqLoggedIn ? (
                <button className={styles.ghostBtn} disabled={busy} onClick={logoutQQ}>退出</button>
              ) : (
                <button className={styles.primaryBtn} disabled={busy} onClick={loginQQ}>登录</button>
              )}
            </div>
          </div>
        )}

        <div className={styles.divider} />

        {/* 设置 */}
        <button className={styles.menuRow} onClick={openSettings}>
          设置
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: 创建 AvatarMenu.module.css**

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 400;
}

.menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 220px;
  background: var(--sm-bg-overlay);
  border: 1px solid var(--sm-border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  z-index: 500;
  overflow: hidden;
  padding: 6px 0;
}

.section {
  padding: 8px 12px;
}

.sectionLabel {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sm-text-secondary);
  margin-bottom: 8px;
}

.sourceRow {
  display: flex;
  gap: 6px;
}

.sourceBtn {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--sm-border);
  background: transparent;
  color: var(--sm-text-secondary);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.sourceBtnActive {
  background: var(--sm-accent);
  color: var(--sm-text-on-accent);
  border-color: var(--sm-accent);
}

.divider {
  height: 1px;
  background: var(--sm-border);
  margin: 4px 0;
}

.menuRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 9px 16px;
  border: none;
  background: transparent;
  color: var(--sm-text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.menuRow:hover {
  background: var(--sm-bg-elevated);
}

.chevron {
  transition: transform 0.2s;
  color: var(--sm-text-secondary);
}

.chevronOpen {
  transform: rotate(180deg);
}

.accountSection {
  padding: 4px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.accountRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.accountInfo {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.platform {
  font-size: 12px;
  color: var(--sm-text-primary);
}

.loginState {
  font-size: 11px;
  color: var(--sm-text-secondary);
}

.loggedIn {
  color: #34c759;
}

.ghostBtn {
  flex-shrink: 0;
  padding: 3px 10px;
  border: 1px solid var(--sm-border);
  background: transparent;
  color: var(--sm-text-secondary);
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.ghostBtn:hover:not(:disabled) {
  background: var(--sm-bg-elevated);
}

.primaryBtn {
  flex-shrink: 0;
  padding: 3px 10px;
  border: none;
  background: var(--sm-accent);
  color: var(--sm-text-on-accent);
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
}

.primaryBtn:disabled,
.ghostBtn:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit
```

期望：无新增错误。

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/AvatarMenu.tsx src/components/Layout/AvatarMenu.module.css
git commit -m "feat(layout): add AvatarMenu with source switcher and account settings"
```

---

## Task 5: App 布局重构 + 旧文件清理

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.module.css`
- Delete: `src/components/Layout/LeftStrip.tsx`
- Delete: `src/components/Layout/LeftStrip.module.css`
- Delete: `src/components/Layout/modules/NavModule.tsx`
- Delete: `src/components/Layout/modules/NavModule.module.css`
- Delete: `src/components/Layout/modules/SearchModule.tsx`
- Delete: `src/components/Layout/modules/SearchModule.module.css`
- Delete: `src/components/Layout/modules/SourceModule.tsx`
- Delete: `src/components/Layout/modules/SourceModule.module.css`
- Delete: `src/components/Layout/modules/AccountModule.tsx`
- Delete: `src/components/Layout/modules/AccountModule.module.css`
- Delete: `src/components/Layout/modules/useHoverPanel.ts`

**Interfaces:**
- Consumes: `TopBar`（Task 3）、`WindowChrome`（Task 2）、`AppShell`、`PlayerBar`、`LyricsPanel`（均不变）
- Produces: 完整可运行的应用，无旧 LeftStrip 引用

- [ ] **Step 1: 修改 App.tsx**

将全文替换为：

```tsx
import { useEffect, useState } from 'react'
import styles from './App.module.css'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useAudio } from './hooks/useAudio'
import { useDesktopLyricsSync } from './hooks/useDesktopLyricsSync'
import { useWallpaperSync } from './hooks/useWallpaperSync'
import { useLyricsFetch } from './hooks/useLyricsFetch'
import { useSettingsStore } from './stores/settings'
import { WindowChrome } from './components/Layout/WindowChrome'
import { TopBar } from './components/Layout/TopBar'
import { AppShell } from './components/Layout/AppShell'
import { PlayerBar } from './components/Player/PlayerBar'
import { LyricsPanel } from './components/Lyrics/LyricsPanel'

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
        <TopBar />
        <AppShell />
        <PlayerBar onOpenLyrics={() => setLyricsOpen(true)} />
        <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
      </div>
    </WindowChrome>
  )
}
```

- [ ] **Step 2: 修改 App.module.css**

将全文替换为：

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

- [ ] **Step 3: 删除旧文件**

```bash
rm src/components/Layout/LeftStrip.tsx src/components/Layout/LeftStrip.module.css
rm -rf src/components/Layout/modules/
```

- [ ] **Step 4: 检查残留引用**

```bash
grep -r "LeftStrip\|NavModule\|SearchModule\|SourceModule\|AccountModule\|useHoverPanel" src/ --include="*.tsx" --include="*.ts"
```

期望：无任何输出。

- [ ] **Step 5: 类型检查 + 测试**

```bash
npx tsc --noEmit && npm test
```

期望：类型检查无错误，store 测试全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.module.css
git rm -r src/components/Layout/LeftStrip.tsx src/components/Layout/LeftStrip.module.css src/components/Layout/modules/
git commit -m "feat(layout): replace LeftStrip with TopBar, remove obsolete modules"
```

---

## 验收清单

启动应用（`npm run dev`）后逐项手动验证：

- [ ] macOS 原生 traffic lights（红/黄/绿）可见，点击关闭/缩小/最大化正常
- [ ] TopBar 可拖拽移动窗口；后退按钮、Tab、搜索框、头像按钮不触发拖拽
- [ ] 「探索」/「我的库」Tab 切换正常，当前 Tab 高亮为 accent 色
- [ ] 后退按钮在有导航历史时可点，无历史时呈半透明 disabled 状态
- [ ] 搜索框聚焦时展宽，输入关键词后结果下拉显示；点击歌曲开始播放；点击歌手进入歌手页
- [ ] 点击头像：来源切换（网易云/QQ 音乐）正常；展开「账号设置」显示各来源登录态；「设置」跳转正常
- [ ] 全屏模式下 TopBar 仍在顶部，traffic lights 隐藏由 macOS 自动处理
- [ ] `npm test` 全部 PASS
