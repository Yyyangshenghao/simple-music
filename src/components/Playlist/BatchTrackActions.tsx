import { useEffect, useRef, useState } from 'react'
import { providerFor } from '../../providers/registry'
import { isProviderId, PROVIDER_IDS } from '../../providers/types'
import { isProviderParticipating, useProviderStore } from '../../stores/providers'
import { providerAccountSession } from '../../lib/provider-account-session'
import { resolveBatchTracks } from '../../lib/batch-tracks'
import { clearProviderRequestCache } from '../../lib/provider-request-cache'
import { invalidatePlaylistCache } from '../../hooks/useLazyPlaylist'
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
  const [writing, setWriting] = useState(false)
  const [picker, setPicker] = useState(false)
  const [targets, setTargets] = useState<Playlist[]>([])
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  const accountSignature = useProviderStore((state) => PROVIDER_IDS.map((source) => `${state.byId[source].enabled}:${state.byId[source].auth}:${providerAccountSession(source)}`).join('|'))
  const signature = [...tracks, ...collections].map((item) => `${item.source}:${item.type}:${String(item.id)}`).join('|')
  const sourceSet = new Set([...tracks, ...collections].map((item) => item.source))
  const source = sourceSet.size === 1 ? [...sourceSet][0] : null
  const provider = source && isProviderId(source) ? providerFor(source) : null
  const canWrite = !!provider?.playlistWriter?.addPlaylistTracks && !!provider?.library?.getUserPlaylists
  const canSave = sourceSet.size > 0 && [...sourceSet].every((item) => item === 'netease' || item === 'qq')
  const count = tracks.length + collections.length

  useEffect(() => {
    operation.current?.abort()
    setBusy(false)
    setWriting(false)
    setPicker(false)
    setError('')
    setTargets([])
    setTargetId('')
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

  async function choosePlaylist(signal: AbortSignal) {
    if (!provider || !canWrite || !isProviderParticipating(provider.descriptor.id)) return
    const session = providerAccountSession(provider.descriptor.id)
    const playlists = await provider.library!.getUserPlaylists!()
    if (signal.aborted || session !== providerAccountSession(provider.descriptor.id)) return
    setTargets(playlists.filter((item) => item.writable === true && item.type !== 'album'))
    setPicker(true)
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
        <button type="button" disabled={busy || !count || !canWrite} title={canWrite ? undefined : '请选择同一平台的歌曲或专辑；目前支持网易云自建歌单'} onClick={() => void run(choosePlaylist)}>添加到歌单</button>
        {canSave && <button type="button" disabled={busy || !count} onClick={() => void run(async (signal) => {
          const resolved = await resolveBatchTracks(tracks, collections, signal)
          if (signal.aborted) return
          const added = await useOfflineCacheStore.getState().saveMany(resolved, signal)
          if (signal.aborted) return
          useToastStore.getState().show(added ? `${added} 首已加入下载队列` : '所选歌曲已在下载队列中')
          onDone?.()
        })}>批量下载</button>}
        {busy && <><span role="status">{writing ? '正在添加歌曲…' : '处理中…'}</span>{!writing && <button type="button" onClick={() => { operation.current?.abort(); setBusy(false) }}>取消操作</button>}</>}
      </div>
      {picker && (
        <div className={styles.picker} role="region" aria-label="选择目标歌单">
          {targets.length ? <>
            <label>添加到你的歌单<select aria-label="目标歌单" value={targetId} disabled={busy} onChange={(event) => setTargetId(event.target.value)}>
              <option value="">请选择歌单</option>
              {targets.map((item) => <option key={String(item.id)} value={String(item.id)}>{item.name}</option>)}
            </select></label>
            <button type="button" disabled={busy || !targetId} onClick={() => void run(async (signal) => {
              const target = targets.find((item) => String(item.id) === targetId)
              if (!target || !provider || !isProviderId(target.source)) return
              const account = providerAccountSession(target.source)
              const resolved = await resolveBatchTracks(tracks, collections, signal)
              if (signal.aborted) return
              if (account !== providerAccountSession(target.source)) throw new Error('账号已变化，请重新选择歌单')
              if (!resolved.length) throw new Error('没有可添加的歌曲')
              if (resolved.some((track) => track.source !== target.source)) throw new Error('只能添加同平台歌曲')
              setWriting(true)
              let success: boolean
              try {
                // 确认提交后继续等待实际写入结果，离页只取消界面反馈。
                success = await provider.playlistWriter!.addPlaylistTracks!(target.id, resolved.map((track) => track.id))
              } finally {
                // 已提交的上游写入可能完成，即使关闭页面也失效旧列表。
                invalidatePlaylistCache(target)
                clearProviderRequestCache(target.source)
                if (!signal.aborted) setWriting(false)
              }
              if (signal.aborted || account !== providerAccountSession(target.source)) return
              if (!success) throw new Error('添加失败，请重试')
              setPicker(false)
              useToastStore.getState().show(`已添加 ${resolved.length} 首到「${target.name}」`)
              onDone?.()
            })}>确认添加</button>
          </> : <span>暂无可写歌单，请先在网易云创建普通歌单。</span>}
          <button type="button" disabled={busy} onClick={() => setPicker(false)}>收起</button>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
