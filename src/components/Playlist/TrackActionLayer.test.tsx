import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrackActionLayer } from './TrackActionLayer'
import { AddToPlaylistDialog } from './AddToPlaylistDialog'
import { useTrackActionsStore } from '../../stores/track-actions'
import type { Track } from '../../types/domain'

const h = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }))
vi.mock('../../stores/track-actions', async importOriginal => {
  const actual = await importOriginal<typeof import('../../stores/track-actions')>()
  return { ...actual, useTrackActionsStore: Object.assign((selector: (state: unknown) => unknown) => selector(actual.useTrackActionsStore.getState()), actual.useTrackActionsStore) }
})
vi.mock('../../lib/batch-tracks', () => ({ resolveAppPlaylistTracks: h.resolve }))
vi.mock('../../stores/playlist', () => ({ usePlaylistStore: { getState: () => ({}) } }))

type DialogProps = Parameters<typeof AddToPlaylistDialog>[0]
const track: Track = { provider: 'qq', source: 'qq', type: 'song', id: 1, name: '歌曲', artist: '歌手', artists: [] }
const anchor = { x: 0, y: 0, width: 0, height: 0 }
function dialog(): ReactElement<DialogProps> {
  const layer = TrackActionLayer() as ReactElement<{ children: ReactNode }>
  const quick = Children.toArray(layer.props.children).find(child => isValidElement(child)) as ReactElement<Record<string, unknown>>
  return (quick.type as (props: Record<string, unknown>) => ReactElement<DialogProps>)(quick.props)
}

describe('单曲加入歌单', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('document', { body: {} }) })
  afterEach(() => { useTrackActionsStore.getState().close(); vi.unstubAllGlobals() })

  it('与多选共用统一的加入歌单弹窗，并以歌名与歌手作上下文', async () => {
    useTrackActionsStore.getState().openQuickAdd(track, anchor)
    const tree = dialog()
    expect(tree.type).toBe(AddToPlaylistDialog)
    expect(tree.props.tracks).toEqual([track])
    expect(tree.props.contextLabel).toBe('歌曲 · 歌手')
    await expect(tree.props.loadTracks(new AbortController().signal)).resolves.toEqual([track])
    expect(h.resolve).not.toHaveBeenCalled()
    tree.props.onClose()
    expect(useTrackActionsStore.getState().quickAdd).toBeNull()
  })

  it('pending 歌曲先读取详情，再收藏完整元数据', async () => {
    const pending = { ...track, id: 2, name: '', artist: '', pending: true }
    useTrackActionsStore.getState().openQuickAdd(pending, anchor)
    h.resolve.mockResolvedValue([{ ...track, id: 2 }])
    const signal = new AbortController().signal
    await expect(dialog().props.loadTracks(signal)).resolves.toEqual([{ ...track, id: 2 }])
    expect(h.resolve).toHaveBeenCalledWith([pending], [], signal)
  })

  it('平台漏回详情时保存明确的待加载占位', async () => {
    const pending = { ...track, id: 2, name: '', artist: '', pending: true }
    useTrackActionsStore.getState().openQuickAdd(pending, anchor)
    h.resolve.mockResolvedValue([pending])
    await expect(dialog().props.loadTracks(new AbortController().signal)).resolves.toEqual([{ ...pending, name: '待加载歌曲' }])
  })

  it('详情读取失败时报错，交由选择器保留弹窗', async () => {
    useTrackActionsStore.getState().openQuickAdd({ ...track, pending: true }, anchor)
    h.resolve.mockResolvedValue([])
    await expect(dialog().props.loadTracks(new AbortController().signal)).rejects.toThrow('未能读取歌曲信息')
  })
})
