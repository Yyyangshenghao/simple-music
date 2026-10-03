import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: { fontFamily: '', fontFamilyCjk: '' },
  fx: { desktopLyrics: false, desktopLyricsSize: 24, desktopLyricsFontFamily: '', desktopLyricsFontFamilyCjk: '', desktopLyricsBackgroundOpacity: 0.68, desktopLyricsBackgroundStyle: 'dark', desktopLyricsAutoWidth: false, desktopLyricsLineMode: 'single', desktopLyricsWordByWord: false, desktopLyricsColor: '#ffffff', desktopLyricsOpacity: 0.92, desktopLyricsClickThrough: false, desktopLyricsHighlight: true, desktopLyricsShowTranslation: true, desktopLyricsShowRoma: false },
  player: { status: 'playing', position: 0, rate: 1, playbackTransport: 'local', _engine: () => ({ position: h.player.position }) },
  lyrics: { currentIndex: 0, offsetSec: 0, wordLines: [] as import('../types/domain').WordLyricLine[], lines: [{ text: '歌词', time: 0 }], translation: [{ text: '翻译', time: 0 }], romaji: [{ text: 'ongaku', time: 0 }], trackKey: 'local:1', loading: false },
  track: { source: 'local', id: 1, name: '第一首', artist: '' },
  updateFx: vi.fn(), setEnabled: vi.fn(),
  onEnabled: undefined as ((event: { enabled: boolean; requested?: boolean }) => void) | undefined,
  onLock: undefined as ((event: { locked: boolean }) => void) | undefined,
  onSize: undefined as ((event: { size: number }) => void) | undefined,
  sizeRef: { current: null as number | null },
  cursor: 0, effects: [] as Array<{ deps?: unknown[]; cleanup?: () => void }>
}))
vi.mock('react', () => ({ useRef: () => h.sizeRef, useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
  const index = h.cursor++
  const previous = h.effects[index]
  if (previous && deps && previous.deps?.length === deps.length && deps.every((value, i) => Object.is(value, previous.deps?.[i]))) return
  previous?.cleanup?.()
  const cleanup = effect()
  h.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
} }))
vi.mock('../stores/visual', () => {
  const state = () => ({ fx: h.fx, updateFx: h.updateFx })
  return { useVisualStore: Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }) }
})
vi.mock('../stores/settings', () => ({ useSettingsStore: (selector: (state: typeof h.settings) => unknown) => selector(h.settings) }))
vi.mock('../stores/lyrics', () => {
  const state = () => ({ ...h.lyrics, setDesktopLyricsEnabled: h.setEnabled })
  return { useLyricsStore: Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }) }
})
vi.mock('../stores/player', () => {
  const state = () => ({ ...h.player, currentTrack: h.track })
  return { usePlayerStore: Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }) }
})
vi.mock('../stores/toast', () => ({ useToastStore: { getState: () => ({ show: vi.fn() }) } }))
import { useDesktopLyricsSync } from './useDesktopLyricsSync'
const render = () => { h.cursor = 0; useDesktopLyricsSync() }

beforeEach(() => {
  Object.assign(h.settings, { fontFamily: '', fontFamilyCjk: '' })
  h.effects.forEach((effect) => effect.cleanup?.())
  h.effects = []
  Object.assign(h.player, { status: 'playing', position: 0, rate: 1 })
  Object.assign(h.lyrics, { currentIndex: 0, offsetSec: 0, wordLines: [], loading: false, lines: [{ text: '歌词', time: 0 }] })
  h.sizeRef.current = null
  Object.assign(h.fx, { desktopLyrics: false, desktopLyricsSize: 24, desktopLyricsFontFamily: '', desktopLyricsFontFamilyCjk: '', desktopLyricsBackgroundOpacity: 0.68, desktopLyricsBackgroundStyle: 'dark', desktopLyricsAutoWidth: false, desktopLyricsLineMode: 'single', desktopLyricsWordByWord: false, desktopLyricsColor: '#ffffff', desktopLyricsOpacity: 0.92, desktopLyricsClickThrough: false, desktopLyricsHighlight: true, desktopLyricsShowTranslation: true, desktopLyricsShowRoma: false })
  h.lyrics.romaji = [{ text: 'ongaku', time: 0 }]
  h.lyrics.trackKey = 'local:1'
  h.track = { source: 'local', id: 1, name: '第一首', artist: '' }
  vi.clearAllMocks()
  vi.stubGlobal('window', { desktop: {
    setDesktopLyricsEnabled: vi.fn(async () => ({ ok: true })), updateDesktopLyrics: vi.fn(async () => ({ ok: true })),
    onDesktopLyricsEnabledState: (cb: typeof h.onEnabled) => { h.onEnabled = cb; return vi.fn() },
    onDesktopLyricsLockState: (cb: typeof h.onLock) => { h.onLock = cb; return vi.fn() },
    onDesktopLyricsSizeState: (cb: typeof h.onSize) => { h.onSize = cb; return vi.fn() }
  } })
})
afterEach(() => { h.effects.forEach((effect) => effect.cleanup?.()); h.effects = []; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('桌面歌词窗口同步', () => {
  it.each(['single', 'double'])('%s 模式在前奏、加载和无歌词占位时按行数显示歌手', (lineMode) => {
    h.fx.desktopLyricsLineMode = lineMode
    h.track.artist = '歌手甲 / 歌手乙'
    h.lyrics.currentIndex = -1
    render()
    const nextLine = lineMode === 'double' ? h.track.artist : ''
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '第一首', nextLine }))
    h.lyrics.loading = true
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '正在获取歌词…', nextLine }))
    h.lyrics.loading = false
    h.lyrics.lines = []
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '暂无歌词 · 第一首', nextLine }))
    h.lyrics.currentIndex = 0
    h.lyrics.lines = [{ text: '', time: 0 }]
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '第一首', nextLine }))
  })
  it('双行歌手占位随切歌更新，进入歌词、切成单行或缺少歌手时正确收起', () => {
    h.fx.desktopLyricsLineMode = 'double'
    h.track.artist = '歌手甲'
    h.lyrics.currentIndex = -1
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '歌手甲' }))
    h.track = { ...h.track, id: 2, name: '第二首', artist: '歌手乙' }
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '歌手乙', translation: '', roma: '' }))
    h.lyrics.trackKey = 'local:2'
    h.lyrics.currentIndex = 0
    h.lyrics.lines = [{ text: '新歌词', time: 0 }, { text: '下一句', time: 3 }]
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '新歌词', nextLine: '下一句' }))
    h.lyrics.currentIndex = 1
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '' }))
    h.lyrics.currentIndex = -1
    h.fx.desktopLyricsLineMode = 'single'
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '第二首', nextLine: '' }))
    h.fx.desktopLyricsLineMode = 'double'
    h.track.artist = ''
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '' }))
  })
  it.each([
    ['win32', 'frosted'],
    ['darwin', 'frosted'],
    ['linux', 'dark']
  ])('%s 启用与切换底框时同步支持的样式', (platform, backgroundStyle) => {
    Object.assign(window.desktop, { platform })
    Object.assign(h.fx, { desktopLyrics: true, desktopLyricsBackgroundOpacity: 0.3, desktopLyricsBackgroundStyle: 'frosted' })
    render()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenLastCalledWith(true, expect.objectContaining({ backgroundOpacity: 0.3, backgroundStyle }))
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundOpacity: 0.3, backgroundStyle }))
    h.fx.desktopLyricsBackgroundStyle = 'dark'
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundStyle: 'dark' }))
    h.fx.desktopLyricsBackgroundStyle = 'frosted'
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundStyle }))
  })
  it('双行是当前与下一句，关闭后或切歌清除旧下一句，并同步底框样式', () => {
    h.lyrics.lines = [{ text: '歌词', time: 0 }, { text: '下一句', time: 3 }]
    Object.assign(h.fx, { desktopLyricsLineMode: 'double', desktopLyricsBackgroundOpacity: 0.3, desktopLyricsBackgroundStyle: 'frosted' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '歌词', nextLine: '下一句', backgroundOpacity: 0.3, backgroundStyle: 'frosted' }))
    h.lyrics.currentIndex = 1
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '下一句', nextLine: '' }))
    h.lyrics.currentIndex = 0
    h.fx.desktopLyricsLineMode = 'single'
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '' }))
    h.fx.desktopLyricsLineMode = 'double'
    h.track.id = 2
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ nextLine: '' }))
  })
  it('宽度自适应开关同步到窗口', () => {
    h.fx.desktopLyricsAutoWidth = true
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ autoWidth: true }))
    h.fx.desktopLyricsAutoWidth = false
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ autoWidth: false }))
  })
  it('逐字开关使用真实时钟，暂停、跳播和偏移生效，关闭停止同步', () => {
    vi.useFakeTimers()
    h.fx.desktopLyrics = true
    h.fx.desktopLyricsWordByWord = true
    h.lyrics.wordLines = [{ time: 0, durationMs: 2000, words: [{ text: '歌', startMs: 0, durationMs: 1000 }, { text: '词', startMs: 1000, durationMs: 1000 }] }]
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: h.lyrics.wordLines[0] }))
    h.player.position = 0.5
    vi.advanceTimersByTime(50)
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith({ wordClock: { elapsedMs: 500, playing: true, rate: 1 } })
    h.player.status = 'paused'
    h.player.position = 1.5
    h.lyrics.offsetSec = -0.25
    vi.advanceTimersByTime(50)
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith({ wordClock: { elapsedMs: 1250, playing: false, rate: 1 } })
    h.fx.desktopLyricsWordByWord = false
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: undefined, wordClock: undefined }))
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    vi.advanceTimersByTime(200)
    expect(window.desktop.updateDesktopLyrics).not.toHaveBeenCalled()
  })
  it('无精准时序或旧词行不匹配时回退整句且不启动逐字时钟', () => {
    vi.useFakeTimers()
    h.fx.desktopLyrics = true
    h.fx.desktopLyricsWordByWord = true
    h.lyrics.wordLines = [{ time: 0, durationMs: 1000, words: [{ text: '歌词', startMs: 0 }] }]
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: undefined }))
    h.lyrics.wordLines = [{ time: 0, durationMs: 1000, words: [{ text: '旧词', startMs: 0, durationMs: 1000 }] }]
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ wordLine: undefined }))
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    vi.advanceTimersByTime(200)
    expect(window.desktop.updateDesktopLyrics).not.toHaveBeenCalled()
  })
  it('中西文字体分别继承界面设置，独立修改后立即同步', () => {
    Object.assign(h.settings, { fontFamily: 'Helvetica Neue', fontFamilyCjk: 'PingFang SC' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Helvetica Neue', fontFamilyCjk: 'PingFang SC' }))
    h.fx.desktopLyricsFontFamilyCjk = 'Songti SC'
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Helvetica Neue', fontFamilyCjk: 'Songti SC' }))
    h.settings.fontFamily = 'Arial'
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Arial', fontFamilyCjk: 'Songti SC' }))
    h.fx.desktopLyricsFontFamily = 'Georgia'
    render()
    vi.mocked(window.desktop.updateDesktopLyrics).mockClear()
    Object.assign(h.settings, { fontFamily: 'Verdana', fontFamilyCjk: 'Microsoft YaHei' })
    render()
    expect(window.desktop.updateDesktopLyrics).not.toHaveBeenCalled()
    h.fx.desktopLyricsFontFamilyCjk = ''
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Georgia', fontFamilyCjk: 'Microsoft YaHei' }))
  })
  it('音译开关立即生效，切歌或缺少音译数据时清除旧行', () => {
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: '' }))
    h.fx.desktopLyricsShowRoma = true
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: 'ongaku', translation: '翻译' }))
    h.fx.desktopLyricsShowRoma = false
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: '' }))
    h.fx.desktopLyricsShowRoma = true
    h.lyrics.romaji = []
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: '' }))
    h.lyrics.romaji = [{ text: '上一首音译', time: 0 }]
    h.track = { ...h.track, id: 2 }
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ roma: '', translation: '' }))
  })
  it('字体与颜色立即同步，拖框回传字号不把旧尺寸请求发回窗口', () => {
    render()
    Object.assign(h.fx, { desktopLyricsFontFamily: 'Songti SC', desktopLyricsColor: '#eab308' })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ fontFamily: 'Songti SC', color: '#eab308' }))
    h.onSize?.({ size: 56.5 })
    expect(h.updateFx).toHaveBeenLastCalledWith({ desktopLyricsSize: 56.5 })
    h.fx.desktopLyricsSize = 56.5
    render()
    expect(vi.mocked(window.desktop.updateDesktopLyrics).mock.lastCall?.[0]).not.toHaveProperty('size')
    h.fx.desktopLyricsSize = 72
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ size: 72 }))
    h.fx.desktopLyricsSize = 56.5
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ size: 56.5 }))
  })
  it('首次启用附带完整参数，迟到确认不覆盖意图，主动关闭和锁定回写设置', () => {
    h.fx.desktopLyrics = true
    render()
    expect(window.desktop.setDesktopLyricsEnabled).toHaveBeenCalledWith(true, expect.objectContaining({ size: 24, clickThrough: false, line: '歌词' }))
    h.fx.desktopLyrics = false
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
    Object.assign(h.fx, { desktopLyricsSize: 44, desktopLyricsOpacity: 0.5, desktopLyricsClickThrough: true, desktopLyricsShowTranslation: false })
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenCalledOnce()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '歌词', translation: '', size: 44, opacity: 0.5, clickThrough: true }))
    // 参数不变时不重复推送。
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenCalledOnce()
  })
  it('切歌后不推送上一首歌词或翻译', () => {
    render()
    h.track = { ...h.track, id: 2 }
    render()
    expect(window.desktop.updateDesktopLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ line: '正在获取歌词…', translation: '' }))
  })
})
