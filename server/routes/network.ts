import type { RouteHandler, ServerContext } from '../types'
import { readJson, sendError, sendJson } from '../lib/http'
import { ProxyConfigError, readProxySettings, stripProxyCredentials, validateProxySettings, writeProxySettings, type ProxySettings } from '../lib/proxy-config'
import { diagnoseProxy } from '../lib/proxy-diagnostics'
import { detectProxyCandidates } from '../lib/proxy-detect'
import { applyUpstreamProxy, setSystemProxyAddress, systemProxyAddress } from '../lib/upstream-proxy'

/** 落盘 + 生效：Node 侧 dispatcher 与 Electron 各会话一起切，避免「登录能开、数据走直连」。 */
export function applyProxySettings(ctx: ServerContext, settings: ProxySettings): ProxySettings {
  writeProxySettings(ctx.userDataDir, settings)
  applyUpstreamProxy(settings)
  ctx.applySessionProxy?.(settings)
  return settings
}

/** 现取系统代理：用户可能刚在代理软件里开关了系统代理；没有宿主时沿用环境变量。 */
async function freshSystemProxy(ctx: ServerContext): Promise<string> {
  if (!ctx.resolveSystemProxy) return systemProxyAddress()
  try {
    const address = await ctx.resolveSystemProxy()
    setSystemProxyAddress(address)
    return address
  } catch {
    return systemProxyAddress()
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
    if (url.pathname === '/api/network/proxy/system' && req.method === 'GET') {
      sendJson(res, { address: stripProxyCredentials(await freshSystemProxy(ctx)) })
      return true
    }
    if (url.pathname === '/api/network/proxy/diagnose' && req.method === 'POST') {
      const body = await readJson<{ settings?: unknown }>(req)
      const settings = validateProxySettings(body?.settings)
      sendJson(res, await diagnoseProxy(settings, ctx.userDataDir, await freshSystemProxy(ctx)))
      return true
    }
    if (url.pathname === '/api/network/proxy/detect' && req.method === 'POST') {
      sendJson(res, { candidates: await detectProxyCandidates(await freshSystemProxy(ctx)) })
      return true
    }
    return false
  } catch (error) {
    sendError(res, error instanceof ProxyConfigError ? 400 : 500, error instanceof Error ? error.message : '代理设置操作失败')
    return true
  }
}
