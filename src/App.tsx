import { useEffect, useState } from 'react'
import styles from './App.module.css'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useAudio } from './hooks/useAudio'
import { useSettingsStore } from './stores/settings'
import { usePlaylistStore } from './stores/playlist'
import { WindowChrome } from './components/Layout/WindowChrome'
import { TitleBar } from './components/Layout/TitleBar'
import { Scene } from './components/Visualizer/Scene'
import { StageLyrics } from './components/Lyrics/StageLyrics'
import { ShelfScene } from './components/Shelf/ShelfScene'
import { SearchBar } from './components/Search/SearchBar'
import { PlayerBar } from './components/Player/PlayerBar'
import { SettingsPanel } from './components/Settings/SettingsPanel'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const toggleShelf = usePlaylistStore((s) => s.toggleShelf)

  useDesktopBridge()
  useAudio()

  useEffect(() => {
    useSettingsStore.getState().loadFromLocal()
  }, [])

  return (
    <WindowChrome>
      <div className={styles.root}>
        {/* 背景可视化层 */}
        <Scene />

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
            <StageLyrics />
            <ShelfScene />
          </div>

          <PlayerBar />
        </div>

        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </WindowChrome>
  )
}
