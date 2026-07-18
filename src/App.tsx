import { useEffect, useState } from 'react'
import { MotionConfig } from 'motion/react'
import styles from './App.module.css'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useAudio } from './hooks/useAudio'
import { useDesktopLyricsSync } from './hooks/useDesktopLyricsSync'
import { useWallpaperSync } from './hooks/useWallpaperSync'
import { useLyricsFetch } from './hooks/useLyricsFetch'
import { useAmbientPalette } from './hooks/useAmbientPalette'
import { useIdleHide } from './hooks/useIdleHide'
import { useLoginStatusSync } from './hooks/useLoginStatusSync'
import { useSettingsStore } from './stores/settings'
import { useUpdateStore } from './stores/update'
import { useBackdropStore } from './stores/backdrop'
import { initPlaybackPersistence } from './lib/playback-persistence'
import { initMediaSession } from './lib/media-session'
import { WindowChrome } from './components/Layout/WindowChrome'
import { TopBar } from './components/Layout/TopBar'
import { AppShell } from './components/Layout/AppShell'
import { AmbientBackground } from './components/Layout/AmbientBackground'
import { DetailBackdrop } from './components/Layout/DetailBackdrop'
import { PlayerBar } from './components/Player/PlayerBar'
import { LyricsPanel } from './components/Lyrics/LyricsPanel'
import { ClickSpark } from './components/ui/ClickSpark'
import { Toast } from './components/ui/Toast'
import { UpdateBanner } from './components/Update/UpdateBanner'

export default function App() {
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const storedLyricsMode = useSettingsStore((s) => s.lyricsPanelMode)
  const lyrics3dEnabled = useSettingsStore((s) => s.performance.lyrics3dEnabled)
  const lyricsMode = lyrics3dEnabled ? storedLyricsMode : 'lyrics'
  // 歌词页打开时,鼠标/键盘空闲 3s 进入沉浸模式,淡出播放栏与歌词页控件
  const controlsHidden = useIdleHide(lyricsOpen)
  const detailBackdropCover = useBackdropStore((s) => s.cover)

  useDesktopBridge()
  useLoginStatusSync()
  useAudio()
  useDesktopLyricsSync()
  useWallpaperSync()
  useLyricsFetch()
  useAmbientPalette()

  useEffect(() => {
    useSettingsStore.getState().loadFromLocal()
    initPlaybackPersistence()
    initMediaSession()
    const sync = () => {
      const { themeMode, fontFamily } = useSettingsStore.getState()
      const root = document.documentElement
      if (themeMode === 'auto') root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', themeMode)
      if (fontFamily.trim()) root.style.setProperty('--sm-font-sans', fontFamily)
      else root.style.removeProperty('--sm-font-sans')
    }
    sync()
    return useSettingsStore.subscribe(sync)
  }, [])

  useEffect(() => {
    void useUpdateStore.getState().checkForUpdate()
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <WindowChrome>
        <div className={styles.root}>
          <AmbientBackground hidden={(lyricsOpen && lyricsMode === '3d') || !!detailBackdropCover} />
          <DetailBackdrop />
          <TopBar hidden={lyricsOpen} />
          <AppShell />
          <PlayerBar onOpenLyrics={() => setLyricsOpen(true)} hidden={controlsHidden} />
          <LyricsPanel open={lyricsOpen} controlsHidden={controlsHidden} onClose={() => setLyricsOpen(false)} />
          <ClickSpark />
          <Toast />
          <UpdateBanner />
        </div>
      </WindowChrome>
    </MotionConfig>
  )
}
