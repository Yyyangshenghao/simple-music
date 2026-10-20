import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppPlaylistPicker, playlistContextSubtitle } from './AppPlaylistDialog'
import type { AppPlaylist } from '../../stores/app-playlists'
import type { Track } from '../../types/domain'

const h = vi.hoisted(() => ({ cleanups: [] as Array<() => void>, add: vi.fn(), create: vi.fn(), toast: vi.fn(), archiveError: '', targetTracks: [] as Track[], items: null as AppPlaylist[] | null, stateValues: [] as unknown[], stateIndex: 0 }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (value: unknown) => { const index = h.stateIndex++; return [index in h.stateValues ? h.stateValues[index] : typeof value === 'function' ? value() : value, vi.fn()] },
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) },
}))
vi.mock('../../stores/app-playlists', async importOriginal => ({ ...await importOriginal<typeof import('../../stores/app-playlists')>(), useAppPlaylistsStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector({ items: h.items ?? [{ id: 'target', name: '通勤', tracks: h.targetTracks }], error: h.archiveError }),
  { getState: () => ({ items: h.items ?? [{ id: 'target', name: '通勤', tracks: h.targetTracks }], addTracks: h.add, create: h.create }) },
) }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))

const track: Track = { provider: 'local', source: 'local', type: 'song', id: 'local-id', name: '本地歌曲', artist: '', artists: [] }
function buttons(node: ReactNode): Array<ReactElement<{ children?: ReactNode; disabled?: boolean; onClick(): void }>> {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; onClick(): void }>(child)) return []
    return child.type === 'button' ? [child] : buttons(child.props.children)
  })
}

describe('选择应用歌单后的异步保存', () => {
  beforeEach(() => { vi.clearAllMocks(); h.archiveError = ''; h.targetTracks = []; h.items = null; h.stateValues = []; h.stateIndex = 0; h.add.mockReturnValue(1); vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() }) })
  afterEach(() => { h.cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals() })

  it('目标的读屏名称包含四源构成与数量，不被单独的操作名称覆盖', () => {
    h.targetTracks = (['netease', 'qq', 'apple', 'local'] as const).map(source => ({ ...track, source, provider: source, id: '1' }))
    const tree = AppPlaylistPicker({ loadTracks: async () => [], onClose: vi.fn() })
    const target = buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!
    const label = (target.props as unknown as { 'aria-label': string })['aria-label']
    for (const text of ['4 首', '网易云 1 首', 'QQ音乐 1 首', 'Apple Music 1 首', '本地 1 首']) expect(label).toContain(text)
  })

  it('选择目标后保存同一批曲目，并在落盘成功后通知完成', async () => {
    const loadTracks = vi.fn(async () => [track])
    const onDone = vi.fn(), onClose = vi.fn()
    const tree = AppPlaylistPicker({ loadTracks, onDone, onClose })
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!.props.onClick()
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(h.add).toHaveBeenCalledWith('target', [track])
    expect(onClose).toHaveBeenCalledOnce()
    expect(h.create).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('已加入「通勤」，新增 1 首')
    expect(localStorage.setItem).toHaveBeenCalledWith('simplemusic-app-playlist-last-target', 'target')
  })

  it.each(['close', 'unmount'])('%s 后展开的迟到结果不能保存', async action => {
    let finish!: (tracks: Track[]) => void
    const loadTracks = vi.fn(() => new Promise<Track[]>(resolve => { finish = resolve }))
    const onDone = vi.fn(), onClose = vi.fn()
    const tree = AppPlaylistPicker({ loadTracks, onDone, onClose })
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!.props.onClick()
    if (action === 'close') buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('取消'))!.props.onClick()
    else h.cleanups.splice(0).forEach(cleanup => cleanup())
    finish([track])
    await Promise.resolve()
    await Promise.resolve()
    expect(h.add).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })


  it('已知曲目显示待加入数量，按唯一曲目标出重复和全部包含', () => {
    h.targetTracks = [track]
    const tree = AppPlaylistPicker({ tracks: [track, track], loadTracks: vi.fn(), onClose: vi.fn() })
    expect(renderToStaticMarkup(<>{playlistContextSubtitle('已选歌曲', [track, track])}</>)).toContain('1 首歌曲')
    const target = buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!
    expect(target.props.disabled).toBe(true)
    expect(renderToStaticMarkup(target)).toContain('已包含全部歌曲')
  })

  it('部分包含仍能选择，回执使用实际新增数', async () => {
    h.targetTracks = [track]
    const another = { ...track, id: 'other' }
    const tree = AppPlaylistPicker({ tracks: [track, another], loadTracks: async () => [track, another], onClose: vi.fn() })
    const target = buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!
    expect(target.props.disabled).toBe(false)
    expect(renderToStaticMarkup(target)).toContain('已包含 1 首')
    target.props.onClick()
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('已加入「通勤」，新增 1 首'))
  })

  it('打开集合选择器不提前加载歌曲，零新增也给出目标名称与真实数量', async () => {
    h.add.mockReturnValue(0)
    const loadTracks = vi.fn(async () => [track])
    const tree = AppPlaylistPicker({ loadTracks, onClose: vi.fn() })
    expect(loadTracks).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(<>{playlistContextSubtitle('2 份歌单/专辑（选定后读取歌曲）', undefined)}</>)).toContain('2 份歌单/专辑')
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!.props.onClick()
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('「通勤」已包含所选歌曲，新增 0 首'))
  })

  it('批量选择器沿用单曲最近目标并支持按名称筛选', () => {
    h.items = Array.from({ length: 6 }, (_, index) => ({ id: String(index), name: `歌单 ${index}`, updatedAt: index, createdAt: 0, tracks: [] }))
    vi.mocked(localStorage.getItem).mockReturnValue('1')
    const loadTracks = vi.fn()
    let tree = AppPlaylistPicker({ loadTracks, onClose: vi.fn() })
    const targets = buttons(tree.props.children).filter(button => renderToStaticMarkup(button).includes('aria-label="加入'))
    expect(renderToStaticMarkup(targets[0])).toContain('歌单 1')
    expect(renderToStaticMarkup(targets[1])).toContain('歌单 5')
    expect(renderToStaticMarkup(tree)).toContain('搜索应用歌单')
    h.stateIndex = 0
    h.stateValues[1] = '  歌单 3  '
    tree = AppPlaylistPicker({ loadTracks, onClose: vi.fn() })
    expect(buttons(tree.props.children).filter(button => renderToStaticMarkup(button).includes('aria-label="加入'))).toHaveLength(1)
    expect(renderToStaticMarkup(tree)).toContain('歌单 3')
    expect(loadTracks).not.toHaveBeenCalled()
  })

  it('新建的回执按唯一歌曲计数，记住新歌单', async () => {
    h.create.mockReturnValue('created')
    h.stateValues[3] = '新收藏'
    // 新建表单与既有目标使用同一保存路径。
    function submit(node: ReactNode): (() => void) | undefined {
      for (const child of Children.toArray(node)) {
        if (!isValidElement<{ children?: ReactNode; onSubmit?(event: { preventDefault(): void }): void }>(child)) continue
        if (child.type === 'form') return () => child.props.onSubmit?.({ preventDefault() {} })
        const nested = submit(child.props.children)
        if (nested) return nested
      }
    }
    h.stateValues[2] = true
    h.stateIndex = 0
    const creating = AppPlaylistPicker({ loadTracks: async () => [track, track], onClose: vi.fn() })
    submit(creating.props.children)!()
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('已新建「新收藏」，新增 1 首'))
    expect(localStorage.setItem).toHaveBeenCalledWith('simplemusic-app-playlist-last-target', 'created')
  })

  it('写入失败不报成功、不清空选区且不关闭对话框', async () => {
    h.add.mockImplementation(() => { throw new Error('保存失败') })
    const onDone = vi.fn(), onClose = vi.fn()
    const tree = AppPlaylistPicker({ loadTracks: async () => [track], onDone, onClose })
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 通勤'))!.props.onClick()
    await vi.waitFor(() => expect(h.add).toHaveBeenCalledOnce())
    expect(onDone).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
  })
})
