import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { usePlaylistStore } from '../../stores/playlist'
import { ShelfCard } from './ShelfCard'
import { ShelfDetail } from './ShelfDetail'
import { RevealItem } from '../ui/RevealItem'
import type { Playlist } from '../../types/domain'
import styles from './ShelfScene.module.css'

/**
 * 歌单架主组件（对外入口）。
 * - shelfVisible=false 时不渲染。
 * - 挂载时若 playlists 为空则拉取用户歌单。
 * - 用纯 CSS3D/transform 营造层叠书架感，无第三方依赖。
 * - shelfMode='dynamic' 时启用倾斜与 hover 动画。
 */
export function ShelfScene() {
  const playlists = usePlaylistStore((s) => s.playlists)
  const shelfVisible = usePlaylistStore((s) => s.shelfVisible)
  const shelfMode = usePlaylistStore((s) => s.shelfMode)
  const setShelfMode = usePlaylistStore((s) => s.setShelfMode)
  const setCurrentPlaylist = usePlaylistStore((s) => s.setCurrentPlaylist)

  const [detail, setDetail] = useState<Playlist | null>(null)

  useEffect(() => {
    if (shelfVisible && playlists.length === 0) {
      void usePlaylistStore.getState().loadUserPlaylists()
    }
  }, [shelfVisible, playlists.length])

  if (!shelfVisible) return null

  const handleOpen = (playlist: Playlist): void => {
    setCurrentPlaylist(playlist)
    setDetail(playlist)
  }

  const sceneClass = `${styles.scene} ${
    shelfMode === 'dynamic' ? styles.dynamic : styles.static
  }`

  return (
    <div className={styles.root}>
      <header className={styles.toolbar}>
        <h2 className={styles.heading}>我的歌单架</h2>
        <div className={styles.modeSeg}>
          <button
            type="button"
            className={`${styles.modeBtn} no-drag ${
              shelfMode === 'dynamic' ? styles.modeActive : ''
            }`}
            onClick={() => setShelfMode('dynamic')}
          >
            动态
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} no-drag ${
              shelfMode === 'static' ? styles.modeActive : ''
            }`}
            onClick={() => setShelfMode('static')}
          >
            静态
          </button>
        </div>
      </header>

      <div className={styles.viewport}>
        {playlists.length === 0 ? (
          <p className={styles.empty}>暂无歌单</p>
        ) : (
          <div className={sceneClass}>
            <div className={styles.grid}>
              {playlists.map((playlist, index) => (
                <div
                  key={`${String(playlist.id)}-${index}`}
                  className={styles.slot}
                  style={{ '--i': index } as CSSProperties}
                >
                  <RevealItem delay={index * 0.04}>
                    <ShelfCard playlist={playlist} onOpen={() => handleOpen(playlist)} />
                  </RevealItem>
                </div>
              ))}
            </div>
            <div className={styles.board} aria-hidden="true" />
          </div>
        )}
      </div>

      {detail && <ShelfDetail playlist={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
