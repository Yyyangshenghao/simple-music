import { describe, expect, it, vi } from 'vitest'
import { providerErrorOf, runProviderTasks } from './content-hub'

describe('content hub', () => {
  it('保留部分成功并按 provider 输入顺序返回', async () => {
    const updates: string[] = []
    const results = await runProviderTasks(
      ['netease', 'qq'],
      async (source) => {
        if (source === 'netease') return ['song']
        throw new Error('REQUEST_TIMEOUT')
      },
      {
        isEmpty: (items) => items.length === 0,
        onUpdate: (result) => updates.push(`${result.source}:${result.status}`),
      }
    )

    expect(results.map((result) => `${result.source}:${result.status}`)).toEqual([
      'netease:ready',
      'qq:error',
    ])
    expect(updates).toEqual([
      'netease:loading',
      'qq:loading',
      'netease:ready',
      'qq:error',
    ])
    expect(results[1].error?.code).toBe('TIMEOUT')
  })

  it('取消后丢弃所有迟到响应', async () => {
    let resolveTask!: (value: string[]) => void
    const task = new Promise<string[]>((resolve) => { resolveTask = resolve })
    const controller = new AbortController()
    const onUpdate = vi.fn()
    const running = runProviderTasks(['netease'], () => task, {
      signal: controller.signal,
      onUpdate,
    })

    controller.abort()
    resolveTask(['late'])

    await expect(running).resolves.toEqual([])
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith({ source: 'netease', status: 'loading', data: null })
  })

  it('运行期间被禁用的 provider 不再落地', async () => {
    let enabled = true
    let resolveTask!: (value: string[]) => void
    const task = new Promise<string[]>((resolve) => { resolveTask = resolve })
    const onUpdate = vi.fn()
    const running = runProviderTasks(['qq'], () => task, {
      isEnabled: () => enabled,
      onUpdate,
    })

    enabled = false
    resolveTask(['late'])

    await expect(running).resolves.toEqual([])
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('归一常见错误且不泄露原始原因到用户文案', () => {
    const error = providerErrorOf('qq', new Error('HTTP 401 cookie=secret Authorization: BearerToken https://secret.test/a'))
    expect(error).toMatchObject({ source: 'qq', code: 'AUTH_REQUIRED', retryable: false })
    expect(error.message).not.toContain('secret')
    expect(error.cause).toContain('[redacted]')
    expect(error.cause).not.toContain('secret')
    expect(error.cause).not.toContain('BearerToken')
    expect(error.cause).not.toContain('secret.test')
  })
})
