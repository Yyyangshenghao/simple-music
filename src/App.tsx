import { useEffect, useState } from 'react'
import { MotionConfig } from 'motion/react'
import styles from './App.module.css'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useAudio } from './hooks/useAudio'
import { useDesktopLyricsSync } from './hooks/useDesktopLyricsSync'
import { useWallpaperSync } from './hooks/useWallpaperSync'
import { useLyricsFetch } from './hooks/useLyricsFetch'
import { useAmbientPalette } from './hooks/useAmbientPalette'
import { useSettingsStore } from './stores/settings'
import { WindowChrome } from './components/Layout/WindowChrome'
import { TopBar } from './components/Layout/TopBar'
import { AppShell } from './components/Layout/AppShell'
import { PlayerBar } from './components/Player/PlayerBar'
import { LyricsPanel } from './components/Lyrics/LyricsPanel'
import { ClickSpark } from './components/ui/ClickSpark'

export default function App() {
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const lyricsMode = useSettingsStore((s) => s.lyricsPanelMode)

  useDesktopBridge()
  useAudio()
  useDesktopLyricsSync()
  useWallpaperSync()
  useLyricsFetch()
  useAmbientPalette()

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
    <MotionConfig reducedMotion="user">
      <WindowChrome>
        <div className={styles.root}>
          <TopBar hidden={lyricsOpen} />
          <AppShell backgroundHidden={lyricsOpen && lyricsMode === '3d'} />
          <PlayerBar onOpenLyrics={() => setLyricsOpen(true)} />
          <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
          <ClickSpark />
        </div>
      </WindowChrome>
    </MotionConfig>
  )
}
