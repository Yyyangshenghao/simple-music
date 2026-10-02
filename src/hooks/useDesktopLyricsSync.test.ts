import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fx: { desktopLyrics: false, desktopLyricsSize: 24, desktopLyricsFontFamily: '', desktopLyricsColor: '#ffffff', desktopLyricsOpacity: 0.92, desktopLyricsClickThrough: false, desktopLyricsHighlight: true, desktopLyricsShowTranslation: true, desktopLyricsShowRoma: false },
  lyrics: { currentIndex: 0, lines: [{ text: '歌词', time: 0 }], translation: [{ text: '翻译', time: 0 }], romaji: [{ text: 'ongaku', time: 0 }], trackKey: 'local:1', loading: false },
  track: { source: 'local', id: 1, name: '第一首' },
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
vi.mock('../stores/lyrics', () => {
  const state = () => ({ ...h.lyrics, setDesktopLyricsEnabled: h.setEnabled })
  return { useLyricsStore: Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }) }
})
vi.mock('../stores/player', () => ({ usePlayerStore: (selector: (value: { currentTrack: typeof h.track }) => unknown) => selector({ currentTrack: h.track }) }))
vi.mock('../stores/toast', () => ({ useToastStore: { getState: () => ({ show: vi.fn() }) } }))
import { useDesktopLyricsSync } from './useDesktopLyricsSync'
const render = () => { h.cursor = 0; useDesktopLyricsSync() }

beforeEach(() => {
  h.effects = []
  h.sizeRef.current = null
  Object.assign(h.fx, { desktopLyrics: false, desktopLyricsSize: 24, desktopLyricsFontFamily: '', desktopLyricsColor: '#ffffff', desktopLyricsOpacity: 0.92, desktopLyricsClickThrough: false, desktopLyricsHighlight: true, desktopLyricsShowTranslation: true, desktopLyricsShowRoma: false })
  h.lyrics.romaji = [{ text: 'ongaku', time: 0 }]
  h.lyrics.trackKey = 'local:1'
  h.track.id = 1
  vi.clearAllMocks()
  vi.stubGlobal('window', { desktop: {
    setDesktopLyricsEnabled: vi.fn(async () => ({ ok: true })), updateDesktopLyrics: vi.fn(async () => ({ ok: true })),
    onDesktopLyricsEnabledState: (cb: typeof h.onEnabled) => { h.onEnabled = cb; return vi.fn() },
    onDesktopLyricsLockState: (cb: typeof h.onLock) => { h.onLock = cb; return vi.fn() },
    onDesktopLyricsSizeState: (cb: typeof h.onSize) => { h.onSize = cb; return vi.fn() }
  } })
})
afterEach(() => vi.unstubAllGlobals())

describe('桌面歌词窗口同步', () => {
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
