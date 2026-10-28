import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => any>(),
  children: [] as any[],
  spawnArgs: [] as any[],
  trusted: true,
  sent: [] as any[],
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/data' },
  ipcMain: { on: (name: string, fn: (...args: any[]) => any) => h.listeners.set(name, fn) },
}))
vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null, killed: false, send: vi.fn(),
      kill: vi.fn(function (this: any) { this.killed = true }),
    })
    h.spawnArgs.push(args)
    h.children.push(child)
    return child
  },
}))
vi.mock('./playback-host', () => ({
  isPlaybackHostEvent: () => h.trusted,
  sendPlaybackEvent: (channel: string, payload: unknown) => { h.sent.push([channel, payload]); return true },
}))

async function setup() {
  vi.resetModules()
  h.listeners.clear(); h.children = []; h.spawnArgs = []; h.sent = []; h.trusted = true
  const mod = await import('./karaoke-helper')
  mod.registerKaraokeHelperIpc(4321, 'tok')
  const request = (payload: unknown) => h.listeners.get('karaoke:request')!({}, payload)
  return { mod, request }
}

describe('K 歌分离进程管理', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('显式任务才拉起独立进程，单次只接收一个任务', async () => {
    const { request } = await setup()
    expect(h.children).toHaveLength(0)
    await request({ type: 'separate', id: 'a', model: 'hq3', key: 'local:1', src: 'http://x/a.flac' })
    const [exec, args, options] = h.spawnArgs[0]
    expect(exec).toBe(process.execPath)
    expect(args).toEqual(['/app', '--simplemusic-karaoke-helper', expect.stringMatching(/^--simplemusic-karaoke-data=.*karaoke-helper$/)])
    expect(options.stdio[3]).toBe('ipc')
    expect(h.children[0].send.mock.calls.map((c: any[]) => c[0].type)).toEqual(['init', 'separate'])
    await request({ type: 'separate', id: 'b', model: 'hq3', key: 'local:2', src: 'x' })
    expect(h.children).toHaveLength(1)
    expect(h.sent.at(-1)[1]).toMatchObject({ type: 'error', id: 'b' })
  })

  it('只接受可信宿主的有效请求', async () => {
    const { request } = await setup()
    h.trusted = false
    await request({ type: 'separate', id: 'a', model: 'hq3', key: 'local:1', src: 'x' })
    h.trusted = true
    await request({ type: 'separate', id: '', model: 'hq3', key: 'local:1', src: 'x' })
    await request({ type: 'separate', id: 'a', model: 'nope', key: 'local:1', src: 'x' })
    expect(h.children).toHaveLength(0)
  })

  it('完成立即退出；新任务等旧进程真正退出后才启动，避免内存重叠', async () => {
    const { request } = await setup()
    await request({ type: 'separate', id: 'a', model: 'hq3', key: 'local:1', src: 'x' })
    const child = h.children[0]
    child.emit('message', { type: 'progress', id: 'a', phase: 'separating', progress: 0.5 })
    child.emit('message', { type: 'done', id: 'a', url: 'http://127.0.0.1/stem' })
    expect(child.kill).toHaveBeenCalledOnce()
    const next = request({ type: 'separate', id: 'b', model: 'hq3', key: 'local:2', src: 'y' })
    expect(h.children).toHaveLength(1)
    child.emit('exit', 0)
    await next
    expect(h.children).toHaveLength(2)
    h.children[1].emit('exit', 1)
    expect(h.sent.map(([, p]) => `${p.type}:${p.id}`)).toEqual(['progress:a', 'done:a', 'error:b'])
  })

  it('取消立即结束进程，旧进程迟到的结果不会回写', async () => {
    const { request } = await setup()
    await request({ type: 'separate', id: 'a', model: 'hq3', key: 'local:1', src: 'x' })
    const child = h.children[0]
    await request({ type: 'cancel', id: 'a' })
    expect(child.kill).toHaveBeenCalledOnce()
    expect(h.sent.at(-1)[1]).toMatchObject({ id: 'a', aborted: true })
    child.emit('message', { type: 'done', id: 'a', url: 'u' })
    expect(h.sent).toHaveLength(1)
  })

  it('等待旧进程退出期间取消，不会再拉起新进程', async () => {
    const { request } = await setup()
    await request({ type: 'separate', id: 'a', model: 'hq3', key: 'local:1', src: 'x' })
    await request({ type: 'release' })
    const next = request({ type: 'separate', id: 'b', model: 'hq3', key: 'local:2', src: 'x' })
    await request({ type: 'cancel', id: 'b' })
    h.children[0].emit('exit', 0)
    await next
    expect(h.children).toHaveLength(1)
  })

  it('32 GB 设备有 5 GB 可用内存时允许启动分离实例', async () => {
    vi.stubGlobal('process', { ...process, getSystemMemoryInfo: () => ({ total: 32 * 1024 ** 2, free: 5 * 1024 ** 2 }) })
    const { request } = await setup()
    await request({ type: 'separate', id: 'a', model: 'hq3', key: 'local:1', src: 'x' })
    expect(h.children).toHaveLength(1)
    h.children[0].emit('exit', 0)
  })

  it('启动前内存不足时不创建进程；运行中严重压力则释放资源', async () => {
    let free = 128 * 1024
    vi.stubGlobal('process', { ...process, getSystemMemoryInfo: () => ({ total: 16 * 1024 * 1024, free }) })
    const { request } = await setup()
    await request({ type: 'separate', id: 'a', model: 'hq3', key: 'local:1', src: 'x' })
    expect(h.children).toHaveLength(0)
    expect(h.sent.at(-1)[1].message).toContain('内存不足')
    free = 8 * 1024 * 1024
    await request({ type: 'separate', id: 'b', model: 'hq3', key: 'local:1', src: 'x' })
    free = 128 * 1024
    vi.advanceTimersByTime(1000)
    expect(h.children[0].kill).toHaveBeenCalledOnce()
    expect(h.sent.at(-1)[1].message).toContain('系统内存紧张')
  })
})
