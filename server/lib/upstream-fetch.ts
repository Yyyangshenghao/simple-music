import type { ServerResponse } from 'node:http'
import { isSafeUpstreamUrl } from './security'

/** 代理请求逐跳校验地址，避免 fetch 自动重定向绕过内网限制。 */
export async function fetchSafeUpstream(url: string, options: Pick<RequestInit, 'headers' | 'signal'> = {}): Promise<Response> {
  let target = url
  for (let redirects = 0; ; redirects++) {
    options.signal?.throwIfAborted()
    if (!isSafeUpstreamUrl(target)) throw new Error('Invalid upstream url')
    const response = await fetch(target, { ...options, redirect: 'manual' })
    if (options.signal?.aborted) {
      await response.body?.cancel().catch(() => {})
      options.signal.throwIfAborted()
    }
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response
    await response.body?.cancel().catch(() => {})
    if (redirects >= 5) throw new Error('Too many upstream redirects')
    target = new URL(location, target).href
  }
}

/** 在等待响应头之前监听断开；调用方结束后必须移除监听。 */
export function abortOnResponseClose(res: ServerResponse): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const onClose = () => controller.abort()
  res.once('close', onClose)
  if (res.destroyed) onClose()
  return { signal: controller.signal, cleanup: () => res.off('close', onClose) }
}
