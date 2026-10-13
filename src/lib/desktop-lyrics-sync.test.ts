import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useLyricsStore } from '../stores/lyrics'
import { useVisualStore } from '../stores/visual'
import { useSettingsStore } from '../stores/settings'
import { usePlayerStore } from '../stores/player'
import { useGameModeStore } from '../stores/game-mode'
import { useToastStore } from '../stores/toast'
import type { Track } from '../types/domain'
import type { AudioEngine } from './audio-engine'
import { initDesktopLyricsSync } from './desktop-lyrics-sync'

const initialPlayer = usePlayerStore.getState()
const initialLyrics = useLyricsStore.getState()
const initialVisual = useVisualStore.getState()
const initialSettings = useSettingsStore.getState()
const track: Track = { provider: 'local', source: 'local', type: 'local', id: 1, name: '第一首', artist: '', artists: [] }
let stopSync: (() => void) | undefined
const h = {
  get settings() { return useSettingsStore.getState() },
  get fx() { return useVisualStore.getState().fx },
  get player() { return usePlayerStore.getState() },
  get lyrics() { return useLyricsStore.getState() },
  get track() { return usePlayerStore.getState().currentTrack! },
  get updateFx() { return useVisualStore.getState().updateFx },
  get setEnabled() { return useLyricsStore.getState().setDesktopLyricsEnabled },
  onEnabled: undefined as ((event: { enabled: boolean; requested?: boolean }) => void) | undefined,
  onLock: undefined as ((event: { locked: boolean }) => void) | undefined,
  onSize: undefined as ((event: { size: number }) => void) | undefined,
  offEnabled: vi.fn(), offLock: vi.fn(), offSize: vi.fn()
}
const fx = (patch: Partial<typeof h.fx>) => useVisualStore.setState(state => ({ fx: { ...state.fx, ...patch } }))
const setTrack = (patch: Partial<Track>) => usePlayerStore.setState({ currentTrack: { ...h.track, ...patch } })
const render = () => { stopSync = initDesktopLyricsSync() }

beforeEach(() => {
  vi.useFakeTimers()
  useSettingsStore.setState({ ...initialSettings, fontFamily: '', fontFamilyCjk: '' })
  usePlayerStore.setState({ ...initialPlayer, currentTrack: track, status: 'playing', position: 0, rate: 1,
    playbackTransport: 'local', _engine: () => ({ get position() { return h.player.position } } as AudioEngine) })
  useLyricsStore.setState({ ...initialLyrics, currentIndex: 0, trackKey: 'local:1', loading: false,
    lines: [{ text: '歌词', time: 0 }], translation: [{ text: '翻译', time: 0 }], romaji: [{ text: 'ongaku', time: 0 }] })
  useVisualStore.setState({ ...initialVisual, fx: { ...initialVisual.fx,
    desktopLyrics: false, desktopLyricsSize: 24, desktopLyricsFontFamily: '', desktopLyricsFontFamilyCjk: '',
    desktopLyricsBackgroundOpacity: 0.68, desktopLyricsBackgroundStyle: 'dark', desktopLyricsAutoWidth: false,
    desktopLyricsLineMode: 'single', desktopLyricsWordByWord: false, desktopLyricsColor: '#ffffff', desktopLyricsOpacity: 0.92,
    desktopLyricsClickThrough: false, desktopLyricsHighlight: true, desktopLyricsShowTranslation: true, desktopLyricsShowRoma: false } })
  useGameModeStore.setState({ enabled: false, initialized: true, sequence: 0 })
  vi.spyOn(useVisualStore.getState(), 'updateFx')
  vi.spyOn(useLyricsStore.getState(), 'setDesktopLyricsEnabled')
  vi.clearAllMocks()
  vi.stubGlobal('window', { desktop: {
    setDesktopLyricsEnabled: vi.fn(async () => ({ ok: true })), updateDesktopLyrics: vi.fn(async () => ({ ok: true })),
    onDesktopLyricsEnabledState: vi.fn((cb: typeof h.onEnabled) => { h.onEnabled = cb; return h.offEnabled }),
    onDesktopLyricsLockState: vi.fn((cb: typeof h.onLock) => { h.onLock = cb; return h.offLock }),
    onDesktopLyricsSizeState: vi.fn((cb: typeof h.onSize) => { h.onSize = cb; return h.offSize })
  } })
})
afterEach(() => { stopSync?.(); stopSync = undefined; vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('桌面歌词窗口同步', () => {
  it('无React重复启动只订阅一次，位置/逐字进度不发送整包，精准时钟仅发单字段', () => {
    fx({ desktopLyrics: true, desktopLyricsWordByWord: true })
    useLyricsStore.setState({ wordLines: [{ time: 0, durationMs: 2000, words: [{ text: '歌词', startMs: 0, durationMs: 2000 }] }] })
    render()
    expect(initDesktopLyricsSync()).toBe(stopSync)
    expect(window.desktop.onDesktopLyricsEnabledState).toHaveBeenCalledOnce()
    expect(window.desktop.onDesktopLyricsLockState).toHaveBeenCalledOnce()
    expect(window.desktop.onDesktopLyricsSizeState).toHaveBeenCalledOnce()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenCalledOnce()
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    for (let position = 0.1; position < 1; position += 0.1) {
      usePlayerStore.setState({ position })
      useLyricsStore.setState({ currentCharProgress: position / 2 })
    }
    expect(window.desktop.updateDesktopLyrics).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(window.desktop.updateDesktopLyrics).toHaveBeenCalledTimes(20)
    expect(vi.mocked(window.desktop.updateDesktopLyrics).mock.calls.every(([payload]) => Object.keys(payload).length === 1 && 'wordClock' in payload)).toBe(true)
  })

  it('关闭桌面歌词时不读取普通引擎的精准时钟', () => {
    fx({ desktopLyricsWordByWord: true })
    useLyricsStore.setState({ wordLines: [{ time: 0, durationMs: 2000, words: [{ text: '歌词', startMs: 0, durationMs: 2000 }] }] })
    const engine = vi.spyOn(usePlayerStore.getState(), '_engine')
    render()
    fx({ desktopLyricsColor: '#123456' })
    expect(engine).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: undefined, wordClock: undefined }))
  })

  it('宿主停止后旧原生事件、store通知、时钟和迟到错误不再生效，保留开启偏好', async () => {
    fx({ desktopLyrics: true, desktopLyricsWordByWord: true })
    useLyricsStore.setState({ wordLines: [{ time: 0, durationMs: 2000, words: [{ text: '歌词', startMs: 0, durationMs: 2000 }] }] })
    let fail!: (error: Error) => void
    vi.mocked(window.desktop.setDesktopLyricsEnabled).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const toast = vi.spyOn(useToastStore.getState(), 'show')
    render()
    stopSync!()
    stopSync!()
    expect(h.offEnabled).toHaveBeenCalledOnce()
    expect(h.offLock).toHaveBeenCalledOnce()
    expect(h.offSize).toHaveBeenCalledOnce()
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    h.onEnabled?.({ enabled: false })
    h.onLock?.({ locked: true })
    h.onSize?.({ size: 90 })
    usePlayerStore.setState({ position: 20 })
    useLyricsStore.setState({ currentIndex: -1 })
    useSettingsStore.setState({ fontFamily: 'Arial' })
    useGameModeStore.getState().setState({ enabled: true })
    vi.advanceTimersByTime(1000)
    fail(new Error('已停止的旧请求'))
    await Promise.resolve()
    expect(h.fx).toMatchObject({ desktopLyrics: true, desktopLyricsClickThrough: false, desktopLyricsSize: 24 })
    expect(vi.getTimerCount()).toBe(0)
    expect(window.desktop.updateDesktopLyrics).not.toHaveBeenCalled()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalled()
  })

  it('旧切换失败不提示，只有仍有效的切换失败显示错误', async () => {
    let failOld!: (error: Error) => void
    vi.mocked(window.desktop.setDesktopLyricsEnabled).mockImplementationOnce(() => new Promise((_resolve, reject) => { failOld = reject }))
    const toast = vi.spyOn(useToastStore.getState(), 'show')
    render()
    fx({ desktopLyrics: true })
    failOld(new Error('旧失败'))
    await Promise.resolve()
    expect(toast).not.toHaveBeenCalled()
    vi.mocked(window.desktop.setDesktopLyricsEnabled).mockRejectedValueOnce(new Error('当前失败'))
    fx({ desktopLyrics: false })
    await Promise.resolve()
    expect(toast).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith('桌面歌词切换失败，请重试')
  })

  it('快速进退被合并为同一个最终开关时，仍同步原桌面歌词配置', () => {
    fx({ desktopLyrics: true })
    useGameModeStore.setState({ enabled: false, sequence: 1 })
    render()
    vi.mocked(window.desktop.setDesktopLyricsEnabled).mockClear()
    // React 未渲染中间的游戏模式；最终同步序号保证外观配置再次推送。
    useGameModeStore.setState({ enabled: false, sequence: 3 })
    render()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenCalledWith(true, expect.objectContaining({ line: '歌词' }))
  })
  it('游戏模式沿用原桌面歌词开关，自动降耗且不改外观偏好', () => {
    vi.useFakeTimers()
    fx({ desktopLyrics: false, desktopLyricsLineMode: 'double', desktopLyricsWordByWord: true,
      desktopLyricsHighlight: true, desktopLyricsAutoWidth: true, desktopLyricsBackgroundStyle: 'frosted' })
    useLyricsStore.setState({ wordLines: [{ time: 0, durationMs: 3000, words: [{ text: '歌词', startMs: 0, durationMs: 3000 }] }] })
    useGameModeStore.getState().setState({ enabled: true })
    render()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenLastCalledWith(false, expect.anything())
    expect(vi.getTimerCount()).toBe(0)
    fx({ desktopLyrics: true })
    useGameModeStore.getState().setState({ enabled: true })
    render()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenLastCalledWith(true, expect.objectContaining({
      lineMode: 'single', nextLine: '', wordLine: undefined, wordClock: undefined,
      highlight: false, autoWidth: false, backgroundStyle: 'dark'
    }))
    expect(vi.getTimerCount()).toBe(0)
    useGameModeStore.getState().setState({ enabled: false })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({
      lineMode: 'double', highlight: true, autoWidth: true, backgroundStyle: 'frosted', wordLine: h.lyrics.wordLines[0]
    }))
    expect(vi.getTimerCount()).toBe(1)
    expect(h.updateFx).not.toHaveBeenCalled()
    useGameModeStore.getState().setState({ enabled: true })
    render()
    h.onEnabled?.({ enabled: false })
    expect(h.updateFx).toHaveBeenCalledWith({ desktopLyrics: false })
    expect(h.setEnabled).toHaveBeenLastCalledWith(false)
  })
  it.each(['single', 'double'] as const)('%s 模式在前奏、加载和无歌词占位时按行数显示歌手', (lineMode) => {
    fx({ desktopLyricsLineMode: lineMode })
    setTrack({ artist: '歌手甲 / 歌手乙' })
    useLyricsStore.setState({ currentIndex: -1 })
    render()
    const nextLine = lineMode === 'double' ? h.track.artist : ''
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '第一首', nextLine }))
    useLyricsStore.setState({ loading: true })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '正在获取歌词…', nextLine }))
    useLyricsStore.setState({ loading: false })
    useLyricsStore.setState({ lines: [] })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '暂无歌词 · 第一首', nextLine }))
    useLyricsStore.setState({ currentIndex: 0 })
    useLyricsStore.setState({ lines: [{ text: '', time: 0 }] })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '第一首', nextLine }))
  })
  it('双行歌手占位随切歌更新，进入歌词、切成单行或缺少歌手时正确收起', () => {
    fx({ desktopLyricsLineMode: 'double' })
    setTrack({ artist: '歌手甲' })
    useLyricsStore.setState({ currentIndex: -1 })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '歌手甲' }))
    setTrack({ ...h.track, id: 2, name: '第二首', artist: '歌手乙' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '歌手乙', translation: '', roma: '' }))
    useLyricsStore.setState({ trackKey: 'local:2' })
    useLyricsStore.setState({ currentIndex: 0 })
    useLyricsStore.setState({ lines: [{ text: '新歌词', time: 0 }, { text: '下一句', time: 3 }] })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '新歌词', nextLine: '下一句' }))
    useLyricsStore.setState({ currentIndex: 1 })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '' }))
    useLyricsStore.setState({ currentIndex: -1 })
    fx({ desktopLyricsLineMode: 'single' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '第二首', nextLine: '' }))
    fx({ desktopLyricsLineMode: 'double' })
    setTrack({ artist: '' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '' }))
  })
  it.each([
    ['win32', 'frosted'],
    ['darwin', 'frosted'],
    ['linux', 'dark']
  ])('%s 启用与切换底框时同步支持的样式', (platform, backgroundStyle) => {
    Object.assign(window.desktop, { platform })
    fx({ desktopLyrics: true, desktopLyricsBackgroundOpacity: 0.3, desktopLyricsBackgroundStyle: 'frosted' })
    render()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenLastCalledWith(true, expect.objectContaining({ backgroundOpacity: 0.3, backgroundStyle }))
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundOpacity: 0.3, backgroundStyle }))
    fx({ desktopLyricsBackgroundStyle: 'dark' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundStyle: 'dark' }))
    fx({ desktopLyricsBackgroundStyle: 'frosted' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundStyle }))
  })
  it('双行是当前与下一句，关闭后或切歌清除旧下一句，并同步底框样式', () => {
    useLyricsStore.setState({ lines: [{ text: '歌词', time: 0 }, { text: '下一句', time: 3 }] })
    fx({ desktopLyricsLineMode: 'double', desktopLyricsBackgroundOpacity: 0.3, desktopLyricsBackgroundStyle: 'frosted' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ trackKey: 'local:1', lineIndex: 0, lineMode: 'double', line: '歌词', nextLine: '下一句', backgroundOpacity: 0.3, backgroundStyle: 'frosted' }))
    useLyricsStore.setState({ currentIndex: 1 })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ lineIndex: 1, line: '下一句', nextLine: '' }))
    useLyricsStore.setState({ currentIndex: 0 })
    fx({ desktopLyricsLineMode: 'single' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '' }))
    fx({ desktopLyricsLineMode: 'double' })
    setTrack({ id: 2 })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ trackKey: 'local:2', lineIndex: -1, nextLine: '' }))
  })
  it('宽度自适应开关同步到窗口', () => {
    fx({ desktopLyricsAutoWidth: true })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ autoWidth: true }))
    fx({ desktopLyricsAutoWidth: false })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ autoWidth: false }))
  })
  it('逐字开关使用真实时钟，暂停、跳播和偏移生效，关闭停止同步', () => {
    vi.useFakeTimers()
    fx({ desktopLyrics: true })
    fx({ desktopLyricsWordByWord: true })
    useLyricsStore.setState({ wordLines: [{ time: 0, durationMs: 2000, words: [{ text: '歌', startMs: 0, durationMs: 1000 }, { text: '词', startMs: 1000, durationMs: 1000 }] }] })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: h.lyrics.wordLines[0] }))
    usePlayerStore.setState({ position: 0.5 })
    vi.advanceTimersByTime(50)
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith({ wordClock: { elapsedMs: 500, playing: true, rate: 1 } })
    usePlayerStore.setState({ status: 'paused' })
    usePlayerStore.setState({ position: 1.5 })
    useLyricsStore.setState({ offsetSec: -0.25 })
    vi.advanceTimersByTime(50)
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith({ wordClock: { elapsedMs: 1250, playing: false, rate: 1 } })
    fx({ desktopLyricsWordByWord: false })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: undefined, wordClock: undefined }))
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    vi.advanceTimersByTime(200)
    expect(window.desktop.updateDesktopLyrics).not.toHaveBeenCalled()
  })
  it('无精准时序或旧词行不匹配时回退整句且不启动逐字时钟', () => {
    vi.useFakeTimers()
    fx({ desktopLyrics: true })
    fx({ desktopLyricsWordByWord: true })
    useLyricsStore.setState({ wordLines: [{ time: 0, durationMs: 1000, words: [{ text: '歌词', startMs: 0 }] }] })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: undefined }))
    useLyricsStore.setState({ wordLines: [{ time: 0, durationMs: 1000, words: [{ text: '旧词', startMs: 0, durationMs: 1000 }] }] })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: undefined }))
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    vi.advanceTimersByTime(200)
    expect(window.desktop.updateDesktopLyrics).not.toHaveBeenCalled()
  })
  it('中西文字体分别继承界面设置，独立修改后立即同步', () => {
    useSettingsStore.setState({ fontFamily: 'Helvetica Neue', fontFamilyCjk: 'PingFang SC' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Helvetica Neue', fontFamilyCjk: 'PingFang SC' }))
    fx({ desktopLyricsFontFamilyCjk: 'Songti SC' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Helvetica Neue', fontFamilyCjk: 'Songti SC' }))
    useSettingsStore.setState({ fontFamily: 'Arial' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Arial', fontFamilyCjk: 'Songti SC' }))
    fx({ desktopLyricsFontFamily: 'Georgia' })
    render()
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    useSettingsStore.setState({ fontFamily: 'Verdana', fontFamilyCjk: 'Microsoft YaHei' })
    render()
    expect(window.desktop.updateDesktopLyrics).not.toHaveBeenCalled()
    fx({ desktopLyricsFontFamilyCjk: '' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Georgia', fontFamilyCjk: 'Microsoft YaHei' }))
  })
  it('音译开关立即生效，切歌或缺少音译数据时清除旧行', () => {
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: '' }))
    fx({ desktopLyricsShowRoma: true })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: 'ongaku', translation: '翻译' }))
    fx({ desktopLyricsShowRoma: false })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: '' }))
    fx({ desktopLyricsShowRoma: true })
    useLyricsStore.setState({ romaji: [] })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: '' }))
    useLyricsStore.setState({ romaji: [{ text: '上一首音译', time: 0 }] })
    setTrack({ ...h.track, id: 2 })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: '', translation: '' }))
  })
  it('字体与颜色立即同步，拖框回传字号不把旧尺寸请求发回窗口', () => {
    render()
    fx({ desktopLyricsFontFamily: 'Songti SC', desktopLyricsColor: '#eab308' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Songti SC', color: '#eab308' }))
    h.onSize?.({ size: 56.5 })
    expect(h.updateFx).toHaveBeenLastCalledWith({ desktopLyricsSize: 56.5 })
    fx({ desktopLyricsSize: 56.5 })
    render()
    expect(vi.mocked(window.desktop.updateDesktopLyrics).mock.lastCall?.[0]).not.toHaveProperty('size')
    fx({ desktopLyricsSize: 72 })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ size: 72 }))
    fx({ desktopLyricsSize: 56.5 })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ size: 56.5 }))
  })
  it('首次启用附带完整参数，迟到确认不覆盖意图，主动关闭和锁定回写设置', () => {
    fx({ desktopLyrics: true })
    render()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenCalledWith(true, expect.objectContaining({ size: 24, clickThrough: false, line: '歌词' }))
    fx({ desktopLyrics: false })
    render()
    h.onEnabled?.({ enabled: true, requested: true })
    expect(h.updateFx).not.toHaveBeenCalled()
    h.onEnabled?.({ enabled: false })
    expect(h.updateFx).toHaveBeenCalledWith({ desktopLyrics: false })
    expect(h.setEnabled).toHaveBeenLastCalledWith(false)
    h.onLock?.({ locked: true })
    expect(h.updateFx).toHaveBeenLastCalledWith({ desktopLyricsClickThrough: true })
  })
  it('歌词没有换行时，修改字号、透明度、翻译开关与锁定仍立即推送', () => {
    render()
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    fx({ desktopLyricsSize: 44, desktopLyricsOpacity: 0.5, desktopLyricsClickThrough: true, desktopLyricsShowTranslation: false })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenCalledOnce()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '歌词', translation: '', size: 44, opacity: 0.5, clickThrough: true }))
    // 参数不变时不重复推送。
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenCalledOnce()
  })
  it('切歌后不推送上一首歌词或翻译', () => {
    render()
    setTrack({ ...h.track, id: 2 })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '正在获取歌词…', translation: '' }))
  })
})
