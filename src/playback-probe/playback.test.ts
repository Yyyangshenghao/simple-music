import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProbePlayback } from './playback'
import type { AudioEngineCallbacks } from '../lib/audio-engine'

function setup() {
  let callbacks!: AudioEngineCallbacks
  let hasSource = false
  let loadId = 0
  const engine = {
    get hasSource() { return hasSource },
    load: vi.fn(() => { hasSource = true; return ++loadId }),
    play: vi.fn(async () => { callbacks.onStatus?.('playing') }),
    pause: vi.fn(), clearSource: vi.fn(() => { hasSource = false }), seek: vi.fn(),
    setVolume: vi.fn(), setPlaybackRate: vi.fn(), destroy: vi.fn(),
  }
  const publish = vi.fn()
  const createEngine = vi.fn((cbs: AudioEngineCallbacks) => { callbacks = cbs; return engine })
  const core = createProbePlayback('session', createEngine, publish)
  core.replace([{ id: 'a', label: 'A', kind: 'local', url: '/local?token=secret' }, { id: 'b', label: 'B', kind: 'proxy', url: 'https://audio.test/secret' }])
  return { core, engine, publish, createEngine, get callbacks() { return callbacks } }
}
afterEach(() => vi.useRealTimers())

describe('独立音频宿主验证器', () => {
  it('只有一个引擎，重连取快照不重载或重排；快照不携带音频 URL', () => {
    const h = setup()
    h.core.command({ type: 'play' })
    const state = h.core.snapshot()
    expect(state.current).toEqual({ id: 'a', label: 'A', kind: 'local' })
    expect(JSON.stringify(state)).not.toContain('secret')
    expect(h.core.snapshot()).toEqual(state)
    expect(h.createEngine).toHaveBeenCalledOnce()
    expect(h.engine.load).toHaveBeenCalledOnce()
    expect(state.loadCount).toBe(1)
  })
  it('暂停和 seek 胜过迟到的播放 Promise，恢复不重新加载', async () => {
    const h = setup()
    let fail!: (reason: Error) => void
    h.engine.play.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    h.core.command({ type: 'play' })
    h.core.command({ type: 'pause' })
    h.core.command({ type: 'seek', value: 12 })
    fail(new Error('old play'))
    await Promise.resolve()
    expect(h.core.snapshot()).toMatchObject({ status: 'paused', position: 12, error: '' })
    h.core.command({ type: 'play' })
    expect(h.engine.load).toHaveBeenCalledOnce()
    expect(h.engine.seek).toHaveBeenCalledWith(12)
  })
  it('自然结束无需 UI 即推进下一首，到列表末尾暂停', () => {
    const h = setup()
    h.core.command({ type: 'play' })
    h.callbacks.onEnded?.()
    expect(h.core.snapshot()).toMatchObject({ queueIndex: 1, current: { id: 'b' }, endedCount: 1, loadCount: 2 })
    h.callbacks.onDuration?.(30)
    h.callbacks.onEnded?.()
    expect(h.core.snapshot()).toMatchObject({ status: 'paused', position: 30, endedCount: 2, loadCount: 2 })
  })
  it('停止或换曲后的旧媒体错误与暂停后的 waiting 不覆盖新状态', () => {
    const h = setup()
    h.core.command({ type: 'play' })
    h.core.command({ type: 'next' })
    h.callbacks.onError?.('MEDIA_ERR_4', 1)
    expect(h.core.snapshot()).toMatchObject({ current: { id: 'b' }, error: '' })
    h.core.command({ type: 'pause' })
    h.callbacks.onStatus?.('loading')
    expect(h.core.snapshot().status).toBe('paused')
    h.core.command({ type: 'stop' })
    h.callbacks.onError?.('MEDIA_ERR_4', 2)
    expect(h.core.snapshot()).toMatchObject({ status: 'idle', error: '' })
  })
  it('定时停止无需 UI，取消和释放后不会再触发；释放后迟到事件无效', () => {
    vi.useFakeTimers()
    const h = setup()
    h.core.command({ type: 'play' })
    h.core.command({ type: 'sleep', value: 5 })
    vi.advanceTimersByTime(5000)
    expect(h.core.snapshot()).toMatchObject({ status: 'idle', sleepAt: null })
    h.core.command({ type: 'sleep', value: 5 })
    h.core.command({ type: 'sleep', value: 0 })
    const stops = h.engine.clearSource.mock.calls.length
    vi.advanceTimersByTime(5000)
    expect(h.engine.clearSource).toHaveBeenCalledTimes(stops)
    h.core.command({ type: 'sleep', value: 5 })
    h.core.dispose()
    const previous = h.core.snapshot()
    h.callbacks.onEnded?.()
    h.callbacks.onPosition?.(100)
    h.callbacks.onOutputDeviceChange?.(true)
    h.core.command({ type: 'play' })
    h.core.replace([])
    h.core.dispose()
    vi.advanceTimersByTime(5000)
    expect(h.core.snapshot()).toEqual(previous)
    expect(h.engine.destroy).toHaveBeenCalledOnce()
    expect(h.engine.clearSource).toHaveBeenCalledTimes(stops)
  })
  it('空列表控制安全，音量和倍速交给现有引擎，设备变更只记录', () => {
    const h = setup()
    h.core.replace([])
    h.core.command({ type: 'next' }); h.core.command({ type: 'previous' }); h.core.command({ type: 'play' })
    expect(h.engine.load).not.toHaveBeenCalled()
    h.core.command({ type: 'volume', value: 0.3 }); h.core.command({ type: 'rate', value: 1.5 })
    expect(h.engine.setVolume).toHaveBeenLastCalledWith(0.3)
    expect(h.engine.setPlaybackRate).toHaveBeenCalledWith(1.5)
    h.callbacks.onOutputDeviceChange?.(false)
    expect(h.core.snapshot()).toMatchObject({ volume: 0.3, rate: 1.5, deviceChanges: 1 })
  })
})
