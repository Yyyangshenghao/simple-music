import type { ProviderId } from '../providers/types'

export type ProviderErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_CHANGED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RESTRICTED'
  | 'NOT_FOUND'
  | 'UNKNOWN'

export interface ProviderError {
  source: ProviderId
  code: ProviderErrorCode
  message: string
  retryable: boolean
  cause?: string
}

export interface ProviderResult<T> {
  source: ProviderId
  status: 'loading' | 'ready' | 'empty' | 'error'
  data: T | null
  error?: ProviderError
}

interface RunProviderTasksOptions<T> {
  signal?: AbortSignal
  isEnabled?: (source: ProviderId) => boolean
  isEmpty?: (data: T) => boolean
  onUpdate?: (result: ProviderResult<T>) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizedCause(message: string): string {
  return message
    .replace(/\b(cookie|token|credential|authorization)\s*[:=]\s*([^\s&]+)/gi, '$1=[redacted]')
    .replace(/\bbearer\s+[^\s&]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/gi, '[url redacted]')
}

export function providerErrorOf(source: ProviderId, error: unknown): ProviderError {
  const rawCause = messageOf(error)
  const cause = sanitizedCause(rawCause)
  const upper = rawCause.toUpperCase()
  if (upper.includes('401') || upper.includes('AUTH_REQUIRED')) {
    return { source, code: 'AUTH_REQUIRED', message: '需要登录后使用', retryable: false, cause }
  }
  if (upper.includes('403') || upper.includes('AUTH_EXPIRED')) {
    return { source, code: 'AUTH_EXPIRED', message: '登录已失效', retryable: false, cause }
  }
  if (upper.includes('429') || upper.includes('RATE_LIMIT')) {
    return { source, code: 'RATE_LIMITED', message: '请求过于频繁', retryable: true, cause }
  }
  if (upper.includes('TIMEOUT')) {
    return { source, code: 'TIMEOUT', message: '请求超时', retryable: true, cause }
  }
  if (upper.includes('NETWORK') || upper.includes('FETCH')) {
    return { source, code: 'NETWORK', message: '网络连接失败', retryable: true, cause }
  }
  if (upper.includes('NOT_FOUND') || upper.includes('404')) {
    return { source, code: 'NOT_FOUND', message: '内容不存在', retryable: false, cause }
  }
  if (upper.includes('RESTRICTED')) {
    return { source, code: 'RESTRICTED', message: '内容暂不可用', retryable: false, cause }
  }
  return { source, code: 'UNKNOWN', message: '平台请求失败', retryable: true, cause }
}

/**
 * 并发运行多个 provider 任务。每个平台独立落地结果；中途取消或被禁用的平台会丢弃迟到响应。
 * 返回值始终按输入 provider 顺序排列，避免请求完成顺序改变 UI。
 */
export async function runProviderTasks<T>(
  sources: readonly ProviderId[],
  task: (source: ProviderId) => Promise<T>,
  options: RunProviderTasksOptions<T> = {}
): Promise<ProviderResult<T>[]> {
  const isEnabled = options.isEnabled ?? (() => true)
  const activeSources = sources.filter(isEnabled)
  const terminal = new Map<ProviderId, ProviderResult<T>>()

  for (const source of activeSources) {
    options.onUpdate?.({ source, status: 'loading', data: null })
  }

  await Promise.all(activeSources.map(async (source) => {
    try {
      const data = await task(source)
      if (options.signal?.aborted || !isEnabled(source)) return
      const result: ProviderResult<T> = {
        source,
        status: options.isEmpty?.(data) ? 'empty' : 'ready',
        data,
      }
      terminal.set(source, result)
      options.onUpdate?.(result)
    } catch (error) {
      if (options.signal?.aborted || !isEnabled(source)) return
      const result: ProviderResult<T> = {
        source,
        status: 'error',
        data: null,
        error: providerErrorOf(source, error),
      }
      terminal.set(source, result)
      options.onUpdate?.(result)
    }
  }))

  return activeSources.flatMap((source) => {
    const result = terminal.get(source)
    return result ? [result] : []
  })
}
