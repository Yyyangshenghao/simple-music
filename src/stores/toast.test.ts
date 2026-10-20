import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActionToastStore, useToastStore } from './toast'

describe('主界面撤销提示', () => {
  beforeEach(() => { vi.useFakeTimers(); useActionToastStore.getState().dismiss(); useToastStore.getState().dismiss() })
  afterEach(() => { useActionToastStore.getState().dismiss(); useToastStore.getState().dismiss(); vi.useRealTimers() })

  it('撤销只执行一次，六秒后释放旧回调', () => {
    const undo = vi.fn()
    const store = useActionToastStore.getState()
    store.show('已移出歌曲', '撤销', undo)
    store.activate()
    store.activate()
    expect(undo).toHaveBeenCalledOnce()
    expect(useActionToastStore.getState().notification).toBeNull()
    store.show('已移出另一首', '撤销', undo)
    vi.advanceTimersByTime(6000)
    store.activate()
    expect(undo).toHaveBeenCalledOnce()
    expect(useActionToastStore.getState().notification).toBeNull()
  })

  it('失败保留撤销供重试，成功后关闭', () => {
    const undo = vi.fn().mockImplementationOnce(() => { throw new Error('存储失败，请重试') })
    const store = useActionToastStore.getState()
    store.show('已移出歌曲', '撤销', undo)
    store.activate()
    expect(useActionToastStore.getState().notification?.message).toBe('存储失败，请重试')
    store.activate()
    expect(undo).toHaveBeenCalledTimes(2)
    expect(useActionToastStore.getState().notification).toBeNull()
  })

  it('普通播放提示不会清除撤销，后一次移出替换旧撤销并重置有效期', () => {
    const previous = vi.fn(), current = vi.fn()
    const store = useActionToastStore.getState()
    store.show('旧操作', '撤销', previous)
    vi.advanceTimersByTime(5000)
    useToastStore.getState().show('播放提示')
    expect(useActionToastStore.getState().notification?.message).toBe('旧操作')
    store.show('新操作', '撤销', current)
    vi.advanceTimersByTime(1000)
    store.activate()
    expect(previous).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
  })
})
