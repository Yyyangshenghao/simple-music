import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowCloseState } from '../types/ipc'
import { initWindowCloseSync, useWindowCloseStore } from './window-close'

const initial = useWindowCloseStore.getState()
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
let emit: (state: WindowCloseState) => void
let getState: ReturnType<typeof vi.fn>
let setBehavior: ReturnType<typeof vi.fn>
let resolve: ReturnType<typeof vi.fn>
let off: ReturnType<typeof vi.fn>
let cleanup: (() => void) | undefined

beforeEach(() => {
  useWindowCloseStore.setState(initial, true)
  cleanup = undefined
  off = vi.fn()
  getState = vi.fn(async () => ({ behavior: 'ask', promptId: null }))
  setBehavior = vi.fn(async (behavior) => ({ behavior, promptId: null }))
  resolve = vi.fn(async () => ({ behavior: 'ask', promptId: null }))
  vi.stubGlobal('window', { desktop: {
    platform: 'win32',
    getWindowCloseState: getState,
    setWindowCloseBehavior: setBehavior,
    resolveWindowClose: resolve,
    onWindowCloseState: (callback: typeof emit) => { emit = callback; return off },
  } })
})
afterEach(() => { cleanup?.(); useWindowCloseStore.setState(initial, true); vi.unstubAllGlobals() })

describe('关闭窗口状态同步', () => {
  it('先监听再读取，早期读取不能覆盖之后到达的关闭确认', async () => {
    let finish!: (state: WindowCloseState) => void
    getState.mockImplementation(() => {
      expect(emit).toBeTypeOf('function')
      return new Promise((done) => { finish = done })
    })
    cleanup = initWindowCloseSync()
    emit({ behavior: 'ask', promptId: 7 })
    finish({ behavior: 'ask', promptId: null })
    await flush()
    expect(useWindowCloseStore.getState()).toMatchObject({ promptId: 7, initialized: true })
    cleanup()
    emit({ behavior: 'quit', promptId: null })
    expect(off).toHaveBeenCalledOnce()
    expect(useWindowCloseStore.getState().promptId).toBe(7)
    cleanup = undefined
  })

  it('卸载后不接受未完成的读取回复，非 Windows 不订阅', async () => {
    let finish!: (state: WindowCloseState) => void
    getState.mockImplementation(() => new Promise((done) => { finish = done }))
    cleanup = initWindowCloseSync()
    cleanup()
    cleanup = undefined
    finish({ behavior: 'quit', promptId: null })
    await flush()
    expect(useWindowCloseStore.getState().initialized).toBe(false)
    window.desktop.platform = 'darwin'
    initWindowCloseSync()()
    expect(getState).toHaveBeenCalledOnce()
  })

  it('读取失败可重新获取主进程状态', async () => {
    getState.mockRejectedValueOnce(new Error('offline'))
    cleanup = initWindowCloseSync()
    await flush()
    expect(useWindowCloseStore.getState()).toMatchObject({ initialized: false, error: '无法读取关闭方式，请重试。' })
    getState.mockResolvedValueOnce({ behavior: 'tray', promptId: null })
    await useWindowCloseStore.getState().refresh()
    expect(useWindowCloseStore.getState()).toMatchObject({ behavior: 'tray', initialized: true, error: '', pending: false })
  })

  it('设置失败不乐观保存；成功回复后才更新行为', async () => {
    setBehavior.mockRejectedValueOnce(new Error('disk'))
    await useWindowCloseStore.getState().configure('quit')
    expect(useWindowCloseStore.getState()).toMatchObject({ behavior: 'ask', error: '关闭方式设置失败，请重试。', pending: false })
    await useWindowCloseStore.getState().configure('tray')
    expect(useWindowCloseStore.getState()).toMatchObject({ behavior: 'tray', error: '', initialized: true })
  })

  it('操作回复和后续早期读取都不能覆盖较新的广播', async () => {
    let finish!: (state: WindowCloseState) => void
    cleanup = initWindowCloseSync()
    await flush()
    setBehavior.mockImplementationOnce(() => new Promise((done) => { finish = done }))
    const operation = useWindowCloseStore.getState().configure('quit')
    emit({ behavior: 'tray', promptId: 8 })
    finish({ behavior: 'quit', promptId: null })
    await operation
    expect(useWindowCloseStore.getState()).toMatchObject({ behavior: 'tray', promptId: 8, pending: false })
  })

  it('确认失败保留同一弹窗可重试，等待期间忽略重复操作', async () => {
    let fail!: (error: Error) => void
    useWindowCloseStore.setState({ promptId: 12 })
    resolve.mockImplementationOnce(() => new Promise((_done, reject) => { fail = reject }))
    const operation = useWindowCloseStore.getState().resolve('tray', true)
    await useWindowCloseStore.getState().resolve('quit', true)
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith({ promptId: 12, action: 'tray', remember: true })
    fail(new Error('ipc'))
    await operation
    expect(useWindowCloseStore.getState()).toMatchObject({ promptId: 12, error: '操作未完成，请重试。', pending: false })
    await useWindowCloseStore.getState().resolve('tray', true)
    expect(useWindowCloseStore.getState()).toMatchObject({ promptId: null, error: '' })
  })

  it('取消永远不记住选择，没有待确认请求时不发送操作', async () => {
    await useWindowCloseStore.getState().resolve('tray', true)
    expect(resolve).not.toHaveBeenCalled()
    useWindowCloseStore.setState({ promptId: 20 })
    await useWindowCloseStore.getState().resolve('cancel', true)
    expect(resolve).toHaveBeenCalledWith({ promptId: 20, action: 'cancel', remember: false })
    expect(useWindowCloseStore.getState().behavior).toBe('ask')
  })
})
