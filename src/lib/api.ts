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

export const api = {
  base: apiBase,
  url: buildUrl,
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
