import { describe, expect, it, vi } from 'vitest'
import { createResizeDispatcher } from './resize-dispatcher'

describe('createResizeDispatcher', () => {
  it('同一帧后续增量会在前一笔完成后合并发送', async () => {
    let resolveFirst: (() => void) | undefined
    const send = vi.fn(
      (dx: number) =>
        new Promise<void>((resolve) => {
          if (dx === 40) resolveFirst = resolve
          else resolve()
        })
    )
    const dispatcher = createResizeDispatcher(send)

    dispatcher.push(40)
    dispatcher.push(30)
    dispatcher.push(30)

    await Promise.resolve()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenNthCalledWith(1, 40)

    resolveFirst?.()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))

    expect(send).toHaveBeenNthCalledWith(2, 60)
  })

  it('忽略 0 和非数值增量', () => {
    const send = vi.fn()
    const dispatcher = createResizeDispatcher(send)

    dispatcher.push(0)
    dispatcher.push(Number.NaN)

    expect(send).not.toHaveBeenCalled()
  })

  it('发送阶段同步抛错后仍能继续处理后续增量', async () => {
    const send = vi
      .fn<(_: number) => void>()
      .mockImplementationOnce(() => {
        throw new Error('boom')
      })
      .mockImplementation(() => undefined)
    const dispatcher = createResizeDispatcher(send)

    dispatcher.push(20)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    dispatcher.push(15)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))

    expect(send).toHaveBeenNthCalledWith(1, 20)
    expect(send).toHaveBeenNthCalledWith(2, 15)
  })

  it('在途请求挂起时超时恢复并继续发送合并增量', async () => {
    vi.useFakeTimers()
    const send = vi
      .fn<(_: number) => Promise<void> | void>()
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockImplementation(() => undefined)
    const dispatcher = createResizeDispatcher(send, 100)

    dispatcher.push(20)
    await Promise.resolve()
    dispatcher.push(15)
    dispatcher.push(10)

    await vi.advanceTimersByTimeAsync(100)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(2, 25)
    vi.useRealTimers()
  })
})
