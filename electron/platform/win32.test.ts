import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: h.spawn, execFile: vi.fn() }))
vi.mock('electron', () => ({ app: {}, shell: {} }))

import { win32Adapter } from './win32'

function createPoller() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    kill: vi.fn(() => true)
  })
}

describe('Windows 桌面歌词中键轮询', () => {
  beforeEach(() => { h.spawn.mockReset() })
  afterEach(() => { win32Adapter.stopMousePoller() })

  it.each(['exit', 'error'])('旧进程迟到的 %s 不清除新实例，关闭仍终止新进程', (event) => {
    const old = createPoller()
    const current = createPoller()
    h.spawn.mockReturnValueOnce(old).mockReturnValueOnce(current)
    win32Adapter.startMousePoller(vi.fn())
    win32Adapter.stopMousePoller()
    win32Adapter.startMousePoller(vi.fn())

    expect(() => old.emit(event, event === 'error' ? new Error('late failure') : 0)).not.toThrow()
    win32Adapter.stopMousePoller()

    expect(old.kill).toHaveBeenCalledOnce()
    expect(current.kill).toHaveBeenCalledOnce()
  })

  it('旧进程的输出不触发回调，也不污染新实例的分片', () => {
    const old = createPoller()
    const current = createPoller()
    const oldClick = vi.fn()
    const currentClick = vi.fn()
    h.spawn.mockReturnValueOnce(old).mockReturnValueOnce(current)
    win32Adapter.startMousePoller(oldClick)
    old.stdout.emit('data', Buffer.from('M'))
    win32Adapter.stopMousePoller()
    win32Adapter.startMousePoller(currentClick)

    old.stdout.emit('data', Buffer.from('MMB\n'))
    current.stdout.emit('data', Buffer.from('MM'))
    old.stdout.emit('data', Buffer.from('MMB\nM'))
    current.stdout.emit('data', Buffer.from('B\n'))

    expect(oldClick).not.toHaveBeenCalled()
    expect(currentClick).toHaveBeenCalledOnce()
  })

  it('停止时即使 kill 同步送出旧消息也不触发回调', () => {
    const child = createPoller()
    const onClick = vi.fn()
    h.spawn.mockReturnValue(child)
    win32Adapter.startMousePoller(onClick)
    child.kill.mockImplementation(() => {
      child.stdout.emit('data', Buffer.from('MMB\n'))
      return true
    })

    win32Adapter.stopMousePoller()

    expect(onClick).not.toHaveBeenCalled()
  })

  it('当前实例按完整行处理 MMB，重复启停不增加进程或终止次数', () => {
    const child = createPoller()
    const onClick = vi.fn()
    const ignoredClick = vi.fn()
    h.spawn.mockReturnValue(child)
    win32Adapter.startMousePoller(onClick)
    win32Adapter.startMousePoller(ignoredClick)
    child.stdout.emit('data', Buffer.from('MM'))
    expect(onClick).not.toHaveBeenCalled()
    child.stdout.emit('data', Buffer.from('B\r\nnoise\nMMB\n'))

    expect(h.spawn).toHaveBeenCalledOnce()
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(ignoredClick).not.toHaveBeenCalled()
    win32Adapter.stopMousePoller()
    win32Adapter.stopMousePoller()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('回调中停止轮询后，不再分发同批次剩余的旧消息', () => {
    const child = createPoller()
    const onClick = vi.fn(() => win32Adapter.stopMousePoller())
    h.spawn.mockReturnValue(child)
    win32Adapter.startMousePoller(onClick)

    child.stdout.emit('data', Buffer.from('MMB\nMMB\n'))

    expect(onClick).toHaveBeenCalledOnce()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it.each(['exit', 'error'])('当前进程 %s 后允许重新启动，之后的旧输出被忽略', (event) => {
    const old = createPoller()
    const current = createPoller()
    const oldClick = vi.fn()
    const currentClick = vi.fn()
    h.spawn.mockReturnValueOnce(old).mockReturnValueOnce(current)
    win32Adapter.startMousePoller(oldClick)
    old.emit(event, event === 'error' ? new Error('failure') : 0)
    win32Adapter.startMousePoller(currentClick)
    old.stdout.emit('data', Buffer.from('MMB\n'))
    current.stdout.emit('data', Buffer.from('MMB\n'))

    expect(h.spawn).toHaveBeenCalledTimes(2)
    expect(oldClick).not.toHaveBeenCalled()
    expect(currentClick).toHaveBeenCalledOnce()
  })
})
