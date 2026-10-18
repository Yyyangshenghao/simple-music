import { create } from 'zustand'
import type { WritablePlaylistSource } from '../types/platform-playlist'

/** 平台写入后通知仍挂载的列表与详情重新读取，缓存清理本身不会触发 React 更新。 */
export const usePlatformPlaylistsStore = create<{
  revision: Record<WritablePlaylistSource, number>
  changed(source: WritablePlaylistSource): void
}>(set => ({
  revision: { netease: 0, qq: 0 },
  changed: source => set(state => ({ revision: { ...state.revision, [source]: state.revision[source] + 1 } })),
}))
