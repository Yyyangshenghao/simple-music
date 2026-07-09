import { create } from 'zustand'

interface BackdropStore {
  /** 当前详情页(歌单/歌手)背景封面;为 null 时显示全局氛围背景。 */
  cover: string | null
  setCover(url: string | null | undefined): void
}

/** 歌单/歌手详情页的封面背景状态。跨路由共享,由 App 根部渲染的 DetailBackdrop 统一读取,
 * 使模糊背景铺满整个应用(含 TopBar 区域),而不局限于各页面自身的可滚动容器。 */
export const useBackdropStore = create<BackdropStore>((set) => ({
  cover: null,
  setCover(url) {
    set({ cover: url ?? null })
  },
}))
