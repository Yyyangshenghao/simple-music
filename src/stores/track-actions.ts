import { create } from 'zustand'
import type { Track } from '../types/domain'
import type { AppPlaylist } from './app-playlists'
import { appPlaylistTrackKey } from './app-playlists'

/** 浮层锚点：右键为光标点（宽高 0），按钮为其矩形。 */
export interface PopoverAnchor { x: number; y: number; width: number; height: number }

interface TrackActionsStore {
  quickAdd: { track: Track; anchor: PopoverAnchor } | null
  menu: { track: Track; anchor: PopoverAnchor } | null
  openQuickAdd(track: Track, anchor: PopoverAnchor): void
  openMenu(track: Track, anchor: PopoverAnchor): void
  /** 触发按钮用：同一首歌的弹层已打开则关闭，否则打开。 */
  toggleQuickAdd(track: Track, anchor: PopoverAnchor): void
  close(): void
}

/** 单曲操作浮层只开一个；由 App 根部的 TrackActionLayer 统一渲染。 */
export const useTrackActionsStore = create<TrackActionsStore>((set) => ({
  quickAdd: null,
  menu: null,
  openQuickAdd: (track, anchor) => set({ quickAdd: { track, anchor }, menu: null }),
  openMenu: (track, anchor) => set({ menu: { track, anchor }, quickAdd: null }),
  toggleQuickAdd: (track, anchor) => set((state) => state.quickAdd && appPlaylistTrackKey(state.quickAdd.track) === appPlaylistTrackKey(track)
    ? { quickAdd: null, menu: null }
    : { quickAdd: { track, anchor }, menu: null }),
  close: () => set({ quickAdd: null, menu: null }),
}))

export function anchorOf(element: Element): PopoverAnchor {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

const MARGIN = 8

/** 优先放在锚点下方并左对齐；下方放不下翻到上方，横向贴边收回视口内。 */
export function placePopover(anchor: PopoverAnchor, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const below = anchor.y + anchor.height + 6
  const above = anchor.y - size.height - 6
  const top = below + size.height <= viewport.height - MARGIN || above < MARGIN
    ? Math.min(below, viewport.height - size.height - MARGIN)
    : above
  const left = Math.min(anchor.x, viewport.width - size.width - MARGIN)
  return { left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) }
}

export const LAST_TARGET_KEY = 'simplemusic-app-playlist-last-target'

/** 上次加入的歌单排第一，其余按最近更新排序，便于连续收藏到同一份歌单。 */
export function orderQuickAddTargets(items: AppPlaylist[], lastId: string | null): AppPlaylist[] {
  return [...items].sort((a, b) => (b.id === lastId ? 1 : 0) - (a.id === lastId ? 1 : 0) || b.updatedAt - a.updatedAt)
}

export function containsTrack(item: AppPlaylist, track: Track): boolean {
  const key = appPlaylistTrackKey(track)
  return item.tracks.some(entry => appPlaylistTrackKey(entry) === key)
}
