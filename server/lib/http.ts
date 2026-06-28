import type { IncomingMessage, ServerResponse } from 'node:http'

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req)
  return body ? (JSON.parse(body) as T) : ({} as T)
}

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const buf = Buffer.from(JSON.stringify(data))
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(buf)
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, { ok: false, error: message }, status)
}
