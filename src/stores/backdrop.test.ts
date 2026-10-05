import { describe, expect, it } from 'vitest'
import { useBackdropStore } from './backdrop'

describe('详情背景转场所有权', () => {
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
