import { describe, expect, it } from 'vitest'
import { useBackdropStore } from './backdrop'

describe('详情背景转场所有权', () => {
  it('歌手页的柔和样式不会泄漏到下一张歌单，即使封面相同', () => {
    const artistCleanup = useBackdropStore.getState().setCover('same-cover', 'artist')
    expect(useBackdropStore.getState().variant).toBe('artist')
    const playlistCleanup = useBackdropStore.getState().setCover('same-cover')
    artistCleanup()
    expect(useBackdropStore.getState()).toMatchObject({ cover: 'same-cover', variant: 'default' })
    playlistCleanup()
    expect(useBackdropStore.getState()).toMatchObject({ cover: null, variant: 'default' })
  })

  it('旧页退出不能清掉新页背景，即使两页使用同一封面', () => {
    const oldCleanup = useBackdropStore.getState().setCover('same-cover')
    const nextCleanup = useBackdropStore.getState().setCover('same-cover')
    oldCleanup()
    expect(useBackdropStore.getState().cover).toBe('same-cover')
    nextCleanup()
    expect(useBackdropStore.getState().cover).toBeNull()
  })

  it('新页先退出，后续旧页清理也不恢复旧背景', () => {
    const oldCleanup = useBackdropStore.getState().setCover('old-cover')
    const nextCleanup = useBackdropStore.getState().setCover('new-cover')
    nextCleanup()
    oldCleanup()
    expect(useBackdropStore.getState().cover).toBeNull()
  })
})
