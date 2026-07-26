// API 客户端：从主进程注入的端口（window.desktop.serverPort）拼接 /api/* 请求。
// 浏览器/非 Electron 环境回退到同源（便于纯前端调试）。

export function apiBase(): string {
  const port = typeof window !== 'undefined' ? window.desktop?.serverPort : undefined
  return port ? `http://127.0.0.1:${port}` : ''
}

/** 主进程随端口注入的一次性访问 token；未注入(纯前端/独立 server)时为空，server 侧对应放行。 */
function apiToken(): string | undefined {
  return typeof window !== 'undefined' ? window.desktop?.serverToken : undefined
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>

function buildUrl(path: string, params?: QueryParams): string {
  const base = apiBase()
  const url = new URL(path, base || 'http://127.0.0.1')
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  // token 走 query：<audio src>/<img src> 直连只能这样带；fetch/get/post 复用同一构造。
  // 本地音乐的 url/cover 也经此拼出，token 一并落到 query，不影响 isLocalApiUrl 的 startsWith 判定。
  const token = apiToken()
  if (token) url.searchParams.set('token', token)
  // 同源回退时只保留 path + search，避免写死 host。
  return base ? url.toString() : `${url.pathname}${url.search}`
}

/**
 * 全局兜底超时(ms)。上游平台偶有"不报错也不返回"的连接停滞(Windows 代理软件/IPv6 环境尤甚),
 * 整条链路原本无任何超时,一次停滞就能把漫游生成这类多步流程永远卡在"生成中…"。
 * 已知合法的慢端点(音质探测串行多档、清大缓存)由调用方传 timeoutMs 单独放宽,
 * 默认值不为它们妥协;业务侧若要更早放弃,传自己的 signal 接管(中止按原始错误抛,不误报成超时)。
 */
const DEFAULT_TIMEOUT_MS = 30_000

async function request<T>(input: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init ?? {}
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const callerSignal = init?.signal
  const onCallerAbort = () => controller.abort()
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  try {
    const res = await fetch(input, { ...fetchInit, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    if (timedOut) throw new Error('REQUEST_TIMEOUT')
    throw err
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * 该 URL 是否已经指向本地 API server 自身(如本地音乐的 /api/local/audio、/api/local/cover)。
 *
 * 这类地址**不能**再套 `/api/audio`、`/proxy/cover` 之类的代理端点:既多一跳,
 * 又会被 server 的 SSRF 防护当成"代理去请求回环地址"直接 400 掉。
 */
export function isLocalApiUrl(url: string): boolean {
  const base = apiBase()
  return !!base && url.startsWith(base)
}

/**
 * 取封面图 URL,供需要 canvas 采样(取色/粒子/舞台歌词)的场景使用。
 *
 * 上游平台的封面不带 CORS 头,直接画进 canvas 会污染画布,所以要过 `/proxy/cover`;
 * 本地音乐的封面本身就是我们自己的 `/api/local/cover`(已带 `ACAO: *`),原样返回。
 */
export function coverImageUrl(cover: string): string {
  if (isLocalApiUrl(cover)) return cover
  return buildUrl('/proxy/cover', { url: cover })
}

export const api = {
  base: apiBase,
  url: buildUrl,
  coverImage: coverImageUrl,
  get<T>(path: string, params?: QueryParams, init?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
    return request<T>(buildUrl(path, params), init)
  },
  post<T>(path: string, body?: unknown, params?: QueryParams, init?: { timeoutMs?: number }): Promise<T> {
    return request<T>(buildUrl(path, params), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init
    })
  }
}
