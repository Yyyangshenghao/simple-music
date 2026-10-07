import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { describe, it, expect, vi } from 'vitest'
import { MAX_BODY_BYTES, readBody, sendJson, sendError } from './http'

function fakeReq() {
  const req = new EventEmitter()
  return Object.assign(req, { destroy: vi.fn(() => req.emit('aborted')) })
}

describe('readBody', () => {
  it('中文和 emoji 跨字节分片时保持完整 UTF-8 文本', async () => {
    const req = fakeReq()
    const text = JSON.stringify({ path: '/Users/音乐/歌单😀' })
    const body = readBody(req as unknown as IncomingMessage)

    for (const byte of Buffer.from(text)) req.emit('data', Buffer.from([byte]))
    req.emit('end')

    expect(await body).toBe(text)
  })

  it('无请求体时返回空字符串', async () => {
    const req = fakeReq()
    const body = readBody(req as unknown as IncomingMessage)
    req.emit('end')
    expect(await body).toBe('')
  })

  it('接受恰好 2 MB 的请求体', async () => {
    const req = fakeReq()
    const body = readBody(req as unknown as IncomingMessage)
    req.emit('data', Buffer.alloc(MAX_BODY_BYTES, 'a'))
    req.emit('end')
    expect((await body).length).toBe(MAX_BODY_BYTES)
    expect(req.destroy).not.toHaveBeenCalled()
  })

  it('按 UTF-8 字节数限制请求体，超限时仍报告 BODY_TOO_LARGE', async () => {
    const req = fakeReq()
    const body = readBody(req as unknown as IncomingMessage)
    const rejected = expect(body).rejects.toThrow('BODY_TOO_LARGE')
    req.emit('data', Buffer.from('中'.repeat(Math.ceil(MAX_BODY_BYTES / 3))))
    await rejected
    expect(req.destroy).toHaveBeenCalledOnce()
  })

  it('客户端中止后拒绝读取，随后结束事件不返回不完整数据', async () => {
    const req = fakeReq()
    const body = readBody(req as unknown as IncomingMessage)
    const rejected = expect(body).rejects.toThrow('REQUEST_ABORTED')
    req.emit('data', Buffer.from('{"path":"音乐'))
    req.emit('aborted')
    req.emit('end')
    await rejected
  })

  it('读取错误传递原始原因', async () => {
    const req = fakeReq()
    const body = readBody(req as unknown as IncomingMessage)
    const error = new Error('connection reset')
    const rejected = expect(body).rejects.toBe(error)
    req.emit('error', error)
    await rejected
  })

  it('开始读取前已中止的请求立即拒绝', async () => {
    const req = Object.assign(fakeReq(), { aborted: true })
    await expect(readBody(req as unknown as IncomingMessage)).rejects.toThrow('REQUEST_ABORTED')
    expect(() => req.emit('error', new Error('aborted'))).not.toThrow()
  })
})

function fakeRes() {
  const chunks: Buffer[] = []
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writeHead(s: number, h: Record<string, string>) {
      this.statusCode = s
      this.headers = h
    },
    end(b: Buffer) {
      chunks.push(b)
    },
    get body() {
      return Buffer.concat(chunks).toString()
    }
  }
}

describe('sendJson', () => {
  it('writes json with 200 by default', () => {
    const res = fakeRes()
    sendJson(res as never, { a: 1 })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toContain('application/json')
    expect(JSON.parse(res.body)).toEqual({ a: 1 })
  })

  it('honours custom status', () => {
    const res = fakeRes()
    sendJson(res as never, { a: 1 }, 201)
    expect(res.statusCode).toBe(201)
  })
})

describe('sendError', () => {
  it('writes ok:false with status', () => {
    const res = fakeRes()
    sendError(res as never, 500, 'boom')
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'boom' })
  })
})
