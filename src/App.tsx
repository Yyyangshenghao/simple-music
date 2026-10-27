import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { useMotion } from './hooks/useMotion'
import { lyricStyleInfo, resolveLyricsView } from './lib/lyric-style-catalog'
import { useLyricStylesStore } from './stores/lyric-styles'
import styles from './App.module.css'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useShortcuts } from './hooks/useShortcuts'
import { useScrollbarActivity } from './hooks/useScrollbarActivity'
import { useShuangeCoverPreload } from './hooks/useShuangeCoverPreload'
import { useNowPlayingCoverPreload } from './hooks/useNowPlayingCoverPreload'
import { useAmbientPalette } from './hooks/useAmbientPalette'
import { useAccentTheme } from './hooks/useAccentTheme'
import { useIdleHide } from './hooks/useIdleHide'
import { useSettingsStore } from './stores/settings'
import { useUpdateStore } from './stores/update'
import { useBackdropStore } from './stores/backdrop'
import { useNavigationStore } from './stores/navigation'
import { useWindowStore } from './stores/window'
import { useGameModeStore } from './stores/game-mode'
import { initWindowCloseSync } from './stores/window-close'
import { fontFamilyCssValue } from './lib/font-family'
import { WindowChrome } from './components/Layout/WindowChrome'
import { WindowCloseDialog } from './components/Layout/WindowCloseDialog'
import { UnlikeConfirmDialog } from './components/Layout/UnlikeConfirmDialog'
import { TopBar } from './components/Layout/TopBar'
import { AppShell } from './components/Layout/AppShell'
import { GlobalContentProviderDock } from './components/Layout/GlobalContentProviderDock'
import { AmbientBackground } from './components/Layout/AmbientBackground'
import { DetailBackdrop } from './components/Layout/DetailBackdrop'
import { PlayerBar } from './components/Player/PlayerBar'
import { LyricsPanel } from './components/Lyrics/LyricsPanel'
import { LyricsSourceDialog } from './components/Lyrics/LyricsSourceDialog'
import { useLyricsSourceDialogStore } from './stores/lyrics-source-dialog'
import { Toast } from './components/ui/Toast'
import { TrackActionLayer } from './components/Playlist/TrackActionLayer'
import { UpdateBanner } from './components/Update/UpdateBanner'

// 资源监控浮层只在开发模式加载，生产构建会整段剔除
const DevMetricsHud = import.meta.env.DEV ? lazy(() => import('./components/Dev/DevMetricsHud')) : null

const APPEARANCE_KEYS = [
  'themeMode', 'contentLayout', 'contentGutter', 'fontFamily', 'fontFamilyCjk', 'lyricsFontFamily',
  'lyricsFontFamilyCjk', 'lyrics3dFontFamily', 'lyrics3dFontFamilyCjk'
] as const

export default function App() {
  const reducedMotion = !useMotion('pageTransitionMotion')
  const motionFlags = useSettingsStore((s) => s.performance)
  const lyricsLineMotion = useMotion('lyricsLineMotion')
  // 纯 CSS 的过渡按根节点属性分别停用，各开关互不牵连。
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute('data-page-motion-off', reducedMotion)
    root.toggleAttribute('data-lyrics-line-motion-off', !lyricsLineMotion)
    root.toggleAttribute('data-hover-lift-motion-off', !motionFlags.hoverLiftMotion)
    root.toggleAttribute('data-toggle-motion-off', !motionFlags.toggleMotion)
    root.toggleAttribute('data-slider-motion-off', !motionFlags.sliderMotion)
    root.toggleAttribute('data-icon-motion-off', !motionFlags.iconMotion)
  }, [reducedMotion, lyricsLineMotion, motionFlags.hoverLiftMotion, motionFlags.toggleMotion, motionFlags.sliderMotion, motionFlags.iconMotion])
  const gameEnabled = useGameModeStore((s) => s.enabled)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const storedLyricsMode = useSettingsStore((s) => s.lyricsPanelMode)
  const lyricStyle = useLyricStylesStore((s) => s.style)
  const lyricsMode = resolveLyricsView({ mode: storedLyricsMode, style: lyricStyle })
  const lyricsSourceOpen = useLyricsSourceDialogStore((s) => s.open)
  // 歌词页打开时,鼠标/键盘空闲 3s 进入沉浸模式,淡出播放栏与歌词页控件
  const controlsHidden = useIdleHide(lyricsOpen && !gameEnabled && !lyricsSourceOpen)
  // 纯歌词页使用舞台控件时自带播放操作：播放栏先随封面飞出淡下去，过渡结束再卸载；
  // 收起时在同一次提交里重新挂载，歌词页才能量到它的封面位置把封面飞回来。
  const lyricsPlayerStyle = useSettingsStore((s) => s.lyricsPlayerStyle)
  const lyricsCoversDock = lyricsOpen && lyricsMode === 'lyrics' && lyricsPlayerStyle === 'stage'
  const [dockRetired, setDockRetired] = useState(false)
  if (!lyricsCoversDock && dockRetired) setDockRetired(false)
  useEffect(() => {
    if (!lyricsCoversDock) return
    if (reducedMotion) { setDockRetired(true); return }
    const timer = setTimeout(() => setDockRetired(true), 420)
    return () => clearTimeout(timer)
  }, [lyricsCoversDock, reducedMotion])
  const detailBackdropCover = useBackdropStore((s) => s.cover)
  const currentView = useNavigationStore((s) => s.currentView)
  // 主窗口不可见时(迷你态/退居托盘/最小化)卸载整个可视层,停掉重度 WebGL/动画降耗;
  // 播放运行时与保留的顶层 hooks 不在此子树,音频与迷你条同步照常。
  const mainVisible = useWindowStore((s) => s.isVisible)

  useDesktopBridge()
  useShortcuts()
  useScrollbarActivity()
  useShuangeCoverPreload(mainVisible && !gameEnabled)
  useNowPlayingCoverPreload(mainVisible && !gameEnabled)
  useAmbientPalette(!gameEnabled)
  useAccentTheme()

  useEffect(() => initWindowCloseSync(), [])
  useEffect(() => useNavigationStore.subscribe((state, previous) => {
    if (state.currentView === 'settings' && state.navigationRevision !== previous.navigationRevision) setLyricsOpen(false)
  }), [])

  useEffect(() => {
    const sync = () => {
      const {
        themeMode,
        contentLayout,
        contentGutter,
        fontFamily,
        fontFamilyCjk,
        lyricsFontFamily,
        lyricsFontFamilyCjk,
        lyrics3dFontFamily,
        lyrics3dFontFamilyCjk,
        performance
      } = useSettingsStore.getState()
      const root = document.documentElement
      if (themeMode === 'auto') root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', themeMode)
      root.setAttribute('data-content-layout', contentLayout)
      root.style.setProperty('--sm-content-gutter', `${contentGutter}px`)
      if (fontFamily.trim() || fontFamilyCjk.trim()) {
        root.style.setProperty('--sm-font-sans', fontFamilyCssValue(fontFamily, fontFamilyCjk))
      } else root.style.removeProperty('--sm-font-sans')
      if (lyricsFontFamily.trim() || lyricsFontFamilyCjk.trim()) {
        root.style.setProperty(
          '--sm-lyrics-font-sans',
          fontFamilyCssValue(lyricsFontFamily || fontFamily, lyricsFontFamilyCjk || fontFamilyCjk)
        )
      } else root.style.removeProperty('--sm-lyrics-font-sans')
      if (lyrics3dFontFamily.trim() || lyrics3dFontFamilyCjk.trim()) {
        root.style.setProperty(
          '--sm-lyrics-3d-font-sans',
          fontFamilyCssValue(lyrics3dFontFamily || fontFamily, lyrics3dFontFamilyCjk || fontFamilyCjk)
        )
      } else root.style.removeProperty('--sm-lyrics-3d-font-sans')
      // 减少透明度:tokens.css 用属性选择器把玻璃层降为无模糊/高不透明
      if (performance.reduceTransparency) root.setAttribute('data-reduce-transparency', '1')
      else root.removeAttribute('data-reduce-transparency')
    }
    sync()
    const stopSettingsSync = useSettingsStore.subscribe((state, previous) => {
      if (state.performance.reduceTransparency !== previous.performance.reduceTransparency
        || APPEARANCE_KEYS.some((key) => state[key] !== previous[key])) sync()
    })
    return () => {
      stopSettingsSync()
    }
  }, [])

  useEffect(() => {
    void useUpdateStore.getState().checkForUpdate()
  }, [])

  return (
    <>
      <WindowCloseDialog />
      <UnlikeConfirmDialog />
      {mainVisible && !gameEnabled && <MotionConfig reducedMotion="never">
      <WindowChrome lyricsOpen={lyricsOpen}>
        <div data-app-root className={styles.root} data-view={currentView === 'shuange' ? 'shuange' : undefined}>
          {/* 详情页只是用封面盖住背景，不能卸载：卸载会重建视频解码与壁纸 WebGL，返回时闪白。 */}
          <AmbientBackground
            hidden={lyricsOpen && lyricsMode !== 'lyrics' && lyricStyleInfo(lyricsMode).webgl}
            covered={!!detailBackdropCover}
          />
          <DetailBackdrop />
          <TopBar hidden={lyricsOpen} />
          <AppShell />
          <GlobalContentProviderDock />
          {currentView !== 'shuange' && !dockRetired && <PlayerBar onOpenLyrics={() => setLyricsOpen(true)} onArtistNavigate={() => setLyricsOpen(false)} hidden={controlsHidden} lyricsOpen={lyricsOpen} handoff={lyricsCoversDock} />}
          <LyricsPanel open={lyricsOpen} controlsHidden={controlsHidden} onClose={() => setLyricsOpen(false)} />
          <LyricsSourceDialog />
          <TrackActionLayer />
          <Toast />
          <UpdateBanner />
        </div>
      </WindowChrome>
      </MotionConfig>}
      {DevMetricsHud && mainVisible && <Suspense fallback={null}><DevMetricsHud /></Suspense>}
    </>
  )
}
