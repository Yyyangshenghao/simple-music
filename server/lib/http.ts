import type { IncomingMessage, ServerResponse } from 'node:http'

/** 请求体上限:本地 API 的 POST 都是小 JSON,给 2MB 已经绰绰有余。 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** 读取请求体。累加前先卡上限,避免超大 body 把整个 body 攒在内存里撑爆进程。 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('BODY_TOO_LARGE'))
        return
      }
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
