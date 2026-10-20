import { lyricPlaybackPosition } from './lyric-playback-position'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useGameModeStore } from '../stores/game-mode'
import { useVisualStore } from '../stores/visual'

function startClock(lowPower: boolean): () => void {
  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined
  const tick = () => {
    if (disposed) return
    const state = usePlayerStore.getState()
    useLyricsStore.getState().tick(state.playbackTransport === 'musickit'
      ? lyricPlaybackPosition(state)
      : state.position)
  }
  const syncTimer = () => {
    const state = usePlayerStore.getState()
    const continuous = state.playbackTransport === 'musickit' && state.status === 'playing'
    if (continuous && timer === undefined) timer = setInterval(tick, lowPower ? 250 : 50)
    else if (!continuous && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
  tick()
  syncTimer()
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (state.position !== previous.position || state.status !== previous.status
      || state.playbackTransport !== previous.playbackTransport || state.currentTrack !== previous.currentTrack) tick()
    if (state.status !== previous.status || state.playbackTransport !== previous.playbackTransport) syncTimer()
  })
  const stopOffset = useLyricsStore.subscribe((state, previous) => {
    if (state.offsetSec !== previous.offsetSec) tick()
  })
  return () => {
    disposed = true
    stopPlayer()
    stopOffset()
    if (timer !== undefined) clearInterval(timer)
  }
}

let stopLyricsClock: (() => void) | undefined

/** 歌词时钟随宿主存活；游戏纯播放不订阅位置，桌面歌词仅保留低频时钟。 */
export function initLyricsClock(): () => void {
  if (stopLyricsClock) return stopLyricsClock
  let mode: 'off' | 'normal' | 'low' | undefined
  let stopClock: (() => void) | undefined
  const sync = () => {
    const game = useGameModeStore.getState().enabled
    const next = game ? useVisualStore.getState().fx.desktopLyrics ? 'low' : 'off' : 'normal'
    if (mode === next) return
    stopClock?.()
    mode = next
    stopClock = next === 'off' ? undefined : startClock(next === 'low')
  }
  const stopGame = useGameModeStore.subscribe((state, previous) => {
    if (state.enabled !== previous.enabled) sync()
  })
  const stopVisual = useVisualStore.subscribe((state, previous) => {
    if (state.fx.desktopLyrics !== previous.fx.desktopLyrics) sync()
  })
  sync()
  let stopped = false
  stopLyricsClock = () => {
    if (stopped) return
    stopped = true
    stopGame()
    stopVisual()
    stopClock?.()
    stopLyricsClock = undefined
  }
  return stopLyricsClock
}
