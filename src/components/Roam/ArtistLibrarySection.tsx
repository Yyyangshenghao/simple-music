import { useState } from 'react'
import { useRoamStore, MAX_SONGS_PER_ARTIST } from '../../stores/roam'
import type { RoamArtistEntry } from '../../stores/roam'
import { sizedImage } from '../../lib/image-size'
import { formatDuration } from '../../lib/format-duration'
import { CloseIcon } from '../ui/CloseIcon'
import styles from './ArtistLibrarySection.module.css'

interface ArtistLibrarySectionProps {
  entry: RoamArtistEntry
}

/** 「入库」卡片:一位已选歌手 + 已选入的曲目清单,可增减首数、逐曲删除、从曲库池补选。 */
export function ArtistLibrarySection({ entry }: ArtistLibrarySectionProps) {
  const removeArtist = useRoamStore((s) => s.removeArtist)
  const setArtistCount = useRoamStore((s) => s.setArtistCount)
  const addTrack = useRoamStore((s) => s.addTrack)
  const removeTrack = useRoamStore((s) => s.removeTrack)
  const [expanded, setExpanded] = useState(false)

  const { artist, tracks, pool, loading } = entry
  const includedIds = new Set(tracks.map((t) => String(t.id)))
  const addable = pool.filter((t) => !includedIds.has(String(t.id)))

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        {artist.avatar && <img className={styles.avatar} src={sizedImage(artist.avatar, 64)} alt="" loading="lazy" decoding="async" />}
        <span className={styles.name}>{artist.name}</span>
        <div className={styles.stepper}>
          <button
            className={`${styles.stepBtn} no-drag`}
            disabled={loading || tracks.length <= 1}
            onClick={() => setArtistCount(artist.id, tracks.length - 1)}
            aria-label="减少首数"
          >
            –
          </button>
          <span className={styles.stepCount}>{loading ? '加载中…' : `${tracks.length} 首`}</span>
          <button
            className={`${styles.stepBtn} no-drag`}
            disabled={loading || tracks.length >= MAX_SONGS_PER_ARTIST || addable.length === 0}
            onClick={() => setArtistCount(artist.id, tracks.length + 1)}
            aria-label="增加首数"
          >
            +
          </button>
        </div>
        <button
          className={`${styles.removeBtn} no-drag`}
          onClick={() => removeArtist(artist.id)}
          aria-label={`移除 ${artist.name}`}
        >
          <CloseIcon size={13} />
        </button>
      </div>

      {!loading && (
        <div className={styles.trackList}>
          {tracks.map((t) => (
            <div key={String(t.id)} className={styles.trackRow}>
              <span className={styles.trackName}>{t.name}</span>
              <span className={styles.trackDuration}>{formatDuration(t.duration)}</span>
              <button
                className={`${styles.trackRemove} no-drag`}
                onClick={() => removeTrack(artist.id, t.id)}
                aria-label={`移除 ${t.name}`}
              >
                <CloseIcon size={11} />
              </button>
            </div>
          ))}
          {tracks.length === 0 && <p className={styles.hint}>还没有选入曲目</p>}
        </div>
      )}

      {!loading && addable.length > 0 && (
        <div className={styles.addSection}>
          <button className={`${styles.addToggle} no-drag`} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : `+ 添加这位歌手的其他歌曲(${addable.length})`}
          </button>
          {expanded && (
            <div className={styles.addList}>
              {addable.map((t) => (
                <button
                  key={String(t.id)}
                  className={`${styles.addRow} no-drag`}
                  onClick={() => addTrack(artist.id, t)}
                >
                  <span className={styles.trackName}>{t.name}</span>
                  <span className={styles.addPlus}>+</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
