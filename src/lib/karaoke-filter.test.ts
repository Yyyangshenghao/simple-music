import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './audio-engine'
import { KaraokeFilter } from './karaoke-filter'

type FakeNode = {
  kind: string
  gain: { value: number; linearRampToValueAtTime: ReturnType<typeof vi.fn> }
  frequency: { value: number }
  connect: ReturnType<typeof vi.fn>
}

/** 记录连线与增益事件的最小 Web Audio 替身。 */
function fakeAudioContext(currentTime = 3) {
  const edges: Array<[FakeNode, FakeNode, number | undefined]> = []
  const param = (value: number) => ({
    value,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(function (this: { value: number }, v: number) { this.value = v }),
    linearRampToValueAtTime: vi.fn(),
  })
  const node = (kind: string, extra: object = {}) => {
    const n = {
      kind, gain: param(1), channelCount: 2, channelCountMode: 'max', ...extra,
      connect: vi.fn((to: FakeNode, output?: number) => { edges.push([n as unknown as FakeNode, to, output]); return to }),
      disconnect: vi.fn(),
    }
    return n
  }
  const ctx = {
    currentTime, destination: {}, state: 'running', close: vi.fn(),
    createGain: () => node('gain'),
    createChannelSplitter: () => node('splitter'),
    createBiquadFilter: () => node('biquad', { type: '', frequency: param(350), Q: param(1) }),
    createAnalyser: () => node('analyser', { frequencyBinCount: 1 }),
    createMediaElementSource: () => node('source'),
  }
  return { ctx, edges }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('K 歌中置消除', () => {
  it('左右以相反增益相减，中声道只经两级 150Hz 低通补回', () => {
    const { ctx, edges } = fakeAudioContext()
    new KaraokeFilter(ctx as unknown as BaseAudioContext)
    const fromSplitter = edges.filter(([from]) => from.kind === 'splitter')
    expect(fromSplitter.map(([, to, output]) => [output, to.gain.value])).toEqual([[0, 0.7], [1, -0.7], [0, 0.5], [1, 0.5]])
    const lowpasses = new Set(edges.map(([from]) => from).filter(n => n.kind === 'biquad'))
    expect([...lowpasses].map(n => n.frequency.value)).toEqual([150, 150])
  })

  it('开启时干声淡出、湿声淡入，立即切换不排淡变', () => {
    const { ctx } = fakeAudioContext(3)
    const filter = new KaraokeFilter(ctx as unknown as BaseAudioContext)
    const { dry, wet } = filter as unknown as Record<'dry' | 'wet', FakeNode>
    filter.setEnabled(true, 0.25)
    expect(dry.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 3.25)
    expect(wet.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 3.25)
    filter.setEnabled(false, 0)
    expect(dry.gain.value).toBe(1)
    expect(wet.gain.value).toBe(0)
  })

  it('建图前开启也生效：媒体节点接消除链，消除链输出接频谱节点', async () => {
    const { ctx, edges } = fakeAudioContext()
    class Media extends EventTarget {
      src = ''; crossOrigin = ''; preload = ''; paused = true; ended = false; readyState = 0
      currentTime = 0; duration = 180; volume = 1; defaultPlaybackRate = 1; playbackRate = 1
      load = vi.fn(); pause = vi.fn()
      play = vi.fn(async () => { this.paused = false })
      removeAttribute() {}
    }
    vi.stubGlobal('Audio', Media)
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('window', { desktop: { serverPort: 35530, serverToken: 'test' }, AudioContext: vi.fn(function () { return ctx }) })
    const engine = new AudioEngine()
    engine.setKaraoke(true)
    engine.load('/api/local/audio?id=1')
    await engine.play()
    const sourceTargets = edges.filter(([from]) => from.kind === 'source').map(([, to]) => to)
    const filterInput = sourceTargets.at(-1)!
    expect(filterInput.kind).toBe('gain')
    // 干声支路:input → dry → output → analyser
    const dry = edges.find(([from, to]) => from === filterInput && to.kind === 'gain')![1]
    const output = edges.find(([from]) => from === dry)![1]
    expect(edges.some(([from, to]) => from === output && to.kind === 'analyser')).toBe(true)
    expect(dry.gain.value).toBe(0)
    engine.destroy()
  })
})
