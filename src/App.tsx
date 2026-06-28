import { useEffect, useState } from 'react'
import styles from './App.module.css'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useAudio } from './hooks/useAudio'
import { useDesktopLyricsSync } from './hooks/useDesktopLyricsSync'
import { useWallpaperSync } from './hooks/useWallpaperSync'
import { useLyricsFetch } from './hooks/useLyricsFetch'
import { useSettingsStore } from './stores/settings'
import { usePlaylistStore } from './stores/playlist'
import { useVisualStore } from './stores/visual'
import { WindowChrome } from './components/Layout/WindowChrome'
import { TitleBar } from './components/Layout/TitleBar'
import { LyricsPanel } from './components/Lyrics/LyricsPanel'
import { ShelfScene } from './components/Shelf/ShelfScene'
import { SearchBar } from './components/Search/SearchBar'
import { PlayerBar } from './components/Player/PlayerBar'
import { SettingsPanel } from './components/Settings/SettingsPanel'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const toggleShelf = usePlaylistStore((s) => s.toggleShelf)
  const backgroundColor = useVisualStore((s) => s.fx.backgroundColor)

  useDesktopBridge()
  useAudio()
  useDesktopLyricsSync()
  useWallpaperSync()
  useLyricsFetch()

  useEffect(() => {
    useSettingsStore.getState().loadFromLocal()
  }, [])

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

  return (
    <WindowChrome>
      <div className={styles.root}>
        {/* 背景色层 */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: backgroundColor || '#04060c' }} />

        {/* 交互层 */}
        <div className={styles.content}>
          <TitleBar />

          <div className={styles.topRow}>
            <SearchBar />
            <div className={styles.spacer} />
            <button className={styles.iconBtn} onClick={() => toggleShelf()}>
              歌单架
            </button>
            <button className={styles.iconBtn} onClick={() => setSettingsOpen(true)}>
              设置
            </button>
          </div>

          <div className={styles.stage}>
            <ShelfScene />
          </div>

          <PlayerBar onOpenLyrics={() => setLyricsOpen(true)} />
        </div>

        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
      </div>
    </WindowChrome>
  )
}
