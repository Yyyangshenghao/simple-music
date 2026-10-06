import { create } from 'zustand'
import { api } from '../lib/api'
import { usePlayerStore, registerTrackEndedHandler } from './player'
import { useSettingsStore } from './settings'
import { isProviderParticipating, useProviderStore } from './providers'
import { serviceFor } from '../lib/service-registry'
import { preloadTracks } from '../lib/track-preload'
import { fetchQueueDetails, resolvePending } from '../lib/queue-details'
import { isValidPermutation, queueDisplayOrder } from '../lib/queue-display'
import { isProviderId } from '../providers/types'
import type { ProviderId } from '../providers/types'
import type { Playlist, Track, ShelfMode } from '../types/domain'

/** Fisher-Yates 洗牌出 [0, n) 的随机排列。 */
function shuffledIndices(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

function movedIndices(length: number, from: number, to: number): number[] {
  const indices = Array.from({ length }, (_, index) => index)
  indices.splice(to, 0, indices.splice(from, 1)[0])
  return indices
}

interface PlaylistStore {
  playlists: Playlist[]
  /** 这批用户歌单属于哪个平台；平台入口切换后 UI 需显式重拉。 */
  playlistsSource: ProviderId | null
  currentPlaylist: Playlist | null
  queue: Track[]
  queueIndex: number
  /** 当前队列的播放语境(来源歌单/专辑 id);供听歌打卡上报用,没有语境(搜索/歌手页)则为 null。 */
  queueContextId: unknown
  /** 随机模式的洗牌排列(队列下标序列);长度与 queue 不一致时懒重建。 */
  shuffleOrder: number[]
  shelfVisible: boolean
  shelfMode: ShelfMode
  loadUserPlaylists(source: ProviderId): Promise<void>
  setCurrentPlaylist(p: Playlist | null): void
  setQueue(tracks: Track[], startIndex?: number, contextId?: unknown): void
  addToQueue(track: Track): void
  addManyToQueue(tracks: Track[], offline?: boolean): number
  /** 按面板显示位置移动曲目；随机模式下移动实际洗牌顺序。 */
  moveQueueItem(fromDisplayIndex: number, toDisplayIndex: number): void
  playNextInQueue(index: number): void
  removeQueueItem(index: number): void
  /** 补全可见范围的占位曲目，不改变播放位置。 */
  ensureQueueDetails(indices: number[]): Promise<void>
  playAt(index: number): void
  next(): void
  prev(): void
  /** 自然播完的走序:单曲循环原地重播,其余同 next()。 */
  handleTrackEnded(): void
  toggleShelf(): void
  setShelfMode(mode: ShelfMode): void
}

/** 按播放模式算 next/prev 的目标下标;随机模式沿洗牌排列循环走,长度失配时懒重建。 */
function stepIndex(
  s: Pick<PlaylistStore, 'queue' | 'queueIndex' | 'shuffleOrder'>,
  set: (partial: Partial<PlaylistStore>) => void,
  dir: 1 | -1
): number {
  const len = s.queue.length
  if (!len) return -1
  if (useSettingsStore.getState().playMode !== 'shuffle') {
    return (s.queueIndex + dir + len) % len
  }
  let order = s.shuffleOrder
  if (order.length !== len) {
    order = shuffledIndices(len)
    set({ shuffleOrder: order })
  }
  const pos = order.indexOf(s.queueIndex)
  return order[(pos + dir + len) % len]
}

// 切歌落定 1 秒后预载前/后曲目(URL 预解析 + 封面预热),不与当前曲目起播抢网络;
// 快速连点只保留最后一次。走序与 next/prev 一致(含随机模式的洗牌排列)。
let preloadTimer: ReturnType<typeof setTimeout> | null = null
let userPlaylistsSession = 0
let playAtSession = 0

function schedulePreloadNeighbors() {
  if (preloadTimer) clearTimeout(preloadTimer)
  preloadTimer = setTimeout(() => {
    preloadTimer = null
    const s = usePlaylistStore.getState()
    if (s.queueIndex < 0 || s.queue.length < 2) return
    const applyPartial = (p: Partial<PlaylistStore>) => usePlaylistStore.setState(p)
    const targets: Track[] = []
    for (const dir of [+1, -1] as const) {
      const idx = stepIndex(usePlaylistStore.getState(), applyPartial, dir)
      const t = usePlaylistStore.getState().queue[idx]
      if (
        idx !== s.queueIndex
        && t
        && (!isProviderId(t.source) || isProviderParticipating(t.source))
        && !targets.includes(t)
      ) targets.push(t)
    }
    if (!targets.length) return
    const player = usePlayerStore.getState()
    // 离开普通队列进入刷歌后，旧的延时任务不能覆盖刷歌刚建立的相邻预加载窗口。
    if (String(player.contextId ?? '').startsWith('shuange:')) return
    preloadTracks(targets, player.quality, player.currentTrack)
  }, 1000)
}

export const usePlaylistStore = create<PlaylistStore>((set, get) => ({
  playlists: [],
  playlistsSource: null,
  currentPlaylist: null,
  queue: [],
  queueIndex: -1,
  queueContextId: null,
  shuffleOrder: [],
  shelfVisible: false,
  shelfMode: 'dynamic',

  async loadUserPlaylists(source) {
    const session = ++userPlaylistsSession
    const providerState = useProviderStore.getState().byId[source]
    if (!providerState.enabled || providerState.auth !== 'authenticated') {
      set({ playlists: [], playlistsSource: source })
      return
    }
    const service = serviceFor(source)
    if (!service.getUserPlaylists) {
      set({ playlists: [], playlistsSource: source })
      return
    }
    try {
      const playlists = await service.getUserPlaylists()
      if (session !== userPlaylistsSession || !isProviderParticipating(source)) return
      set({ playlists, playlistsSource: source })
    } catch {
      if (session !== userPlaylistsSession) return
      set({ playlists: [], playlistsSource: source })
    }
  },

  setCurrentPlaylist(p) {
    set({ currentPlaylist: p })
  },

  setQueue(tracks, startIndex = 0, contextId = null) {
    set({ queue: tracks, queueIndex: -1, queueContextId: contextId, shuffleOrder: shuffledIndices(tracks.length) })
    if (tracks.length) get().playAt(startIndex)
  },

  addToQueue(track) {
    set((s) => ({
      queue: [...s.queue, track],
      shuffleOrder: s.shuffleOrder.length === s.queue.length
        ? [...s.shuffleOrder, s.queue.length]
        : shuffledIndices(s.queue.length + 1),
    }))
  },

  addManyToQueue(tracks, offline = false) {
    const state = get()
    const known = new Set(state.queue.map((track) => `${track.source}:${String(track.id)}`))
    const incoming = tracks.filter((track) => {
      const key = `${track.source}:${String(track.id)}`
      // 离线列表已确认网易/QQ 文件可用，不要求账号参与；Apple 仍依赖官网会话。
      if (known.has(key) || track.playable === false || ((!offline || track.source === 'apple') && isProviderId(track.source) && !isProviderParticipating(track.source))) return false
      known.add(key)
      return true
    })
    if (!incoming.length) return 0
    set({
      queue: [...state.queue, ...incoming],
      shuffleOrder: isValidPermutation(state.shuffleOrder, state.queue.length)
        ? [...state.shuffleOrder, ...incoming.map((_, index) => state.queue.length + index)]
        : shuffledIndices(state.queue.length + incoming.length),
    })
    return incoming.length
  },

  moveQueueItem(fromDisplayIndex, toDisplayIndex) {
    const state = get()
    const length = state.queue.length
    if (!Number.isInteger(fromDisplayIndex) || !Number.isInteger(toDisplayIndex)
      || fromDisplayIndex < 0 || fromDisplayIndex >= length
      || toDisplayIndex < 0 || toDisplayIndex >= length
      || fromDisplayIndex === toDisplayIndex) return

    if (useSettingsStore.getState().playMode === 'shuffle') {
      const display = queueDisplayOrder(length, state.queueIndex, state.shuffleOrder, 'shuffle').indices
      const order = [...display]
      order.splice(toDisplayIndex, 0, order.splice(fromDisplayIndex, 1)[0])
      set({ shuffleOrder: order })
    } else {
      const indices = movedIndices(length, fromDisplayIndex, toDisplayIndex)
      const nextIndex = new Map(indices.map((oldIndex, index) => [oldIndex, index]))
      set({
        queue: indices.map((index) => state.queue[index]),
        queueIndex: nextIndex.get(state.queueIndex) ?? -1,
        shuffleOrder: isValidPermutation(state.shuffleOrder, length)
          ? state.shuffleOrder.map((index) => nextIndex.get(index)!)
          : [],
      })
    }
    schedulePreloadNeighbors()
  },

  playNextInQueue(index) {
    const state = get()
    if (useSettingsStore.getState().playMode === 'one') return
    if (!Number.isInteger(index) || index < 0 || index >= state.queue.length || index === state.queueIndex) return
    const display = queueDisplayOrder(
      state.queue.length, state.queueIndex, state.shuffleOrder, useSettingsStore.getState().playMode
    )
    const from = display.indices.indexOf(index)
    const current = display.currentDisplayIndex
    if (from < 0 || current < 0) return
    const to = current === state.queue.length - 1 ? 0 : from < current ? current : current + 1
    get().moveQueueItem(from, to)
  },

  removeQueueItem(index) {
    const state = get()
    if (!Number.isInteger(index) || index < 0 || index >= state.queue.length || index === state.queueIndex) return
    set({
      queue: state.queue.filter((_, itemIndex) => itemIndex !== index),
      queueIndex: state.queueIndex > index ? state.queueIndex - 1 : state.queueIndex,
      shuffleOrder: isValidPermutation(state.shuffleOrder, state.queue.length)
        ? state.shuffleOrder.filter((itemIndex) => itemIndex !== index).map((itemIndex) => itemIndex > index ? itemIndex - 1 : itemIndex)
        : [],
    })
    schedulePreloadNeighbors()
  },

  async ensureQueueDetails(indices) {
    const queue = get().queue
    const tracks = [...new Set(indices.map((index) => queue[index]).filter((track) => track?.pending))]
    if (!tracks.length) return
    const details = await fetchQueueDetails(tracks)
    if (!details.size) return
    // 用原曲目对象定位，重排后仍可补全；换队列或移除后的旧响应不会写错位置。
    set((state) => {
      const nextQueue = state.queue.map((track) => details.get(track) ?? track)
      return nextQueue.some((track, index) => track !== state.queue[index]) ? { queue: nextQueue } : state
    })
  },

  playAt(index) {
    const track = get().queue[index]
    if (!track) return
    // 网易/QQ 交给播放器先查离线文件；Apple 仍要求可用的官网会话。
    if (track.source === 'apple' && !isProviderParticipating(track.source)) return
    const session = ++playAtSession
    set({ queueIndex: index })
    schedulePreloadNeighbors()
    const contextId = get().queueContextId
    void usePlayerStore.getState().loadTrack(track, { contextId })
    if (!track.pending) return
    void resolvePending(track).then((resolved) => {
      const { queue, queueIndex } = get()
      // 等待补详情期间允许队列重排；若当前播放目标已变则丢弃。
      if (session !== playAtSession || (queue[queueIndex] !== track && queue[queueIndex] !== resolved)) return
      const nextQueue = [...queue]
      nextQueue[queueIndex] = resolved
      set({ queue: nextQueue })
    })
  },

  next() {
    get().playAt(stepIndex(get(), set, +1))
  },

  prev() {
    get().playAt(stepIndex(get(), set, -1))
  },

  handleTrackEnded() {
    if (useSettingsStore.getState().playMode === 'one') {
      const player = usePlayerStore.getState()
      if (!player.currentTrack) return
      player.seek(0)
      player.play()
      return
    }
    get().next()
  },

  toggleShelf() {
    set((s) => ({ shelfVisible: !s.shelfVisible }))
  },

  setShelfMode(mode) {
    set({ shelfMode: mode })
  }
}))

// 自然播完后的走序(列表循环/随机切下一首,单曲循环原地重播)
registerTrackEndedHandler(() => usePlaylistStore.getState().handleTrackEnded())
