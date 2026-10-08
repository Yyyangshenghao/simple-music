import { createReadStream, type ReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, get, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serveFileWithRange } from './audio-cache'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

describe('serveFileWithRange HTTP 读取生命周期', () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 'audio data')
  let directory: string
  let filePath: string
  let server: Server
  let baseUrl: string
  let closedOnDone: boolean[]
  let onDone: ReturnType<typeof vi.fn>

  function openedStream(): ReadStream {
    return vi.mocked(createReadStream).mock.results[0]?.value as ReadStream
  }

  beforeEach(async () => {
    vi.mocked(createReadStream).mockClear()
    directory = await mkdtemp(join(tmpdir(), 'sm-audio-stream-test-'))
    filePath = join(directory, 'audio.bin')
    await writeFile(filePath, bytes)
    closedOnDone = []
    onDone = vi.fn(() => { closedOnDone.push(openedStream()?.closed ?? true) })
    server = createServer((req, res) => {
      serveFileWithRange(res, filePath, bytes.length, String(req.headers.range || ''), 'audio/mpeg', onDone)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    for (const result of vi.mocked(createReadStream).mock.results) {
      if (result.type === 'return') (result.value as ReadStream).destroy()
    }
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })

  it.each(['', 'bytes=1024-'])('客户端中断 %s 时先关闭文件，再释放一次租约', async (range) => {
    await new Promise<void>((resolve, reject) => {
      const request = get(baseUrl, { headers: range ? { Range: range } : {} }, (response) => {
        response.once('data', () => {
          response.destroy()
          resolve()
        })
        response.on('error', reject)
      })
      request.on('error', reject)
    })
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(closedOnDone).toEqual([true])
    expect(openedStream().destroyed).toBe(true)
    expect(openedStream().closed).toBe(true)
  })

  it.each(['', 'bytes=10-19'])('正常读取 %s 保留内容、响应头和关闭后的单次回调', async (range) => {
    const response = await fetch(baseUrl, { headers: range ? { Range: range } : {} })
    const received = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(range ? 206 : 200)
    expect(received.equals(range ? bytes.subarray(10, 20) : bytes)).toBe(true)
    expect(response.headers.get('content-length')).toBe(String(received.length))
    expect(response.headers.get('content-range')).toBe(range ? `bytes 10-19/${bytes.length}` : null)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(closedOnDone).toEqual([true])
    expect(openedStream().closed).toBe(true)
  })

  it('响应已断开时不等待错过的 close 事件，仍关闭文件后释放租约', async () => {
    server.removeAllListeners('request')
    server.once('request', (_req, res) => {
      res.once('close', () => {
        serveFileWithRange(res, filePath, bytes.length, '', 'audio/mpeg', onDone)
      })
      res.destroy()
    })
    await expect(fetch(baseUrl)).rejects.toThrow()
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(closedOnDone).toEqual([true])
    expect(openedStream().closed).toBe(true)
  })

  it('无效 Range 返回 416，不打开文件且只释放一次租约', async () => {
    const response = await fetch(baseUrl, { headers: { Range: `bytes=${bytes.length}-` } })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe(`bytes */${bytes.length}`)
    expect(await response.text()).toBe('')
    expect(createReadStream).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('文件读取错误结束响应，并在源流关闭后只释放一次租约', async () => {
    filePath = join(directory, 'missing.bin')
    await expect(fetch(baseUrl).then((response) => response.arrayBuffer())).rejects.toThrow()
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(closedOnDone).toEqual([true])
    expect(openedStream().destroyed).toBe(true)
    expect(openedStream().closed).toBe(true)
  })
})
