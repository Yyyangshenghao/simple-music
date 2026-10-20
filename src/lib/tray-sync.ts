import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { useVisualStore } from '../stores/visual'

let stopTraySync: (() => void) | undefined

export function initTraySync(): () => void {
  if (stopTraySync) return stopTraySync
  const desktop = window.desktop
  if (!desktop?.updateTrayPlayback) return () => {}
  const push = () => {
    const player = usePlayerStore.getState()
    void desktop.updateTrayPlayback({
      title: player.currentTrack?.name ?? '', artist: player.currentTrack?.artist ?? '',
      hasTrack: !!player.currentTrack,
      playing: player.status === 'playing' || (player.currentTrack?.source === 'apple' && player.status === 'loading'),
      canSkip: usePlaylistStore.getState().queue.length > 0,
      volume: player.volume, desktopLyrics: useVisualStore.getState().fx.desktopLyrics
    }).catch(() => {})
  }
  push()
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (state.currentTrack !== previous.currentTrack || state.status !== previous.status || state.volume !== previous.volume) push()
  })
  const stopQueue = usePlaylistStore.subscribe((state, previous) => {
    if (state.queue !== previous.queue) push()
  })
  const stopLyrics = useVisualStore.subscribe((state, previous) => {
    if (state.fx.desktopLyrics !== previous.fx.desktopLyrics) push()
  })
  let stopped = false
  stopTraySync = () => {
    if (stopped) return
    stopped = true
    stopPlayer()
    stopQueue()
    stopLyrics()
    stopTraySync = undefined
  }
  return stopTraySync
}
