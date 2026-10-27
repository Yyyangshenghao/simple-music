import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRemoteSeparator, type KaraokeHelperChannel } from './remote-separator'
import type { KaraokeHelperEvent, KaraokeHelperRequest } from '../../types/ipc'

function channel() {
  const requests: KaraokeHelperRequest[] = []
  let listener: ((event: KaraokeHelperEvent) => void) | null = null
  const target: KaraokeHelperChannel = {
    karaokeRequest: request => { requests.push(request) },
    onKaraokeEvent: cb => { listener = cb; return () => {} },
  }
  const lastId = () => (requests.filter(r => r.type === 'separate').at(-1) as { id: string }).id
  return { target, requests, lastId, emit: (event: KaraokeHelperEvent) => listener?.(event) }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('宿主侧远程分离端口', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 }))) })

  it('伴奏已存在时直接返回，不拉起分离进程', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const c = channel()
    const port = createRemoteSeparator(c.target)
    await expect(port.separate('hq3', 'local:1', 'x', vi.fn(), new AbortController().signal)).resolves.toContain('/api/karaoke/stem')
    expect(c.requests).toEqual([])
    expect(port.knownStem('hq3', 'local:1')).toContain('key=local%3A1')
    expect(port.knownStem('kara2', 'local:1')).toBeNull()
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('model=hq3')
  })

  it('转发任务与进度，完成后记住伴奏地址', async () => {
    const c = channel()
    const port = createRemoteSeparator(c.target)
    const onProgress = vi.fn()
    const job = port.separate('hq3', 'local:1', 'http://x/a.flac', onProgress, new AbortController().signal)
    await tick()
    expect(c.requests[0]).toMatchObject({ type: 'separate', model: 'hq3', key: 'local:1', src: 'http://x/a.flac' })
    c.emit({ type: 'progress', id: c.lastId(), phase: 'model', progress: 0.3 })
    c.emit({ type: 'done', id: c.lastId(), url: 'http://127.0.0.1/stem?key=local%3A1' })
    await expect(job).resolves.toBe('http://127.0.0.1/stem?key=local%3A1')
    expect(onProgress).toHaveBeenCalledWith({ phase: 'model', progress: 0.3 })
    expect(port.knownStem('hq3', 'local:1')).toBe('http://127.0.0.1/stem?key=local%3A1')
    // 内部暂存文件可能被清理；再次请求必须回查磁盘，不能只信内存地址。
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(port.separate('hq3', 'local:1', 'x', vi.fn(), new AbortController().signal)).resolves.toContain('stem')
    expect(c.requests).toHaveLength(1)
  })

  it('取消立即以 AbortError 结束并通知分离进程；迟到结果不再生效', async () => {
    const c = channel()
    const port = createRemoteSeparator(c.target)
    const ctrl = new AbortController()
    const job = port.separate('hq3', 'local:1', 'x', vi.fn(), ctrl.signal)
    await tick()
    const id = c.lastId()
    ctrl.abort()
    await expect(job).rejects.toMatchObject({ name: 'AbortError' })
    expect(c.requests.at(-1)).toEqual({ type: 'cancel', id })
    c.emit({ type: 'done', id, url: 'u' })
    expect(port.knownStem('hq3', 'local:1')).toBeNull()
  })

  it('分离失败带回原因；release 中止在途任务并结束分离进程', async () => {
    const c = channel()
    const port = createRemoteSeparator(c.target)
    const failed = port.separate('hq3', 'local:1', 'x', vi.fn(), new AbortController().signal)
    await tick()
    c.emit({ type: 'error', id: c.lastId(), message: '读取音频失败（HTTP 404）' })
    await expect(failed).rejects.toThrow('读取音频失败')
    const pending = port.separate('hq3', 'local:2', 'y', vi.fn(), new AbortController().signal)
    await tick()
    port.release()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(c.requests.at(-1)).toEqual({ type: 'release' })
  })

  it('没有桥接通道时不支持也不分离', async () => {
    const port = createRemoteSeparator(undefined)
    expect(await port.supported()).toBe(false)
    await expect(port.separate('hq3', 'local:1', 'x', vi.fn(), new AbortController().signal)).rejects.toThrow('分离进程不可用')
  })
})
