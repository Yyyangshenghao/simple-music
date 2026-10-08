import { create } from 'zustand'

type BackdropVariant = 'default' | 'artist'

interface BackdropStore {
  /** 当前详情页(歌单/歌手)背景封面;为 null 时显示全局氛围背景。 */
  cover: string | null
  variant: BackdropVariant
  setCover(url: string | null | undefined, variant?: BackdropVariant): () => void
}

/** 歌单/歌手详情页的封面背景状态。跨路由共享,由 App 根部渲染的 DetailBackdrop 统一读取,
 * 使模糊背景铺满整个应用(含 TopBar 区域),而不局限于各页面自身的可滚动容器。 */
let owner = 0

export const useBackdropStore = create<BackdropStore>((set) => ({
  cover: null,
  variant: 'default',
  setCover(url, variant = 'default') {
    const currentOwner = ++owner
    set({ cover: url ?? null, variant })
    return () => {
      // 页面退出动画期间新旧页会共存，旧页清理不能撤掉新页背景。
      if (owner === currentOwner) set({ cover: null, variant: 'default' })
    }
  },
}))
