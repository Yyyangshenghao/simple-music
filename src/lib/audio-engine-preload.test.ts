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
  error: { code: number } | null = null
  ranges: Array<[number, number]> = []
  buffered = {
    get length() { return this.media.ranges.length },
    start: (i: number) => this.ranges[i][0],
    end: (i: number) => this.ranges[i][1],
    media: this,
  }
  load = vi.fn()
  play = vi.fn(async () => { this.paused = false; this.emit('playing') })
  pause = vi.fn(() => { this.paused = true; this.emit('pause') })

  /** 保存创建的媒体用于断言实例复用 */
  constructor() { super(); Media.instances.push(this) }
  /** @param name 待清理的媒体属性 */
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  /** @param name 媒体事件 */
  emit(name: string) { this.dispatchEvent(new Event(name)) }
  /** @param start 已缓冲区间起点 */
  ready(start = 0) {
    this.readyState = 4
    this.ranges = [[start, 180]]
    this.emit('loadedmetadata')
    this.emit('seeked')
    this.emit('canplay')
  }
}

const a = { url: 'https://cdn.example.com/a.mp3', startAt: 50 }
const b = { url: 'https://cdn.example.com/b.mp3', startAt: 60 }
const c = { url: 'https://cdn.example.com/c.mp3', startAt: 70 }
const d = { url: 'https://cdn.example.com/d.mp3', startAt: 80 }
const e = { url: 'https://cdn.example.com/e.mp3', startAt: 90 }
const f = { url: 'https://cdn.example.com/f.mp3', startAt: 100 }
let engine: AudioEngine
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

beforeEach(() => {
  Media.instances = []
  vi.stubGlobal('Audio', Media)
  vi.stubGlobal('window', { desktop: { serverPort: 35530, serverToken: 'test' } })
  vi.stubGlobal('navigator', {})
})
afterEach(() => { engine?.destroy(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('刷歌音频预加载', () => {
  it('预加载只定位和缓冲 不播放也不提交当前状态', async () => {
    const onStatus = vi.fn(), onCanPlay = vi.fn()
    engine = new AudioEngine({ onStatus, onCanPlay })
    engine.preloadAudio([a, b])
    const first = Media.instances[1]
    expect(Media.instances).toHaveLength(2)
    first.ready(45)
    await flush()
    expect(first.currentTime).toBe(50)
    expect(first.play).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()
    expect(onCanPlay).not.toHaveBeenCalled()
    expect(Media.instances).toHaveLength(3)
  })

  it('只有目标位置及后续缓冲就绪才算命中', async () => {
    engine = new AudioEngine()
    engine.preloadAudio([a])
    const audio = Media.instances[1]
    audio.readyState = 4
    audio.ranges = [[0, 5]]
    audio.emit('loadedmetadata')
    audio.emit('canplay')
    let ready = false
    void engine.waitForPreload(a).then(value => { ready = value })
    await flush()
    expect(ready).toBe(false)
    audio.ranges = [[49, 55]]
    audio.emit('progress')
    await flush()
    expect(ready).toBe(true)
  })

  it('刷歌命中接管同一媒体 不再加载或定位', async () => {
    const onCanPlay = vi.fn(), onDuration = vi.fn()
    engine = new AudioEngine({ onCanPlay, onDuration })
    engine.preloadAudio([a])
    const audio = Media.instances[1]
    audio.ready(45)
    await flush()
    engine.clearSource()
    const id = engine.load(a.url, a.startAt, undefined, undefined, true)
    await engine.play()
    await flush()
    expect(audio.load).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledOnce()
    expect(engine.position).toBe(50)
    expect(onCanPlay).toHaveBeenCalledWith(id)
    expect(onDuration).toHaveBeenCalledWith(180)
  })

  it('普通播放不消费刷歌媒体 保持原有加载行为', async () => {
    engine = new AudioEngine()
    engine.preloadAudio([a])
    Media.instances[1].ready(45)
    await flush()
    engine.load(a.url, a.startAt)
    await engine.play()
    expect(Media.instances[0].load).toHaveBeenCalledOnce()
    expect(Media.instances[0].play).toHaveBeenCalledOnce()
    expect(Media.instances[1].play).not.toHaveBeenCalled()
  })

  it('切走的当前曲保留为上一首 回看复用且旧事件不污染播放器', async () => {
    const onPosition = vi.fn()
    engine = new AudioEngine({ onPosition })
    engine.load(a.url, a.startAt, undefined, undefined, true)
    const first = Media.instances[0]
    first.ready(45)
    engine.preloadAudio([b])
    Media.instances[1].ready(55)
    await flush()
    engine.clearSource(true)
    engine.load(b.url, b.startAt, undefined, undefined, true)
    first.emit('seeked')
    first.emit('progress')
    first.emit('timeupdate')
    expect(onPosition).not.toHaveBeenCalled()
    await flush()
    engine.preloadAudio([a, c])
    engine.clearSource(true)
    engine.load(a.url, a.startAt, undefined, undefined, true)
    await engine.play()
    expect(first.load).toHaveBeenCalledOnce()
    expect(first.play).toHaveBeenCalledOnce()
    expect(engine.position).toBe(50)
  })

  it('清理窗口取消在途等待 丢弃迟到事件', async () => {
    engine = new AudioEngine()
    engine.preloadAudio([a, b])
    const old = Media.instances[1]
    const pending = engine.waitForPreload(a)
    engine.releasePreloads()
    expect(await pending).toBe(false)
    old.ready(45)
    await flush()
    expect(old.src).toBe('')
    expect(Media.instances).toHaveLength(2)
  })

  it('后台超时释放媒体并允许后续任务准备', async () => {
    vi.useFakeTimers()
    engine = new AudioEngine()
    engine.preloadAudio([a, b])
    const pending = engine.waitForPreload(a)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toBe(false)
    expect(Media.instances[1].src).toBe('')
    expect(Media.instances).toHaveLength(3)
  })

  it('未就绪回退会终止相同目标的预取 反复取消接管不超出三个资源', async () => {
    engine = new AudioEngine()
    engine.load(a.url, a.startAt, undefined, undefined, true)
    Media.instances[0].ready(45)
    engine.preloadAudio([b, c])
    const waiting = Media.instances[1]
    engine.clearSource(true)
    engine.clearSource(true)
    expect(engine.hasSource).toBe(false)
    await engine.play()
    expect(Media.instances[0].play).not.toHaveBeenCalled()
    engine.load(b.url, b.startAt, undefined, undefined, true)
    expect(waiting.src).toBe('')
    expect(Media.instances.filter(audio => audio.src)).toHaveLength(3)
    engine.releasePreloads()
    expect(Media.instances.filter(audio => audio.src)).toHaveLength(1)
  })

  it('接管保留倍速和 250 ms 淡入 同一媒体只创建一个输出节点', async () => {
    const nodes = new Map<unknown, unknown>()
    const ramp = vi.fn()
    const createMediaElementSource = vi.fn((audio: unknown) => {
      if (nodes.has(audio)) throw new Error('duplicate source')
      const node = { connect: vi.fn(), disconnect: vi.fn() }
      nodes.set(audio, node)
      return node
    })
    const context = {
      currentTime: 12, state: 'running', destination: {}, close: vi.fn(),
      createMediaElementSource,
      createAnalyser: () => ({ frequencyBinCount: 1, connect() {}, disconnect() {} }),
      createGain: () => ({ connect() {}, disconnect() {}, gain: {
        value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime: ramp,
      } }),
    }
    const AudioContext = vi.fn(function () { return context })
    vi.stubGlobal('window', { desktop: { serverPort: 35530, serverToken: 'test' }, AudioContext })
    engine = new AudioEngine()
    engine.load(a.url, a.startAt, undefined, undefined, true)
    Media.instances[0].ready(45)
    engine.setPlaybackRate(1.5)
    await engine.play()
    engine.preloadAudio([b])
    const next = Media.instances[1]
    next.ready(55)
    await flush()
    engine.clearSource(true)
    engine.load(b.url, b.startAt, undefined, undefined, true)
    engine.setVolume(0.3)
    await engine.play()
    expect(next.playbackRate).toBe(1.5)
    expect(next.volume).toBe(0.3)
    expect(ramp).toHaveBeenLastCalledWith(1, 12.25)
    Media.instances[0].emit('seeked')
    await flush()
    engine.clearSource(true)
    engine.load(a.url, a.startAt, undefined, undefined, true)
    await engine.play()
    expect(AudioContext).toHaveBeenCalledOnce()
    expect(createMediaElementSource).toHaveBeenCalledTimes(2)
    expect(Media.instances[0].load).toHaveBeenCalledOnce()
    expect(ramp).toHaveBeenLastCalledWith(1, 12.25)
  })

  it.each([d, e])('前后第二首 $url 已准备时复用实例 滑动窗口仅准备新曲', async target => {
    engine = new AudioEngine()
    engine.load(a.url, a.startAt, undefined, undefined, true)
    Media.instances[0].ready(45)
    engine.preloadAudio([b, b, c, d, e, f])
    for (let i = 1; i <= 4; i++) {
      expect(Media.instances).toHaveLength(i + 1)
      Media.instances[i].ready()
      await flush()
    }
    expect(Media.instances.filter(audio => audio.src)).toHaveLength(5)
    expect(await engine.waitForPreload(f)).toBe(false)
    const prepared = Media.instances[target === d ? 3 : 4]
    const outside = Media.instances[target === d ? 4 : 3]
    engine.clearSource(true)
    engine.load(target.url, target.startAt, undefined, undefined, true)
    await engine.play()
    expect(prepared.play).toHaveBeenCalledOnce()
    expect(prepared.load).toHaveBeenCalledOnce()
    engine.preloadAudio([a, b, c, f])
    await flush()
    expect(outside.src).toBe('')
    expect(Media.instances).toHaveLength(6)
    expect(Media.instances.filter(audio => audio.src)).toHaveLength(5)
    for (const retained of Media.instances.slice(0, 3)) expect(retained.load).toHaveBeenCalledOnce()
    engine.releasePreloads()
    expect(Media.instances.filter(audio => audio.src)).toEqual([prepared])
  })

  it('满四槽冷切换及重复取消交接均不超过五份有效资源', async () => {
    engine = new AudioEngine()
    engine.load(a.url, a.startAt, undefined, undefined, true)
    Media.instances[0].ready(45)
    engine.preloadAudio([b, c, d, e])
    for (let i = 1; i <= 4; i++) Media.instances[i].ready()
    engine.clearSource(true)
    engine.clearSource(true)
    expect(Media.instances.filter(audio => audio.src)).toHaveLength(5)
    engine.load(f.url, f.startAt, undefined, undefined, true)
    expect(Media.instances).toHaveLength(6)
    expect(Media.instances.filter(audio => audio.src)).toHaveLength(5)
    expect(Media.instances[1].src).toBe('')
    engine.releasePreloads()
    expect(Media.instances.filter(audio => audio.src)).toEqual([Media.instances[5]])
  })
})
