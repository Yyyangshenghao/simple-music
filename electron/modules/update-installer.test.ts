import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installUpdateWindows } from './update-installer'

const h = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('electron', () => ({ app: {}, shell: {} }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: h.spawn
}))

describe('Windows 安装器启动确认', () => {
  let child: EventEmitter & { unref: ReturnType<typeof vi.fn> }
  beforeEach(() => {
    vi.useFakeTimers()
    child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    h.spawn.mockReset().mockReturnValue(child)
  })
  afterEach(() => vi.useRealTimers())

  it('等待系统确认进程启动后才允许退出，并让安装器独立运行', async () => {
    const result = installUpdateWindows('C:\\Updates\\Simple Music Setup.exe')
    expect(h.spawn).toHaveBeenCalledWith('C:\\Updates\\Simple Music Setup.exe', ['/S', '--force-run'], { detached: true, stdio: 'ignore' })
    child.emit('spawn')
    await expect(result).resolves.toEqual({ ok: true })
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('等待超过原来的1.5秒也不伪报成功，迟到的启动失败仍返回失败', async () => {
    let settled = false
    const result = installUpdateWindows('C:\\Updates\\Setup.exe')
    void result.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(2000)
    expect(settled).toBe(false)
    expect(child.unref).not.toHaveBeenCalled()
    child.emit('error', new Error('EACCES'))
    await expect(result).resolves.toEqual({ ok: false, error: 'EACCES' })
  })

  it('同步启动异常也交给调用方处理，保留当前应用', async () => {
    h.spawn.mockImplementationOnce(() => { throw new Error('INVALID_EXECUTABLE') })
    await expect(installUpdateWindows('invalid')).rejects.toThrow('INVALID_EXECUTABLE')
  })
})
