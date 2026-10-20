import { describe, expect, it } from 'vitest'
import { containsTrack, orderQuickAddTargets, placePopover, useTrackActionsStore } from './track-actions'
import type { AppPlaylist } from './app-playlists'
import type { Track } from '../types/domain'

const song = (source: Track['source'], id: string): Track => ({ source, provider: source, type: 'song', id, name: '歌曲', artist: '', artists: [] })
const playlist = (id: string, updatedAt: number, tracks: Track[] = []): AppPlaylist => ({ id, name: id, createdAt: 0, updatedAt, tracks })
const viewport = { width: 1000, height: 800 }
const size = { width: 280, height: 300 }

describe('单曲快速加入', () => {
  it('浮层默认在锚点下方，下方不够时翻到上方，横向不出视口', () => {
    expect(placePopover({ x: 100, y: 100, width: 30, height: 30 }, size, viewport)).toEqual({ left: 100, top: 136 })
    expect(placePopover({ x: 100, y: 700, width: 30, height: 30 }, size, viewport)).toEqual({ left: 100, top: 394 })
    expect(placePopover({ x: 900, y: 100, width: 0, height: 0 }, size, viewport).left).toBe(712)
  })

  it('上下都放不下时贴视口底边，不越出顶部', () => {
    expect(placePopover({ x: 0, y: 200, width: 0, height: 0 }, { width: 280, height: 700 }, viewport)).toEqual({ left: 8, top: 92 })
  })

  it('上次使用的歌单置顶，其余按最近更新排序', () => {
    const ordered = orderQuickAddTargets([playlist('a', 1), playlist('b', 3), playlist('c', 2)], 'a')
    expect(ordered.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(orderQuickAddTargets([playlist('a', 1), playlist('b', 3)], 'gone').map(item => item.id)).toEqual(['b', 'a'])
  })

  it('按来源与 id 判断是否已在歌单，不同来源同 id 互不影响', () => {
    const item = playlist('a', 1, [song('qq', '1')])
    expect(containsTrack(item, song('qq', '1'))).toBe(true)
    expect(containsTrack(item, song('netease', '1'))).toBe(false)
  })

  it('右键菜单与快速加入同时只开一个', () => {
    const anchor = { x: 0, y: 0, width: 0, height: 0 }
    useTrackActionsStore.getState().openMenu(song('qq', '1'), anchor)
    useTrackActionsStore.getState().openQuickAdd(song('qq', '1'), anchor)
    expect(useTrackActionsStore.getState().menu).toBeNull()
    expect(useTrackActionsStore.getState().quickAdd).not.toBeNull()
    useTrackActionsStore.getState().close()
    expect(useTrackActionsStore.getState().quickAdd).toBeNull()
  })

  it('触发按钮再次点击同一首歌时关闭，换一首歌时切换', () => {
    const anchor = { x: 0, y: 0, width: 0, height: 0 }
    const { toggleQuickAdd } = useTrackActionsStore.getState()
    toggleQuickAdd(song('qq', '1'), anchor)
    toggleQuickAdd(song('netease', '1'), anchor)
    expect(useTrackActionsStore.getState().quickAdd?.track.source).toBe('netease')
    toggleQuickAdd(song('netease', '1'), anchor)
    expect(useTrackActionsStore.getState().quickAdd).toBeNull()
  })
})
