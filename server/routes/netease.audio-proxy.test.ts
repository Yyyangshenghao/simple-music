import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { pipeReaderToResponse } from './netease'

/**
 * 模拟上游 CDN 返回的一首"歌"：totalChunks 个数据块，每块间用 setImmediate 让出一次事件循环，
 * 贴近真实网络分片到达的节奏（而不是同步吐完，避免测试里的 close/drain 事件永远抢不到执行机会）。
 */
function makeUpstreamStream(totalChunks: number, chunkSize: number) {
  let sent = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled || sent >= totalChunks) {
        try {
          controller.close()
        } catch {
          /* 已经 cancel 过的流重复 close 会抛，忽略 */
        }
        return
      }
      await new Promise<void>((r) => setImmediate(r))
      if (cancelled) return
      sent++
      controller.enqueue(new Uint8Array(chunkSize))
    },
    cancel() {
      cancelled = true
    },
  })
  return {
    reader: stream.getReader(),
    chunksSent: () => sent,
    wasCancelled: () => cancelled,
  }
}

/** 模拟 http.ServerResponse：写入 disconnectAfterChunks 块后模拟客户端断开（即"切歌"）。 */
function makeFakeResponse(disconnectAfterChunks: number | null) {
  const emitter = new EventEmitter()
  let writes = 0
  const res = {
    write: (_chunk: Uint8Array) => {
      writes++
      if (disconnectAfterChunks != null && writes === disconnectAfterChunks) {
        setImmediate(() => emitter.emit('close'))
      }
      return true
    },
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
  } as unknown as ServerResponse
  return { res, writesCount: () => writes }
}

/** 修复前的手写循环（原样复刻），仅用于对照验证：证明它对客户端断开完全无感知。 */
async function legacyPipeWithoutCleanup(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: { write: (c: Uint8Array) => boolean }
): Promise<void> {
  for (;;) {
    const c = await reader.read()
    if (c.done) break
    res.write(c.value)
  }
}

describe('pipeReaderToResponse（/api/audio、/api/cover 代理转发 —— 切歌内存泄漏回归测试）', () => {
  it('客户端断开（切歌）后立即取消上游读取，不会在后台把剩余数据读完', async () => {
    const CHUNKS = 500
    const upstream = makeUpstreamStream(CHUNKS, 64 * 1024)
    const { res } = makeFakeResponse(10) // 模拟只听了 10 块就切歌

    await pipeReaderToResponse(upstream.reader, res)

    expect(upstream.wasCancelled()).toBe(true)
    expect(upstream.chunksSent()).toBeLessThan(CHUNKS)
  })

  it('客户端正常听完整首歌：不提前取消，数据完整转发', async () => {
    const CHUNKS = 30
    const upstream = makeUpstreamStream(CHUNKS, 1024)
    const { res, writesCount } = makeFakeResponse(null)

    await pipeReaderToResponse(upstream.reader, res)

    expect(upstream.wasCancelled()).toBe(false)
    expect(writesCount()).toBe(CHUNKS)
  })

  it('背压：res.write 返回 false 时会等 drain 再继续读，不会无限抢跑上游数据', async () => {
    const CHUNKS = 20
    const upstream = makeUpstreamStream(CHUNKS, 1024)
    const emitter = new EventEmitter()
    let writes = 0
    let backpressureHit = false
    const res = {
      write: (_chunk: Uint8Array) => {
        writes++
        if (writes === 3) {
          backpressureHit = true
          setImmediate(() => emitter.emit('drain'))
          return false
        }
        return true
      },
      once: emitter.once.bind(emitter),
      off: emitter.off.bind(emitter),
    } as unknown as ServerResponse

    await pipeReaderToResponse(upstream.reader, res)

    expect(backpressureHit).toBe(true)
    expect(writes).toBe(CHUNKS)
  })

  it('连续模拟 50 次切歌：不会有上游流残留未取消（对应真实场景下内存不再随切歌单调上涨）', async () => {
    const ITERATIONS = 50
    const CHUNKS_PER_SONG = 2000 // 若未取消，单首歌会持续读到 2000 块
    const CHUNK_SIZE = 32 * 1024 // 32KB/块，全量约 64MB/首

    const results: boolean[] = []
    for (let i = 0; i < ITERATIONS; i++) {
      const upstream = makeUpstreamStream(CHUNKS_PER_SONG, CHUNK_SIZE)
      const { res } = makeFakeResponse(5) // 每次只听 5 块就切歌
      await pipeReaderToResponse(upstream.reader, res)
      results.push(upstream.wasCancelled())
    }

    const stillDownloadingInBackground = results.filter((cancelled) => !cancelled).length
    expect(stillDownloadingInBackground).toBe(0)
  })

  it('对照组：修复前的手写循环对客户端断开完全无感知，会把整首"歌"读完（复现内存泄漏）', async () => {
    const CHUNKS = 2000
    const upstream = makeUpstreamStream(CHUNKS, 32 * 1024)
    const { res } = makeFakeResponse(5) // 客户端在第 5 块后就断开了

    await legacyPipeWithoutCleanup(upstream.reader, res)

    // 旧循环不监听 close，会无视客户端已经切歌这件事，把 2000 块（约 64MB）全部读完才退出，
    // 且从未调用 reader.cancel() —— 这正是"每切一首歌内存涨一截"的根因。
    expect(upstream.chunksSent()).toBe(CHUNKS)
    expect(upstream.wasCancelled()).toBe(false)
  })
})
