import { lyricPlaybackPosition } from './lyric-playback-position'
import { hasWordTiming } from './word-highlight-timeline'
import type { LyricsPayload } from '../types/ipc'
import { useLyricsStore } from '../stores/lyrics'
import { useVisualStore } from '../stores/visual'
import { useToastStore } from '../stores/toast'
import { useSettingsStore } from '../stores/settings'
import { usePlayerStore } from '../stores/player'
import { useGameModeStore } from '../stores/game-mode'
import type { WordLyricLine } from '../types/domain'

function readWordClock(wordLine: WordLyricLine | undefined): LyricsPayload['wordClock'] {
  if (!wordLine) return undefined
  const player = usePlayerStore.getState()
  return {
    elapsedMs: (lyricPlaybackPosition(player) + useLyricsStore.getState().offsetSec - wordLine.time) * 1000,
    playing: player.status === 'playing',
    rate: player.rate
  }
}

let stopDesktopLyricsSync: (() => void) | undefined

/** 宿主持有桌面歌词展示同步；原生窗口仍由主进程管理。 */
export function initDesktopLyricsSync(): () => void {
  if (stopDesktopLyricsSync) return stopDesktopLyricsSync
  const desktop = window.desktop
  if (!desktop?.updateDesktopLyrics) return () => {}
  let disposed = false
  let sizeFromWindow: number | null = null
  let previousPayload: LyricsPayload | undefined
  let previousEnabled: boolean | undefined
  let previousSequence: number | undefined
  let request = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let clock: { key: string; index: number; line: WordLyricLine } | undefined
  const sync = () => {
    if (disposed) return
    const { currentIndex, lines, translation, romaji, trackKey, wordLines, loading } = useLyricsStore.getState()
    const currentTrack = usePlayerStore.getState().currentTrack
    const fx = useVisualStore.getState().fx
    const settings = useSettingsStore.getState()
    const game = useGameModeStore.getState()
    const gameEnabled = game.enabled
    const enabled = fx.desktopLyrics
    const size = fx.desktopLyricsSize
    const fontFamily = fx.desktopLyricsFontFamily || settings.fontFamily
    const fontFamilyCjk = fx.desktopLyricsFontFamilyCjk || settings.fontFamilyCjk
    const { desktopLyricsColor: color, desktopLyricsOpacity: opacity, desktopLyricsClickThrough: clickThrough,
      desktopLyricsShowTranslation: showTranslation, desktopLyricsBackgroundOpacity: backgroundOpacity,
      desktopLyricsShowRoma: showRoma } = fx
    const highlight = !gameEnabled && fx.desktopLyricsHighlight
    const platform = desktop.platform
    const backgroundStyle = gameEnabled || (platform && platform !== 'darwin' && platform !== 'win32') ? 'dark' : fx.desktopLyricsBackgroundStyle
    const autoWidth = !gameEnabled && fx.desktopLyricsAutoWidth
    const lineMode = gameEnabled ? 'single' : fx.desktopLyricsLineMode
    const wordByWord = !gameEnabled && fx.desktopLyricsWordByWord
    if (sizeFromWindow !== null && size !== sizeFromWindow) sizeFromWindow = null
    const currentKey = currentTrack ? `${currentTrack.source}:${String(currentTrack.id)}` : null
    const matching = !!currentKey && currentKey === trackKey
    const fallback = currentTrack
      ? loading || !matching ? '正在获取歌词…' : lines.length ? currentTrack.name : '暂无歌词 · ' + currentTrack.name
      : '播放音乐后显示歌词'
    const hasCurrentLyric = matching && currentIndex >= 0 && !!lines[currentIndex]?.text
    const candidate = enabled && matching && wordByWord && currentIndex >= 0 ? wordLines[currentIndex] : undefined
    const wordLine = candidate && hasWordTiming(candidate.words)
      && candidate.time === lines[currentIndex]?.time
      && candidate.words.map((word) => word.text).join('') === lines[currentIndex]?.text
      ? candidate : undefined
    const payload: LyricsPayload = {
      trackKey: currentKey, lineIndex: hasCurrentLyric ? currentIndex : -1, lineMode,
      line: matching && currentIndex >= 0 ? (lines[currentIndex]?.text || currentTrack?.name || fallback) : fallback,
      translation: matching && showTranslation && currentIndex >= 0 ? (translation[currentIndex]?.text ?? '') : '',
      roma: matching && showRoma && currentIndex >= 0 ? (romaji[currentIndex]?.text ?? '') : '',
      nextLine: lineMode === 'double'
        ? hasCurrentLyric ? (lines[currentIndex + 1]?.text ?? '') : (currentTrack?.artist ?? '')
        : '',
      autoWidth, wordLine, backgroundOpacity, backgroundStyle,
      ...(size === sizeFromWindow ? {} : { size }), fontFamily, fontFamilyCjk, color, opacity, clickThrough, highlight
    }
    const reconfigure = enabled !== previousEnabled || game.sequence !== previousSequence
    const changed = !previousPayload || Object.keys(payload).some(key => !Object.is(payload[key], previousPayload?.[key]))
      || Object.keys(previousPayload).some(key => !(key in payload))
    previousPayload = payload
    previousEnabled = enabled
    previousSequence = game.sequence
    if (reconfigure) {
      const currentRequest = ++request
      void desktop.setDesktopLyricsEnabled(enabled, { ...payload, size, wordClock: readWordClock(wordLine) }).catch(() => {
        if (!disposed && request === currentRequest) useToastStore.getState().show('桌面歌词切换失败，请重试')
      })
      useLyricsStore.getState().setDesktopLyricsEnabled(enabled)
    }
    if (changed || reconfigure) void desktop.updateDesktopLyrics({ ...payload, wordClock: readWordClock(wordLine) }).catch(() => {})
    clock = enabled && wordLine && currentKey ? { key: currentKey, index: currentIndex, line: wordLine } : undefined
    if (!clock && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    } else if (clock && timer === undefined) {
      timer = setInterval(() => {
        if (disposed || !clock) return
        const player = usePlayerStore.getState()
        const lyrics = useLyricsStore.getState()
        if (!player.currentTrack || `${player.currentTrack.source}:${String(player.currentTrack.id)}` !== clock.key
          || lyrics.trackKey !== clock.key || lyrics.currentIndex !== clock.index) return
        void desktop.updateDesktopLyrics({ wordClock: readWordClock(clock.line) }).catch(() => {})
      }, 50)
    }
  }
  const stopLyrics = useLyricsStore.subscribe((state, previous) => {
    if (state.currentIndex !== previous.currentIndex || state.lines !== previous.lines
      || state.translation !== previous.translation || state.romaji !== previous.romaji
      || state.trackKey !== previous.trackKey || state.wordLines !== previous.wordLines || state.loading !== previous.loading) sync()
  })
  const stopPlayer = usePlayerStore.subscribe((state, previous) => {
    if (state.currentTrack !== previous.currentTrack) sync()
  })
  const stopVisual = useVisualStore.subscribe((state, previous) => {
    if (state.fx !== previous.fx) sync()
  })
  const stopSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.fontFamily !== previous.fontFamily || state.fontFamilyCjk !== previous.fontFamilyCjk) sync()
  })
  const stopGame = useGameModeStore.subscribe((state, previous) => {
    if (state.enabled !== previous.enabled || state.sequence !== previous.sequence) sync()
  })
  const stopEnabled = desktop.onDesktopLyricsEnabledState(({ enabled, requested }) => {
    if (disposed || requested) return
    useVisualStore.getState().updateFx({ desktopLyrics: enabled })
    useLyricsStore.getState().setDesktopLyricsEnabled(enabled)
  })
  const stopLock = desktop.onDesktopLyricsLockState(({ locked }) => {
    if (!disposed) useVisualStore.getState().updateFx({ desktopLyricsClickThrough: locked })
  })
  const stopSize = desktop.onDesktopLyricsSizeState(({ size }) => {
    if (disposed) return
    // 先标记再同步设置，普通更新省略 size，避免把拖拽中的旧尺寸发回窗口。
    sizeFromWindow = size
    useVisualStore.getState().updateFx({ desktopLyricsSize: size })
  })
  sync()
  stopDesktopLyricsSync = () => {
    if (disposed) return
    disposed = true
    if (timer !== undefined) clearInterval(timer)
    clock = undefined
    stopLyrics()
    stopPlayer()
    stopVisual()
    stopSettings()
    stopGame()
    stopEnabled()
    stopLock()
    stopSize()
    stopDesktopLyricsSync = undefined
  }
  return stopDesktopLyricsSync
}
