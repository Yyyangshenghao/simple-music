// API 客户端：从主进程注入的端口（window.desktop.serverPort）拼接 /api/* 请求。
// 浏览器/非 Electron 环境回退到同源（便于纯前端调试）。

export function apiBase(): string {
  const port = typeof window !== 'undefined' ? window.desktop?.serverPort : undefined
  return port ? `http://127.0.0.1:${port}` : ''
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
  // 同源回退时只保留 path + search，避免写死 host。
  return base ? url.toString() : `${url.pathname}${url.search}`
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
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
  get<T>(path: string, params?: QueryParams): Promise<T> {
    return request<T>(buildUrl(path, params))
  },
  post<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return request<T>(buildUrl(path, params), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }
}
