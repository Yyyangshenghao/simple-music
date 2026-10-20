/*!
 * @license MIT
 * zzc / ag-1 protocol adapted from jixunmoe/qmweb-sign:
 * https://github.com/jixunmoe/qmweb-sign/tree/15305a3cc39f80eb1646ab2bae46468231765736
 * Copyright (c) 2024 Jixun Wu
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { QQ_HEADERS } from './qq-client'

const REQUEST_KEY = Buffer.from([189, 48, 95, 16, 208, 255, 116, 182, 239, 84, 218, 184, 53, 181, 225, 207])
const RESPONSE_KEY = [122, 63, 140, 29, 94, 155, 47, 10, 108, 77, 126, 139, 31, 58, 92, 157, 14, 43, 111, 74, 129]
const SCRAMBLE = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

export function qqWebSign(body: string): string {
  const hash = createHash('sha1').update(body).digest('hex').toUpperCase()
  const pick = (indexes: number[]) => indexes.map(index => hash[index]).join('')
  const middle = Buffer.from(SCRAMBLE.map((value, index) => value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16)))
    .toString('base64').replace(/[\\/+=]/g, '')
  return `zzc${pick([23, 14, 6, 36, 16, 7, 19])}${middle}${pick([16, 1, 32, 12, 19, 27, 8, 5])}`.toLowerCase()
}

/** 官网写请求：签名与加密使用同一份JSON，不回退明文或自动重试写入。 */
export async function qqWebMusicRequest(cookie: string, payload: unknown): Promise<unknown> {
  const body = JSON.stringify(payload)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-128-gcm', REQUEST_KEY, iv)
  const encrypted = Buffer.concat([iv, cipher.update(body, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64')
  const url = new URL('https://u6.y.qq.com/cgi-bin/musics.fcg')
  url.searchParams.set('_', String(Date.now()))
  url.searchParams.set('encoding', 'ag-1')
  url.searchParams.set('sign', qqWebSign(body))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { ...QQ_HEADERS, Cookie: cookie, 'Content-Type': 'text/plain', Accept: 'application/octet-stream' }, body: encrypted })
    if (!response.ok) throw new Error(`QQ 音乐请求失败（HTTP ${response.status}）`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    try {
      // 与官网协议实现一致：文字字段可能含非法UTF-8字节，JSON结构/业务码仍必须有效。
      const decoded = new TextDecoder().decode(bytes.map((value, index) => value ^ RESPONSE_KEY[index % RESPONSE_KEY.length]))
      return JSON.parse(decoded)
    } catch {
      throw new Error('QQ 音乐响应无法解析，请稍后重试')
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('QQ 音乐请求超时，请稍后确认收藏状态')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
