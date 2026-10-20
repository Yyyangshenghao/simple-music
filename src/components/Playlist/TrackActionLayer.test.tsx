import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrackActionLayer } from './TrackActionLayer'
import { useTrackActionsStore } from '../../stores/track-actions'
import type { AppPlaylist } from '../../stores/app-playlists'
import type { Track } from '../../types/domain'

const h = vi.hoisted(() => ({ items: [] as AppPlaylist[], add: vi.fn(), create: vi.fn(), resolve: vi.fn(), toast: vi.fn(), query: '', name: '', stateIndex: 0, cleanups: [] as (() => void)[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (value: unknown) => { const index = h.stateIndex++; return [index === 2 ? h.name : index === 3 ? h.query : typeof value === 'function' ? value() : value, vi.fn()] },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => { if (deps.length === 0) { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup) } },
  useLayoutEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: value }),
}))
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }))
vi.mock('../../stores/app-playlists', async importOriginal => ({
  ...await importOriginal<typeof import('../../stores/app-playlists')>(),
  useAppPlaylistsStore: Object.assign((selector: (state: unknown) => unknown) => selector({ items: h.items, error: '' }), { getState: () => ({ addTracks: h.add, create: h.create }) }),
}))
vi.mock('../../stores/track-actions', async importOriginal => {
  const actual = await importOriginal<typeof import('../../stores/track-actions')>()
  return { ...actual, useTrackActionsStore: Object.assign((selector: (state: unknown) => unknown) => selector(actual.useTrackActionsStore.getState()), actual.useTrackActionsStore) }
})
vi.mock('../../lib/batch-tracks', () => ({ resolveAppPlaylistTracks: h.resolve }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({}) } }))
vi.mock('../../stores/toast', () => ({ useToastStore: { getState: () => ({ show: h.toast }) } }))

const track: Track = { provider: 'qq', source: 'qq', type: 'song', id: 1, name: '歌曲', artist: '歌手', artists: [] }
function quickTree() {
  h.stateIndex = 0
  const layer = TrackActionLayer() as ReactElement<{ children: ReactNode }>
  const quick = Children.toArray(layer.props.children).find(child => isValidElement(child)) as ReactElement<Record<string, unknown>>
  return (quick.type as (props: Record<string, unknown>) => ReactElement<{ children: ReactNode; onClose(): void }>)(quick.props)
}
function buttons(node: ReactNode): Array<ReactElement<{ children?: ReactNode; disabled?: boolean; onClick(): void }>> {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; onClick(): void }>(child)) return []
    return child.type === 'button' ? [child] : buttons(child.props.children)
  })
}

describe('快速加入歌单选择器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.query = ''; h.name = ''; h.cleanups = []
    h.resolve.mockResolvedValue([track])
    h.create.mockReturnValue('created')
    h.add.mockReturnValue(1)
    h.items = Array.from({ length: 6 }, (_, index) => ({ id: String(index), name: `歌单 ${index}`, updatedAt: index, createdAt: 0, tracks: index === 0 ? [track] : [] }))
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => '1'), setItem: vi.fn() })
    vi.stubGlobal('document', { body: {} })
    useTrackActionsStore.getState().openQuickAdd(track, { x: 0, y: 0, width: 0, height: 0 })
  })
  afterEach(() => { h.cleanups.splice(0).forEach(cleanup => cleanup()); useTrackActionsStore.getState().close(); vi.unstubAllGlobals() })

  it('沿用最近目标顺序，并标记已经包含的歌曲', () => {
    const tree = quickTree()
    const targets = buttons(tree.props.children).filter(button => renderToStaticMarkup(button).includes('aria-label="'))
    expect(renderToStaticMarkup(targets[0])).toContain('歌单 1')
    expect(renderToStaticMarkup(targets[1])).toContain('歌单 5')
    const included = targets.find(button => renderToStaticMarkup(button).includes('歌单 0'))!
    expect(included.props.disabled).toBe(true)
    expect(renderToStaticMarkup(included)).toContain('已包含这首歌')
  })

  it('超过五份歌单时提供名称搜索并显示匹配结果', () => {
    h.query = '  歌单 3  '
    const tree = quickTree()
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('搜索应用歌单')
    expect(html).toContain('歌单 3')
    expect(html).not.toContain('加入 歌单 1')
    expect(buttons(tree.props.children).filter(button => renderToStaticMarkup(button).includes('aria-label="加入'))).toHaveLength(1)
  })

  it('成功回执包含歌单名称与实际新增数，并供批量选择器记住目标', () => {
    const tree = quickTree()
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 歌单 1'))!.props.onClick()
    expect(h.add).toHaveBeenCalledWith('1', [track])
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('已加入「歌单 1」，新增 1 首')
    expect(localStorage.setItem).toHaveBeenCalledWith('simplemusic-app-playlist-last-target', '1')
    expect(useTrackActionsStore.getState().quickAdd).toBeNull()
  })


  it('pending 歌曲先读取详情，再收藏完整元数据', async () => {
    const pending = { ...track, id: 2, name: '', artist: '', pending: true }
    useTrackActionsStore.getState().openQuickAdd(pending, { x: 0, y: 0, width: 0, height: 0 })
    h.resolve.mockResolvedValue([{ ...track, id: 2 }])
    const tree = quickTree()
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 歌单 1'))!.props.onClick()
    expect(h.add).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(h.add).toHaveBeenCalledWith('1', [{ ...track, id: 2 }]))
    expect(h.resolve).toHaveBeenCalledWith([pending], [], expect.any(AbortSignal))
    expect(h.toast).toHaveBeenCalledWith('已加入「歌单 1」，新增 1 首')
  })

  it('新建歌单同样先补全 pending 详情，平台漏回时保存明确的待加载占位', async () => {
    const pending = { ...track, id: 2, name: '', artist: '', pending: true }
    useTrackActionsStore.getState().openQuickAdd(pending, { x: 0, y: 0, width: 0, height: 0 })
    h.items = []; h.name = '新歌单'
    h.resolve.mockResolvedValue([pending])
    const tree = quickTree()
    function submit(node: ReactNode): (() => void) | undefined {
      for (const child of Children.toArray(node)) {
        if (!isValidElement<{ children?: ReactNode; onSubmit?(event: { preventDefault(): void }): void }>(child)) continue
        if (child.type === 'form') return () => child.props.onSubmit?.({ preventDefault() {} })
        const nested = submit(child.props.children)
        if (nested) return nested
      }
    }
    submit(tree.props.children)!()
    await vi.waitFor(() => expect(h.create).toHaveBeenCalledWith('新歌单', [{ ...pending, name: '待加载歌曲' }]))
    expect(h.toast).toHaveBeenCalledWith('已新建「新歌单」，新增 1 首')
  })

  it.each(['close', 'unmount', 'switch'])('pending 读取过程中 %s 后，迟到结果不能保存或提示成功', async action => {
    const pending = { ...track, id: 2, name: '', artist: '', pending: true }
    useTrackActionsStore.getState().openQuickAdd(pending, { x: 0, y: 0, width: 0, height: 0 })
    let finish!: (tracks: Track[]) => void
    h.resolve.mockImplementationOnce(() => new Promise<Track[]>(resolve => { finish = resolve }))
    const tree = quickTree()
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 歌单 1'))!.props.onClick()
    const signal = h.resolve.mock.calls[0][2] as AbortSignal
    if (action === 'close') tree.props.onClose()
    else {
      h.cleanups.splice(0).forEach(cleanup => cleanup())
      if (action === 'switch') useTrackActionsStore.getState().openQuickAdd({ ...track, id: 3 }, { x: 0, y: 0, width: 0, height: 0 })
    }
    expect(signal.aborted).toBe(true)
    finish([{ ...track, id: 2 }])
    await Promise.resolve(); await Promise.resolve()
    expect(h.add).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('pending 详情读取失败时保留弹层，不保存空白信息或发送成功回执', async () => {
    useTrackActionsStore.getState().openQuickAdd({ ...track, id: 2, name: '', artist: '', pending: true }, { x: 0, y: 0, width: 0, height: 0 })
    h.resolve.mockRejectedValueOnce(new Error('详情读取失败'))
    const tree = quickTree()
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 歌单 1'))!.props.onClick()
    await Promise.resolve(); await Promise.resolve()
    expect(h.add).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
    expect(useTrackActionsStore.getState().quickAdd).not.toBeNull()
  })

  it('保存失败时保留选择器，不发成功回执或记住错误目标', () => {
    h.add.mockImplementation(() => { throw new Error('写入失败') })
    const tree = quickTree()
    buttons(tree.props.children).find(button => renderToStaticMarkup(button).includes('加入 歌单 1'))!.props.onClick()
    expect(h.toast).not.toHaveBeenCalled()
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(useTrackActionsStore.getState().quickAdd).not.toBeNull()
  })
})
