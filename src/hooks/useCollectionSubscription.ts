import { useEffect, useState } from 'react'
import { isWritablePlaylistSource, setPlatformCollectionSubscribed } from '../lib/platform-playlists'
import { loadProviderLibrary } from '../lib/provider-library'
import { providerAccountSession } from '../lib/provider-account-session'
import { providerFor } from '../providers/registry'
import { usePlatformPlaylistsStore } from '../stores/platform-playlists'
import { useLikesStore } from '../stores/likes'
import { useProviderStore } from '../stores/providers'
import { useToastStore } from '../stores/toast'
import type { Playlist } from '../types/domain'

/** own=自己创建（不可收藏），unknown=尚未读到或平台不支持。 */
export type CollectionState = 'own' | 'subscribed' | 'none' | 'unknown'

/** 他人歌单/专辑的收藏状态以「我的库 → 收藏」读到的账号列表为准，切换后随列表一起刷新。 */
export function useCollectionSubscription(playlist: Playlist) {
  const source = playlist.source
  const supported = isWritablePlaylistSource(source) && !!providerFor(source).playlistWriter?.setCollectionSubscribed
  const id = String(playlist.id)
  const album = playlist.type === 'album'
  const participating = useProviderStore(state => supported && isWritablePlaylistSource(source)
    && state.byId[source].enabled && state.byId[source].auth === 'authenticated' && state.byId[source].playbackAvailable !== false)
  const revision = usePlatformPlaylistsStore(state => isWritablePlaylistSource(source) ? state.revision[source] : 0)
  const qqRevision = useLikesStore(state => source === 'qq' ? state.qqMutationRevision : 0)
  // identity 决定展示归属，revision 只触发重读；重读期间沿用上次状态，按钮不闪烁。
  const identity = `${source}:${album}:${id}:${supported ? providerAccountSession(source) : 0}`
  const key = `${identity}:${revision}:${qqRevision}`
  const [loaded, setLoaded] = useState<{ identity: string; state: CollectionState } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!participating || !isWritablePlaylistSource(source)) return
    let cancelled = false
    const has = (items: Playlist[]) => items.some(item => String(item.id) === id)
    const load = album
      ? loadProviderLibrary(source, 'albums').then(items => has(items) ? 'subscribed' as const : 'none' as const)
      : Promise.all([loadProviderLibrary(source, 'playlists'), loadProviderLibrary(source, 'collected')])
        .then(([own, collected]) => has(own) ? 'own' as const : has(collected) ? 'subscribed' as const : 'none' as const)
    void load.then(state => { if (!cancelled) setLoaded({ identity, state }) }).catch(() => {})
    return () => { cancelled = true }
  }, [key, participating]) // eslint-disable-line react-hooks/exhaustive-deps

  const state: CollectionState = participating && loaded?.identity === identity ? loaded.state : 'unknown'

  async function toggle() {
    if (busy || (state !== 'subscribed' && state !== 'none')) return
    const subscribe = state === 'none'
    setBusy(true)
    try {
      const subscribed = await setPlatformCollectionSubscribed(playlist, subscribe)
      setLoaded({ identity, state: subscribed ? 'subscribed' : 'none' })
      useToastStore.getState().show(subscribed ? `已收藏${album ? '专辑' : '歌单'}` : '已取消收藏')
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : '收藏操作失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return { state, busy, toggle }
}
