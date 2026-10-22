import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { lyricPlaybackPosition } from './lyric-playback-position'

export interface LyricFrame {
  /** 歌词时间轴上的秒数（已含用户歌词偏移） */
  time: number
  /** 正在逐帧推进：播放中且页面可见 */
  running: boolean
  /** performance.now() */
  now: number
}

type Listener = (frame: LyricFrame) => void

/**
 * 动态歌词样式共用的帧时钟：全局只开一个 rAF 循环。
 * 播放且页面可见时逐帧推送；暂停、隐藏时停帧，拖动、暂停和歌词偏移变化各推送一次，
 * 样式不必各自订阅播放器或自己开定时器。
 */
const listeners = new Set<Listener>()
let raf = 0
let detach: (() => void) | null = null

function frame(now = performance.now()): LyricFrame {
  const player = usePlayerStore.getState()
  const running = player.status === 'playing' && !document.hidden
  return { time: lyricPlaybackPosition(player) + useLyricsStore.getState().offsetSec, running, now }
}

function emit(value: LyricFrame): void {
  for (const listener of [...listeners]) {
    try { listener(value) } catch (error) { console.error('[lyric-frame-clock]', error) }
  }
}

function loop(now: number): void {
  raf = 0
  const value = frame(now)
  emit(value)
  // 监听器在推送中触发 refresh 时已排好下一帧，不再重复排，保持只有一条循环。
  if (value.running && listeners.size && !raf) raf = requestAnimationFrame(loop)
}

/** 状态变化时推送一次，并按需启停逐帧循环。 */
function refresh(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  const value = frame()
  emit(value)
  if (value.running && listeners.size && !raf) raf = requestAnimationFrame(loop)
}

function attach(): () => void {
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (state.status !== previous.status || state.currentTrack !== previous.currentTrack) refresh()
    // 暂停时拖动进度：没有逐帧循环，要单独推送。
    else if (!raf && state.position !== previous.position) refresh()
  })
  const stopLyrics = useLyricsStore.subscribe((state, previous) => {
    if (state.offsetSec !== previous.offsetSec && !raf) refresh()
  })
  document.addEventListener('visibilitychange', refresh)
  return () => {
    stopPlayer()
    stopLyrics()
    document.removeEventListener('visibilitychange', refresh)
  }
}

/** 当前帧（不订阅）：参数或排版变化后、暂停没有新推送时，样式用它立刻按当前时间重写一次。 */
export function readLyricFrame(): LyricFrame {
  return frame()
}

export function subscribeLyricFrames(listener: Listener): () => void {
  listeners.add(listener)
  detach ??= attach()
  // 新订阅者立刻拿到当前位置；正在逐帧时下一帧自然会带上它。
  if (raf) listener(frame())
  else refresh()
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    detach?.()
    detach = null
  }
}
