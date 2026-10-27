import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './audio-engine'

class Media extends EventTarget {
  static instances: Media[] = []
  src = ''
  crossOrigin = ''
  preload = ''
  paused = true
  ended = false
  seeking = false
  readyState = 0
  currentTime = 0
  duration = 180
  volume = 1
  defaultPlaybackRate = 1
  playbackRate = 1
  error = null
  load = vi.fn()
  play = vi.fn(async () => { this.paused = false; this.emit('playing') })
  pause = vi.fn(() => { this.paused = true; this.emit('pause') })
  constructor() { super(); Media.instances.push(this) }
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  emit(name: string) { this.dispatchEvent(new Event(name)) }
  ready() { this.readyState = 4; this.emit('canplay'); this.emit('seeked') }
}

const gains: Array<ReturnType<typeof gainNode>> = []
function gainNode() {
  return { connect: vi.fn(), disconnect: vi.fn(), gain: {
    value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
  } }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
let engine: AudioEngine
beforeEach(() => {
  vi.useFakeTimers()
  gains.length = 0
  Media.instances = []
  vi.stubGlobal('Audio', Media)
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('window', { AudioContext: class {
    state = 'running'
    currentTime = 10
    destination = {}
    createMediaElementSource() { return { connect: vi.fn(), disconnect: vi.fn() } }
    createAnalyser() { return { frequencyBinCount: 1, connect: vi.fn(), disconnect: vi.fn() } }
    createGain() { const node = gainNode(); gains.push(node); return node }
    close = vi.fn()
  } })
})
afterEach(() => { engine?.destroy(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function playing() {
  const onCanPlay = vi.fn(), onStatus = vi.fn(), onError = vi.fn()
  engine = new AudioEngine({ onCanPlay, onStatus, onError })
  engine.load('/original')
  const original = Media.instances[0]
  original.readyState = 4
  original.currentTime = 42.738
  await engine.play()
  onStatus.mockClear()
  original.pause.mockClear()
  return { original, onCanPlay, onStatus, onError }
}

describe('原唱伴奏连续交接', () => {
  it('准备期间保持原轨出声；使用实时小数位置并按互补增益交接，不经过 loading', async () => {
    const { original, onCanPlay, onStatus } = await playing()
    engine.prepareAlternate('/stem')
    const incoming = Media.instances[1]
    const id = engine.load('/stem', 42, undefined, undefined, false, true)
    await flush()
    expect(original.pause).not.toHaveBeenCalled()
    expect(onCanPlay).not.toHaveBeenCalled()
    original.currentTime = 43.126
    incoming.ready()
    await flush()
    expect(incoming.currentTime).toBe(43.126)
    expect(engine.position).toBe(43.126)
    expect(onCanPlay).toHaveBeenCalledWith(id)
    expect(onStatus).not.toHaveBeenCalledWith('loading')
    expect(gains[1].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10.08)
    expect(gains[2].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 10.08)
    expect(original.pause).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(80)
    expect(original.paused).toBe(true)
    expect(incoming.paused).toBe(false)
    engine.load('/original', 0, undefined, undefined, false, true)
    await flush()
    original.emit('seeked')
    await flush()
    expect(Media.instances).toHaveLength(2)
    expect(engine.position).toBe(incoming.currentTime)
    expect(original.load).toHaveBeenCalledOnce()
  })

  it('目标轨异步起播期间的时间偏差必须重新校正，不能直接交接', async () => {
    const { original, onCanPlay } = await playing()
    engine.load('/stem', 42, undefined, undefined, false, true)
    const incoming = Media.instances[1]
    let finish!: () => void
    incoming.play.mockImplementationOnce(() => new Promise<void>(resolve => {
      finish = () => { incoming.paused = false; original.currentTime += 0.057; resolve() }
    }))
    incoming.ready()
    await flush()
    finish()
    await flush()
    expect(onCanPlay).not.toHaveBeenCalled()
    expect(original.pause).not.toHaveBeenCalled()
    expect(incoming.currentTime).toBe(original.currentTime)
    incoming.emit('seeked')
    await flush()
    expect(onCanPlay).toHaveBeenCalledOnce()
  })

  it('目标轨必须先静音运行，较慢的 seek 不会因追赶移动中的原轨而饿死', async () => {
    const { original, onCanPlay } = await playing()
    engine.load('/stem', 42, undefined, undefined, false, true)
    const incoming = Media.instances[1]
    let clock = 0
    Object.defineProperty(incoming, 'currentTime', {
      get: () => clock,
      set: value => {
        clock = value
        incoming.seeking = true
        setTimeout(() => {
          original.currentTime += 0.03
          if (!incoming.paused) clock += 0.03
          incoming.seeking = false
          incoming.emit('seeked')
        }, 30)
      },
    })
    incoming.ready()
    await flush()
    expect(incoming.play).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30)
    expect(onCanPlay).toHaveBeenCalledOnce()
  })

  it('淡变中反向切换先完成当前包络，不截断旧轨或突然拉满增益', async () => {
    const { original, onCanPlay } = await playing()
    engine.load('/stem', 42, undefined, undefined, false, true)
    const incoming = Media.instances[1]
    incoming.ready()
    await flush()
    await vi.advanceTimersByTimeAsync(20)
    const gainWrites = gains[2].gain.setValueAtTime.mock.calls.length
    engine.load('/original', 42, undefined, undefined, false, true)
    expect(original.pause).not.toHaveBeenCalled()
    expect(gains[2].gain.setValueAtTime).toHaveBeenCalledTimes(gainWrites)
    await vi.advanceTimersByTimeAsync(80)
    expect(onCanPlay).toHaveBeenCalledTimes(2)
    expect(Media.instances).toHaveLength(2)
    expect(incoming.paused).toBe(false)
    await vi.advanceTimersByTimeAsync(80)
    expect(incoming.paused).toBe(true)
    expect(original.paused).toBe(false)
  })

  it('自然结束后切换保留暂停，不因过期的播放意图重新出声', async () => {
    const { original, onStatus } = await playing()
    original.ended = true
    original.paused = true
    original.emit('ended')
    engine.load('/stem', 42, undefined, undefined, false, true)
    const incoming = Media.instances[1]
    incoming.ready()
    await flush()
    expect(incoming.play).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith('paused')
  })

  it('交接淡变中拖动进度会同步旧尾轨，避免混入原位置声音', async () => {
    const { original } = await playing()
    engine.load('/stem', 42, undefined, undefined, false, true)
    const incoming = Media.instances[1]
    incoming.ready()
    await flush()
    engine.seek(80.123)
    expect(incoming.currentTime).toBe(80.123)
    expect(original.currentTime).toBe(80.123)
  })

  it('准备期间暂停、拖动和调速音量以最新命令为准', async () => {
    const { onStatus } = await playing()
    engine.load('/stem', 42, undefined, undefined, false, true)
    const incoming = Media.instances[1]
    engine.pause()
    await vi.advanceTimersByTimeAsync(250)
    engine.seek(71.345)
    engine.setPlaybackRate(1.5)
    engine.setVolume(0.3)
    incoming.ready()
    await flush()
    expect(engine.position).toBe(71.345)
    expect(incoming.paused).toBe(true)
    expect(incoming.play).not.toHaveBeenCalled()
    expect(incoming.playbackRate).toBe(1.5)
    expect(incoming.volume).toBe(0.3)
    expect(onStatus).toHaveBeenLastCalledWith('paused')
  })

  it('连续选择及切歌取消旧准备，迟到回调不会抢回输出', async () => {
    const { original, onCanPlay } = await playing()
    engine.load('/stem', 42, undefined, undefined, false, true)
    const stale = Media.instances[1]
    engine.load('/original', 42, undefined, undefined, false, true)
    stale.ready()
    await flush()
    expect(engine.position).toBe(original.currentTime)
    expect(stale.src).toBe('')
    expect(stale.play).not.toHaveBeenCalled()
    engine.load('/stem2', 42, undefined, undefined, false, true)
    const second = Media.instances[2]
    engine.clearSource()
    engine.load('/other')
    second.ready()
    await flush()
    expect(second.src).toBe('')
    expect(onCanPlay).toHaveBeenCalledOnce()
  })

  it('准备失败或超时保留当前轨；销毁释放候选和计时器', async () => {
    const { original, onError } = await playing()
    const id = engine.load('/broken', 42, undefined, undefined, false, true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onError).toHaveBeenCalledWith('MEDIA_SWITCH_FAILED', id)
    expect(original.paused).toBe(false)
    expect(Media.instances[1].src).toBe('')
    engine.load('/another', 42, undefined, undefined, false, true)
    engine.destroy()
    expect(Media.instances[2].src).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })
})
