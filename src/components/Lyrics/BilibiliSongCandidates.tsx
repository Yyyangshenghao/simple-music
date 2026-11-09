import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../types/domain'
import type { TrackMatchResult } from '../../lib/track-match'
import { bilibiliIdentityKey } from '../../lib/bilibili-song-match'
import { useBilibiliCoverStore } from '../../stores/bilibili-covers'
import styles from './LyricsSourceDialog.module.css'

interface Props {
  track: Track
  disabled: boolean
  onBusyChange(busy: boolean): void
  onConfirmed(): Promise<void>
}

/** 候选仅供确认歌曲身份，不会在预览时更换正在播放的音频。 */
export function BilibiliSongCandidates({ track, disabled, onBusyChange, onConfirmed }: Props) {
  const [candidates, setCandidates] = useState<TrackMatchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const request = useRef<AbortController>()
  const identity = bilibiliIdentityKey(track)

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    setCandidates([])
    setLoading(true)
    setChoosing(false)
    setError('')
    void useBilibiliCoverStore.getState().querySongCandidates(track, retry > 0)
      .then(found => { if (!controller.signal.aborted) setCandidates(found.slice(0, 3)) })
      .catch(() => { if (!controller.signal.aborted) setError('歌曲识别失败，请重试') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => {
      controller.abort()
      onBusyChange(false)
    }
  }, [identity, retry])

  const confirm = async (candidate: Track) => {
    const controller = request.current
    if (!controller || controller.signal.aborted || disabled || choosing) return
    setChoosing(true)
    setError('')
    onBusyChange(true)
    try {
      await useBilibiliCoverStore.getState().confirmSongCandidate(track, candidate)
      if (controller.signal.aborted) return
      await onConfirmed()
      if (!controller.signal.aborted) setCandidates([])
    } catch {
      if (!controller.signal.aborted) setError('未能更新歌曲，请重新查找后再试')
    } finally {
      if (!controller.signal.aborted) {
        setChoosing(false)
        onBusyChange(false)
      }
    }
  }

  if (!loading && !error && !candidates.length) return null
  return <section className={styles.songCandidates} aria-label="确认视频对应歌曲" aria-busy={loading || choosing}>
    <div className={styles.songCandidatesHeading}>
      <h3>确认歌曲</h3>
      {loading ? <p role="status">正在识别歌曲…</p> : <p>选择视频对应的歌曲，更新歌名、封面和歌词。</p>}
    </div>
    {candidates.map(({ track: candidate, score }) => <div className={styles.songCandidate} key={`${candidate.source}:${String(candidate.mid ?? candidate.id)}`}>
      <span className={styles.songCandidateCover}>{candidate.cover && <img src={candidate.cover} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden' }} />}</span>
      <div className={styles.songCandidateInfo}>
        <strong>{candidate.name}</strong>
        <span>{candidate.artist}{candidate.album ? ` · ${candidate.album}` : ''}</span>
      </div>
      <span className={styles.songCandidateScore} data-tip="匹配分用于比较候选，不代表识别正确率">{score} 分</span>
      <button type="button" className={styles.searchButton} aria-label={`使用此歌曲：${candidate.name} · ${candidate.artist}`} disabled={disabled || choosing || loading} onClick={() => void confirm(candidate)}>{choosing ? '更新中…' : '使用此歌曲'}</button>
    </div>)}
    {error && <div className={styles.songCandidateError}><p role="alert">{error}</p><button type="button" className={styles.settingsLink} disabled={disabled || choosing} onClick={() => setRetry(value => value + 1)}>重新查找</button></div>}
  </section>
}
