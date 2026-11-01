import type { RouteHandler, ServerContext } from '../types'
import { readJson, sendError, sendJson } from '../lib/http'
import { ProxyConfigError, readProxySettings, validateProxySettings, writeProxySettings, type ProxySettings } from '../lib/proxy-config'
import { applyUpstreamProxy, dispatcherForTarget } from '../lib/upstream-proxy'

/** 固定小文件往返：国内、海外都能连到，且不依赖任何平台 SDK。 */
const PROXY_TEST_URL = 'https://www.apple.com/library/test/success.html'
const PROXY_TEST_TIMEOUT_MS = 8000

export interface ProxyTestResult {
  ok: boolean
  status?: number
  elapsedMs: number
  error?: string
}

/** 落盘 + 生效：Node 侧 dispatcher 与 Electron 各会话一起切，避免「登录能开、数据走直连」。 */
export function applyProxySettings(ctx: ServerContext, settings: ProxySettings): ProxySettings {
  writeProxySettings(ctx.userDataDir, settings)
  applyUpstreamProxy(settings)
  ctx.applySessionProxy?.(settings)
  return settings
}

function proxyFailure(error: unknown): string {
  const code = (error as { cause?: { code?: string } })?.cause?.code
  if (code === 'ECONNREFUSED') return '代理端口没有响应，请确认代理软件正在运行'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '代理地址无法解析'
  if (code === 'ETIMEDOUT' || (error as Error)?.name === 'TimeoutError') return '通过代理连接超时'
  if ((error as Error)?.name === 'AbortError') return '测试已取消'
  return '通过代理连接失败'
}

async function testProxy(settings: ProxySettings, target: 'default' | 'apple'): Promise<ProxyTestResult> {
  const startedAt = Date.now()
  try {
    const response = await fetch(PROXY_TEST_URL, {
      dispatcher: dispatcherForTarget(settings, target),
      signal: AbortSignal.timeout(PROXY_TEST_TIMEOUT_MS),
    } as unknown as RequestInit)
    return { ok: response.ok, status: response.status, elapsedMs: Date.now() - startedAt }
  } catch (error) {
    return { ok: false, elapsedMs: Date.now() - startedAt, error: proxyFailure(error) }
  }
}

export const networkRoutes: RouteHandler = async (req, res, url, ctx) => {
  if (!url.pathname.startsWith('/api/network/')) return false
  try {
    if (url.pathname === '/api/network/proxy') {
      if (req.method === 'GET') {
        sendJson(res, readProxySettings(ctx.userDataDir))
        return true
      }
      if (req.method === 'POST') {
        sendJson(res, applyProxySettings(ctx, validateProxySettings(await readJson(req))))
        return true
      }
      return false
    }
    if (url.pathname === '/api/network/proxy/test' && req.method === 'POST') {
      const body = await readJson<{ settings?: unknown; target?: unknown }>(req)
      const settings = validateProxySettings(body?.settings)
      sendJson(res, await testProxy(settings, body?.target === 'apple' ? 'apple' : 'default'))
      return true
    }
    return false
  } catch (error) {
    sendError(res, error instanceof ProxyConfigError ? 400 : 500, error instanceof Error ? error.message : '代理设置操作失败')
    return true
  }
}
