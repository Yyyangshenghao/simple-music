import { describe, it, expect } from 'vitest'
import { sendJson, sendError } from './http'

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
