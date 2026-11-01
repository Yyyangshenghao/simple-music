import type { RouteHandler, ServerContext } from '../types'
import { readJson, sendError, sendJson } from '../lib/http'
import { ProxyConfigError, readProxySettings, stripProxyCredentials, validateProxySettings, writeProxySettings, type ProxySettings, type SystemProxyAddresses } from '../lib/proxy-config'
import { diagnoseProxy } from '../lib/proxy-diagnostics'
import { detectProxyCandidates } from '../lib/proxy-detect'
import { applyUpstreamProxy, setSystemProxyAddresses, systemProxyAddresses } from '../lib/upstream-proxy'

/** 落盘 + 生效：Node 侧 dispatcher 与 Electron 各会话一起切，避免「登录能开、数据走直连」。 */
export async function applyProxySettings(ctx: ServerContext, settings: ProxySettings): Promise<ProxySettings> {
  writeProxySettings(ctx.userDataDir, settings)
  applyUpstreamProxy(settings)
  try {
    await ctx.applySessionProxy?.(settings)
  } catch {
    // 设置已落盘且数据请求已切换，只是窗口侧没跟上；说清楚影响和恢复办法。
    throw new Error('已保存，但登录窗口未能应用新代理，请重启应用后生效')
  }
  return settings
}

/** 现取系统代理：用户可能刚在代理软件里开关了系统代理；没有宿主时沿用环境变量。 */
async function freshSystemProxy(ctx: ServerContext): Promise<SystemProxyAddresses> {
  if (!ctx.resolveSystemProxy) return systemProxyAddresses()
  try {
    const addresses = await ctx.resolveSystemProxy()
    setSystemProxyAddresses(addresses)
    return addresses
  } catch {
    return systemProxyAddresses()
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
        sendJson(res, await applyProxySettings(ctx, validateProxySettings(await readJson(req))))
        return true
      }
      return false
    }
    if (url.pathname === '/api/network/proxy/system' && req.method === 'GET') {
      const system = await freshSystemProxy(ctx)
      sendJson(res, { address: stripProxyCredentials(system.default), apple: stripProxyCredentials(system.apple) })
      return true
    }
    if (url.pathname === '/api/network/proxy/diagnose' && req.method === 'POST') {
      const body = await readJson<{ settings?: unknown }>(req)
      const settings = validateProxySettings(body?.settings)
      sendJson(res, await diagnoseProxy(settings, ctx.userDataDir, await freshSystemProxy(ctx)))
      return true
    }
    if (url.pathname === '/api/network/proxy/detect' && req.method === 'POST') {
      const system = await freshSystemProxy(ctx)
      sendJson(res, { candidates: await detectProxyCandidates(system.default || system.apple) })
      return true
    }
    return false
  } catch (error) {
    sendError(res, error instanceof ProxyConfigError ? 400 : 500, error instanceof Error ? error.message : '代理设置操作失败')
    return true
  }
}
