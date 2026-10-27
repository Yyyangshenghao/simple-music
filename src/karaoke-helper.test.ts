import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ separate: vi.fn() }))
vi.mock('./lib/karaoke/separator', () => ({ createKaraokeSeparator: () => ({ separate: h.separate }) }))
afterEach(() => vi.unstubAllGlobals())

describe('分离页面错误回报', () => {
  it('限制原生引擎错误长度，避免超出主进程契约后任务一直等待', async () => {
    vi.resetModules()
    let command!: (value: unknown) => void
    const emit = vi.fn()
    vi.stubGlobal('window', { karaokeHelper: { onCommand: (callback: typeof command) => { command = callback }, emit, ready: vi.fn() } })
    h.separate.mockRejectedValueOnce(new Error('x'.repeat(5000)))
    await import('./karaoke-helper')
    command({ type: 'separate', id: 'a', model: 'hq3', key: 'local:1', src: 'x' })
    await vi.waitFor(() => expect(emit).toHaveBeenCalled())
    expect(emit.mock.calls[0][0]).toMatchObject({ type: 'error', id: 'a', message: 'x'.repeat(2048) })
  })
})
