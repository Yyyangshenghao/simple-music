import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MINI_PLAYER_APPEARANCE, MINI_PLAYER_LYRICS_WIDTH } from './mini-player-config'
import { useSettingsStore } from '../stores/settings'
import { useShortcutStore } from '../stores/shortcuts'
import { usePlayerStore } from '../stores/player'
import { useLyricsStore } from '../stores/lyrics'
import { useAmbientStore } from '../stores/ambient'
import { useGameModeStore } from '../stores/game-mode'
import { initMiniPlayerSync } from './mini-player-sync'
import type { Track } from '../types/domain'

let stopSync: (() => void) | undefined
let onWidth: (payload: { width: number }) => void
const update = vi.fn(async () => ({ ok: true }))
const enable = vi.fn(async () => ({ ok: true }))
const offWidth = vi.fn()
const widthChanged = vi.fn((callback: typeof onWidth) => { onWidth = callback; return offWidth })
const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: 1, name: '第一首', artist: '歌手', artists: [], duration: 240_000 }

describe('宿主持有迷你条同步，只推送实际展示的数据', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    stopSync = undefined
    useSettingsStore.setState({ miniPlayerEnabled: true, miniPlayerWidth: 360,
      miniPlayerAppearance: { ...DEFAULT_MINI_PLAYER_APPEARANCE },
      localHotkeys: [{ action: 'mini-player', accelerator: 'CommandOrControl+Shift+P' }], hotkeys: [], globalHotkeysEnabled: false })
    useShortcutStore.setState({ recording: false, pending: false, results: [] })
    usePlayerStore.setState({ currentTrack: track, status: 'playing', volume: 1, duration: 240, position: 10 })
    useLyricsStore.setState({ trackKey: 'netease:1', currentIndex: 0, lines: [{ time: 0, text: '第一句' }, { time: 12, text: '第二句' }] })
    useAmbientStore.setState({ palette: ['#5227ff', '#000000', '#ffffff'] })
    useGameModeStore.setState({ enabled: false, initialized: true })
    vi.stubGlobal('window', { desktop: { platform: 'darwin', updateMiniPlayer: update, setMiniPlayerEnabled: enable, onMiniPlayerWidthChanged: widthChanged } })
  })
  afterEach(() => {
    stopSync?.()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('游戏模式停止推送与进度计时，保留偏好，退出后重放最新状态', () => {
    useGameModeStore.setState({ enabled: true })
    stopSync = initMiniPlayerSync()
    expect(update).not.toHaveBeenCalled()
    expect(enable).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(useSettingsStore.getState().miniPlayerEnabled).toBe(true)
    usePlayerStore.setState({ currentTrack: track, position: 18 })
    useGameModeStore.setState({ enabled: false })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ trackTitle: '第一首' }))
    expect(update).toHaveBeenLastCalledWith({ position: 18 })
    expect(vi.getTimerCount()).toBe(1)
    update.mockClear()
    useGameModeStore.setState({ enabled: true })
    vi.advanceTimersByTime(5000)
    expect(update).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(enable).not.toHaveBeenCalled()
  })

  it('紧凑条和隐藏歌词不因换行或逐字进度推送', () => {
    stopSync = initMiniPlayerSync()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ lyricLine: '' }))
    update.mockClear()
    useLyricsStore.setState({ currentIndex: 1, currentCharProgress: 0.5 })
    expect(update).not.toHaveBeenCalled()
    useSettingsStore.getState().setMiniPlayerWidth(MINI_PLAYER_LYRICS_WIDTH)
    expect(update).toHaveBeenLastCalledWith({ lyricLine: '第二句' })
    useSettingsStore.getState().setMiniPlayerAppearance({ showLyrics: false })
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ lyricLine: '' }))
    update.mockClear()
    useLyricsStore.setState({ currentIndex: 0 })
    expect(update).not.toHaveBeenCalled()
  })

  it('全局关闭时同步应用内返回键，自定义修改后使用新键', () => {
    stopSync = initMiniPlayerSync()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ returnShortcut: 'Command+Shift+P' }))
    useSettingsStore.getState().setLocalHotkeys([{ action: 'mini-player', accelerator: 'Control+Shift+J' }])
    expect(update).toHaveBeenLastCalledWith({ returnShortcut: 'Control+Shift+J' })
  })

  it('相同全局键注册中或成功时不重复处理，失败后恢复本地键', () => {
    useSettingsStore.setState({ globalHotkeysEnabled: true, hotkeys: [{ action: 'mini-player', accelerator: 'Command+Shift+P' }] })
    useShortcutStore.setState({ pending: true })
    stopSync = initMiniPlayerSync()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ returnShortcut: '' }))
    update.mockClear()
    useShortcutStore.setState({ pending: false, results: [{ action: 'mini-player', accelerator: 'Command+Shift+P', ok: true }] })
    expect(update).not.toHaveBeenCalled()
    useShortcutStore.setState({ results: [{ action: 'mini-player', accelerator: 'Command+Shift+P', ok: false }] })
    expect(update).toHaveBeenLastCalledWith({ returnShortcut: 'Command+Shift+P' })
  })

  it('录入、清除、系统保留键与关闭迷你条时不响应返回键', () => {
    useShortcutStore.setState({ recording: true })
    stopSync = initMiniPlayerSync()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ returnShortcut: '' }))
    useShortcutStore.setState({ recording: false })
    useSettingsStore.setState({ localHotkeys: [] })
    expect(update).toHaveBeenLastCalledWith({ returnShortcut: '' })
    update.mockClear()
    useSettingsStore.setState({ localHotkeys: [{ action: 'mini-player', accelerator: 'Command+M' }] })
    expect(update).not.toHaveBeenCalled()
    useSettingsStore.getState().setMiniPlayerEnabled(false)
    usePlayerStore.setState({ position: 30, volume: 0.5 })
    vi.advanceTimersByTime(5000)
    expect(update).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    // sync-off 只落设置，不能反向调用主进程关闭/打开窗口。
    expect(enable).not.toHaveBeenCalled()
  })

  it('展开后同步当前歌词，逐字变化不重复发送', () => {
    useSettingsStore.setState({ miniPlayerWidth: MINI_PLAYER_LYRICS_WIDTH })
    stopSync = initMiniPlayerSync()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ lyricLine: '第一句' }))
    useLyricsStore.setState({ currentIndex: 1 })
    expect(update).toHaveBeenLastCalledWith({ lyricLine: '第二句' })
    update.mockClear()
    useLyricsStore.setState({ currentCharProgress: 0.7 })
    expect(update).not.toHaveBeenCalled()
  })

  it('曲目先切换而歌词尚未更新时清空旧词，只消费当前曲目归属', () => {
    useSettingsStore.setState({ miniPlayerWidth: MINI_PLAYER_LYRICS_WIDTH })
    stopSync = initMiniPlayerSync()
    update.mockClear()
    usePlayerStore.setState({ currentTrack: { ...track, id: 2, name: '新歌曲' }, status: 'loading', position: 0 })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ trackTitle: '新歌曲', lyricLine: '' }))
    useLyricsStore.setState({ trackKey: 'netease:2', currentIndex: 0, lines: [{ time: 0, text: '新歌词' }] })
    expect(update).toHaveBeenLastCalledWith({ lyricLine: '新歌词' })
  })

  it('关闭进度不启动计时，运行中开关按当前进度恢复', () => {
    useSettingsStore.getState().setMiniPlayerAppearance({ showProgress: false })
    stopSync = initMiniPlayerSync()
    update.mockClear()
    vi.advanceTimersByTime(5000)
    expect(update).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    usePlayerStore.setState({ position: 33 })
    useSettingsStore.getState().setMiniPlayerAppearance({ showProgress: true })
    expect(update).toHaveBeenLastCalledWith({ position: 33 })
    expect(vi.getTimerCount()).toBe(1)
    useSettingsStore.getState().setMiniPlayerAppearance({ showProgress: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('播放中位置变化只以 1Hz 推送，重复启动不增加计时或自行调用窗口开关', () => {
    stopSync = initMiniPlayerSync()
    expect(initMiniPlayerSync()).toBe(stopSync)
    expect(widthChanged).toHaveBeenCalledOnce()
    expect(enable).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    update.mockClear()
    for (let position = 11; position <= 20; position++) usePlayerStore.setState({ position })
    expect(update).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith({ position: 20 })
  })

  it.each(['apple', 'netease', 'qq', 'local'] as const)('%s 加载时仅 Apple 按钮显示继续中，均不启动进度计时', source => {
    usePlayerStore.setState({ currentTrack: { ...track, source }, status: 'loading' })
    stopSync = initMiniPlayerSync()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ playing: source === 'apple' }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('暂停拖动立即同步，播放切曲补推一次，元数据/氛围各自变化才发送', () => {
    usePlayerStore.setState({ currentTrack: track, status: 'paused' })
    stopSync = initMiniPlayerSync()
    update.mockClear()
    usePlayerStore.setState({ position: 42 })
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith({ position: 42 })
    usePlayerStore.setState({ status: 'playing', position: 43 })
    expect(update).toHaveBeenLastCalledWith({ position: 43 })
    usePlayerStore.setState({ currentTrack: { ...track, id: 2, name: '第二首' }, position: 0 })
    expect(update).toHaveBeenNthCalledWith(update.mock.calls.length - 1, { trackTitle: '第二首' })
    expect(update).toHaveBeenLastCalledWith({ position: 0 })
    useAmbientStore.setState({ palette: ['#ff0000', '#000000', '#ffffff'] })
    expect(update).toHaveBeenLastCalledWith({ accent: '#ff0000' })
  })

  it('宽度回传更新设置，停止后旧事件、store 变化和定时器均不再生效', () => {
    stopSync = initMiniPlayerSync()
    onWidth({ width: MINI_PLAYER_LYRICS_WIDTH })
    expect(useSettingsStore.getState().miniPlayerWidth).toBe(MINI_PLAYER_LYRICS_WIDTH)
    expect(update).toHaveBeenLastCalledWith({ lyricLine: '第一句' })
    stopSync()
    stopSync()
    expect(offWidth).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    update.mockClear()
    onWidth({ width: 360 })
    usePlayerStore.setState({ position: 50, volume: 0.5 })
    useSettingsStore.setState({ localHotkeys: [] })
    useLyricsStore.setState({ currentIndex: 1 })
    useAmbientStore.setState({ palette: ['#ff0000', '#000000', '#ffffff'] })
    useShortcutStore.setState({ recording: true })
    useGameModeStore.setState({ enabled: true })
    vi.advanceTimersByTime(5000)
    expect(useSettingsStore.getState().miniPlayerWidth).toBe(MINI_PLAYER_LYRICS_WIDTH)
    expect(update).not.toHaveBeenCalled()
    expect(enable).not.toHaveBeenCalled()
  })
})
