import { useEffect, useState } from 'react'
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

export default function App() {
  const [lyricsOpen, setLyricsOpen] = useState(false)

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
