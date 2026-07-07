import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLyricsStore } from './lyrics'
import { useVisualStore } from './visual'
import { useSettingsStore } from './settings'

describe('lyrics store tick', () => {
  beforeEach(() => {
    useLyricsStore.getState().setLines([
      { time: 0, text: 'a' },
      { time: 2, text: 'b' },
      { time: 4, text: 'c' }
    ])
  })

  it('advances currentIndex by position', () => {
    const { tick } = useLyricsStore.getState()
    tick(0.5)
    expect(useLyricsStore.getState().currentIndex).toBe(0)
    tick(3)
    expect(useLyricsStore.getState().currentIndex).toBe(1)
    tick(10)
    expect(useLyricsStore.getState().currentIndex).toBe(2)
  })

  it('is -1 before first line', () => {
    useLyricsStore.getState().setLines([{ time: 5, text: 'late' }])
    useLyricsStore.getState().tick(1)
    expect(useLyricsStore.getState().currentIndex).toBe(-1)
  })
})

describe('visual archive roundtrip', () => {
  it('save then load restores fx and is archive-shaped', () => {
    useVisualStore.getState().updateFx({ intensity: 0.42, preset: 3 })
    const archive = useVisualStore.getState().saveArchive('test')
    expect(archive.snapshot.intensity).toBe(0.42)
    expect(archive.name).toBe('test')
    useVisualStore.getState().updateFx({ intensity: 0.99 })
    useVisualStore.getState().loadArchive(archive.snapshot)
    expect(useVisualStore.getState().fx.intensity).toBe(0.42)
    expect(useVisualStore.getState().preset).toBe(3)
  })

  it('loadArchive merges missing fields from defaults', () => {
    useVisualStore.getState().loadArchive({ intensity: 0.1 } as never)
    const fx = useVisualStore.getState().fx
    expect(fx.intensity).toBe(0.1)
    expect(typeof fx.speed).toBe('number') // 缺失字段来自默认
  })
})

describe('settings export/import', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      }
    })
  })

  it('exports an importable archive', () => {
    useVisualStore.getState().updateFx({ bloomStrength: 0.77 })
    const json = useSettingsStore.getState().exportArchive('x')
    useVisualStore.getState().updateFx({ bloomStrength: 0.1 })
    expect(useSettingsStore.getState().importArchive(json)).toBe(true)
    expect(useVisualStore.getState().fx.bloomStrength).toBe(0.77)
  })

  it('rejects malformed archive', () => {
    expect(useSettingsStore.getState().importArchive('not json')).toBe(false)
  })

  it('persists settings to localStorage', () => {
    useSettingsStore.getState().setLiveBackgroundKeep(true)
    useSettingsStore.setState({ liveBackgroundKeep: false })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().liveBackgroundKeep).toBe(true)
  })
})

describe('ambient store', () => {
  it('setPalette 更新调色板，resetPalette 回到默认霞光色', async () => {
    const { useAmbientStore } = await import('./ambient')
    const { DEFAULT_PALETTE } = await import('../lib/extract-color')
    expect(useAmbientStore.getState().palette).toEqual(DEFAULT_PALETTE)
    useAmbientStore.getState().setPalette(['#112233', '#445566', '#778899'])
    expect(useAmbientStore.getState().palette).toEqual(['#112233', '#445566', '#778899'])
    useAmbientStore.getState().resetPalette()
    expect(useAmbientStore.getState().palette).toEqual(DEFAULT_PALETTE)
  })
})

describe('navigation store direction', () => {
  it('navigateTo 置 push，goBack 置 pop，空 history 时 goBack 不变', async () => {
    const { useNavigationStore } = await import('./navigation')
    useNavigationStore.setState({ currentView: 'explore', history: [], lastAction: 'push' })
    expect(useNavigationStore.getState().lastAction).toBe('push')
    useNavigationStore.getState().navigateTo('library')
    expect(useNavigationStore.getState().lastAction).toBe('push')
    useNavigationStore.getState().goBack()
    expect(useNavigationStore.getState().lastAction).toBe('pop')
    expect(useNavigationStore.getState().currentView).toBe('explore')
    // history 已空：goBack 无效果，方向不变
    useNavigationStore.getState().navigateTo('settings')
    useNavigationStore.setState({ history: [] })
    useNavigationStore.getState().goBack()
    expect(useNavigationStore.getState().lastAction).toBe('push')
  })

  it('goBack 填充 future，goForward 沿 future 前进，navigateTo 清空 future', async () => {
    const { useNavigationStore } = await import('./navigation')
    useNavigationStore.setState({ currentView: 'explore', history: [], future: [], lastAction: 'push' })
    useNavigationStore.getState().navigateTo('library')
    useNavigationStore.getState().navigateTo('settings')

    useNavigationStore.getState().goBack()
    useNavigationStore.getState().goBack()
    expect(useNavigationStore.getState().currentView).toBe('explore')
    expect(useNavigationStore.getState().future).toEqual(['library', 'settings'])

    useNavigationStore.getState().goForward()
    expect(useNavigationStore.getState().currentView).toBe('library')
    expect(useNavigationStore.getState().lastAction).toBe('push')
    expect(useNavigationStore.getState().history).toEqual(['explore'])

    // 新导航清空 future
    useNavigationStore.getState().navigateTo('explore')
    expect(useNavigationStore.getState().future).toEqual([])
    // future 已空：goForward 无效果
    useNavigationStore.getState().goForward()
    expect(useNavigationStore.getState().currentView).toBe('explore')
  })
})

describe('playlist 播放模式走序', () => {
  async function setup(n = 4) {
    const { usePlaylistStore } = await import('./playlist')
    const { usePlayerStore } = await import('./player')
    const loadTrack = vi.fn(async () => {})
    usePlayerStore.setState({ loadTrack })
    const tracks = Array.from({ length: n }, (_, i) => ({
      provider: 'netease' as const,
      source: 'netease' as const,
      type: 'song',
      id: i,
      name: `t${i}`,
      artist: '',
      artists: []
    }))
    usePlaylistStore.setState({ queue: tracks, queueIndex: 0, shuffleOrder: [] })
    return { usePlaylistStore, usePlayerStore, loadTrack }
  }

  it('列表循环:next 顺序推进并回绕', async () => {
    const { usePlaylistStore } = await setup(3)
    useSettingsStore.setState({ playMode: 'order' })
    usePlaylistStore.getState().next()
    expect(usePlaylistStore.getState().queueIndex).toBe(1)
    usePlaylistStore.getState().next()
    usePlaylistStore.getState().next()
    expect(usePlaylistStore.getState().queueIndex).toBe(0)
    usePlaylistStore.getState().prev()
    expect(usePlaylistStore.getState().queueIndex).toBe(2)
  })

  it('随机:一轮 next 恰好遍历每首一次,prev 可回溯', async () => {
    const { usePlaylistStore } = await setup(5)
    useSettingsStore.setState({ playMode: 'shuffle' })
    const visited = [usePlaylistStore.getState().queueIndex]
    for (let i = 0; i < 4; i++) {
      usePlaylistStore.getState().next()
      visited.push(usePlaylistStore.getState().queueIndex)
    }
    expect(new Set(visited).size).toBe(5)
    const last = visited[visited.length - 1]
    const secondLast = visited[visited.length - 2]
    expect(last).not.toBe(secondLast)
    usePlaylistStore.getState().prev()
    expect(usePlaylistStore.getState().queueIndex).toBe(secondLast)
  })

  it('单曲循环:自然播完原地重播,不切换曲目', async () => {
    const { usePlaylistStore, usePlayerStore, loadTrack } = await setup(3)
    useSettingsStore.setState({ playMode: 'one' })
    const seek = vi.fn()
    const play = vi.fn()
    usePlayerStore.setState({ seek, play, currentTrack: usePlaylistStore.getState().queue[0] })
    usePlaylistStore.getState().handleTrackEnded()
    expect(usePlaylistStore.getState().queueIndex).toBe(0)
    expect(seek).toHaveBeenCalledWith(0)
    expect(play).toHaveBeenCalled()
    expect(loadTrack).not.toHaveBeenCalled()
  })

  it('列表循环:自然播完切下一首', async () => {
    const { usePlaylistStore, loadTrack } = await setup(3)
    useSettingsStore.setState({ playMode: 'order' })
    usePlaylistStore.getState().handleTrackEnded()
    expect(usePlaylistStore.getState().queueIndex).toBe(1)
    expect(loadTrack).toHaveBeenCalled()
  })

  it('空队列 next/prev 不动作', async () => {
    const { usePlaylistStore, loadTrack } = await setup(0)
    usePlaylistStore.setState({ queueIndex: -1 })
    useSettingsStore.setState({ playMode: 'order' })
    usePlaylistStore.getState().next()
    usePlaylistStore.getState().prev()
    expect(usePlaylistStore.getState().queueIndex).toBe(-1)
    expect(loadTrack).not.toHaveBeenCalled()
  })

  it('playMode 持久化进 settings 存档', () => {
    useSettingsStore.getState().setPlayMode('shuffle')
    useSettingsStore.setState({ playMode: 'order' })
    useSettingsStore.getState().loadFromLocal()
    expect(useSettingsStore.getState().playMode).toBe('shuffle')
  })
})

describe('recent plays store', () => {
  it('record 去重置顶并截断上限;播放加载时自动记录', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    })
    const { useRecentPlaysStore } = await import('./recent')
    const { usePlayerStore } = await import('./player')
    const mk = (i: number) => ({
      provider: 'netease' as const,
      source: 'netease' as const,
      type: 'song',
      id: i,
      name: `t${i}`,
      artist: '',
      artists: [],
      url: 'http://tmp'
    })
    useRecentPlaysStore.setState({ items: [] })
    useRecentPlaysStore.getState().record(mk(1))
    useRecentPlaysStore.getState().record(mk(2))
    useRecentPlaysStore.getState().record(mk(1))
    const items = useRecentPlaysStore.getState().items
    expect(items.length).toBe(2)
    expect(String(items[0].track.id)).toBe('1')
    expect(items[0].track.url).toBeUndefined() // 落盘剥 URL

    // 播放新曲目(currentTrack + loading 同时置入)触发记录
    usePlayerStore.setState({ currentTrack: mk(9), status: 'loading' })
    expect(String(useRecentPlaysStore.getState().items[0].track.id)).toBe('9')
    // 恢复态(paused)不记录
    usePlayerStore.setState({ currentTrack: mk(8), status: 'paused' })
    expect(String(useRecentPlaysStore.getState().items[0].track.id)).toBe('9')
  })
})
