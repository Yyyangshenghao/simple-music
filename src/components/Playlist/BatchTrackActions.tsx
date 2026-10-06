import { useEffect, useRef, useState } from 'react'
import { PROVIDER_IDS } from '../../providers/types'
import { useProviderStore } from '../../stores/providers'
import { providerAccountSession } from '../../lib/provider-account-session'
import { resolveBatchTracks } from '../../lib/batch-tracks'
import { usePlaylistStore } from '../../stores/playlist'
import { useOfflineCacheStore } from '../../stores/offline-cache'
import { useToastStore } from '../../stores/toast'
import type { Playlist, Track } from '../../types/domain'
import styles from './BatchTrackActions.module.css'

interface Props {
  tracks: Track[]
  collections?: Playlist[]
  label?: string
  onDone?(): void
}

export function BatchTrackActions({ tracks, collections = [], label, onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  const accountSignature = useProviderStore((state) => PROVIDER_IDS.map((source) => `${state.byId[source].enabled}:${state.byId[source].auth}:${providerAccountSession(source)}`).join('|'))
  const signature = [...tracks, ...collections].map((item) => `${item.source}:${item.type}:${String(item.id)}`).join('|')
  const sourceSet = new Set([...tracks, ...collections].map((item) => item.source))
  const canSave = sourceSet.size > 0 && [...sourceSet].every((item) => item === 'netease' || item === 'qq')
  const count = tracks.length + collections.length

  useEffect(() => {
    operation.current?.abort()
    setBusy(false)
    setError('')
    return () => { operation.current?.abort() }
  }, [signature, accountSignature])

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busy || !count) return
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    try {
      await action(controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted && !(failure instanceof Error && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : '操作失败，请重试')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <div className={styles.actions}>
      <div className={styles.bar}>
        <span>{label ?? `${count} 项已选`}</span>
        <button type="button" disabled={busy || !count} onClick={() => void run(async (signal) => {
          const resolved = await resolveBatchTracks(tracks, collections, signal)
          if (signal.aborted) return
          const added = usePlaylistStore.getState().addManyToQueue(resolved)
          useToastStore.getState().show(added ? `已追加 ${added} 首到播放队列` : '播放队列已包含所选歌曲')
          onDone?.()
        })}>添加到播放队列</button>
        {canSave && <button type="button" disabled={busy || !count} onClick={() => void run(async (signal) => {
          const resolved = await resolveBatchTracks(tracks, collections, signal)
          if (signal.aborted) return
          const added = await useOfflineCacheStore.getState().saveMany(resolved, signal)
          if (signal.aborted) return
          useToastStore.getState().show(added ? `${added} 首已加入下载队列` : '所选歌曲已在下载队列中')
          onDone?.()
        })}>批量下载</button>}
        {busy && <><span role="status">处理中…</span><button type="button" onClick={() => { operation.current?.abort(); setBusy(false) }}>取消操作</button></>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
