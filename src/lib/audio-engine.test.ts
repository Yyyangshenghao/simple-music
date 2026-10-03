import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './audio-engine'

class FakeAudio {
  crossOrigin = ''
  preload = ''
  src = ''
  currentSrc = ''
  currentTime = 0
  duration = 120
  paused = true
  ended = false
  readyState = 0
  volume = 1
  defaultPlaybackRate = 1
  playbackRate = 1
  error: { code: number } | null = null
  private listeners = new Map<string, Array<() => void>>()

  addEventListener(name: string, callback: () => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback])
  }

  dispatch(name: string): void {
    for (const callback of this.listeners.get(name) ?? []) callback()
  }

  load(): void {}
  pause(): void { this.paused = true }
  play(): Promise<void> { this.paused = false; return Promise.resolve() }
  removeAttribute(name: string): void { if (name === 'src') this.src = '' }
}

describe('AudioEngine media callbacks', () => {
  let audio: FakeAudio
  let deviceChange: (() => void) | null

  beforeEach(() => {
    audio = new FakeAudio()
    deviceChange = null
    vi.stubGlobal('Audio', vi.fn(() => audio))
    vi.stubGlobal('navigator', {
      mediaDevices: {
        addEventListener: vi.fn((name: string, callback: () => void) => {
          if (name === 'devicechange') deviceChange = callback
        }),
        removeEventListener: vi.fn((name: string, callback: () => void) => {
          if (name === 'devicechange' && deviceChange === callback) deviceChange = null
        }),
      },
    })
    vi.stubGlobal('window', { desktop: { serverPort: 35530, serverToken: 'token' } })
  })

  function suspendedContext() {
    const resumes: Array<() => void> = []
    const context = {
      state: 'suspended', currentTime: 0, destination: {},
      resume: () => new Promise<void>(resolve => { resumes.push(resolve) }),
      close: async () => {},
      createMediaElementSource: () => ({ connect() {}, disconnect() {} }),
      createAnalyser: () => ({ frequencyBinCount: 1, connect() {}, disconnect() {} }),
      createGain: () => ({ connect() {}, disconnect() {}, gain: {
        value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {},
      } }),
    }
    vi.stubGlobal('window', {
      desktop: { serverPort: 35530, serverToken: 'token' },
      AudioContext: vi.fn(function () { return context }),
    })
    return resumes
  }

  it.each(['pause', 'load', 'clearSource', 'destroy'] as const)('恢复音频上下文等待期间 %s 取消旧的播放意图', async (action) => {
    const resumes = suspendedContext()
    const play = vi.spyOn(audio, 'play')
    const onStatus = vi.fn()
    const engine = new AudioEngine({ onStatus })
    engine.load('/api/local/audio?id=old')
    const pending = engine.play()
    if (action === 'load') engine.load('/api/local/audio?id=new')
    else engine[action]()
    onStatus.mockClear()
    resumes[0]()
    await pending
    expect(play).not.toHaveBeenCalled()
    expect(audio.paused).toBe(true)
    expect(onStatus).not.toHaveBeenCalledWith('playing')
  })

  it('新的播放请求取代尚未恢复的旧请求，旧恢复不能提前开播', async () => {
    const resumes = suspendedContext()
    const play = vi.spyOn(audio, 'play')
    const engine = new AudioEngine()
    engine.load('/api/local/audio?id=one')
    const first = engine.play()
    const second = engine.play()
    resumes[0]()
    await first
    expect(play).not.toHaveBeenCalled()
    resumes[1]()
    await second
    expect(play).toHaveBeenCalledOnce()
    expect(audio.paused).toBe(false)
  })

  it('暂停取消待恢复请求后，用户再次播放仍能恢复', async () => {
    const resumes = suspendedContext()
    const play = vi.spyOn(audio, 'play')
    const engine = new AudioEngine()
    engine.load('/api/local/audio?id=one')
    const first = engine.play()
    engine.pause()
    const second = engine.play()
    resumes[1]()
    await second
    resumes[0]()
    await first
    expect(play).toHaveBeenCalledOnce()
    expect(audio.paused).toBe(false)
  })

  it('canplay 通知解析器提交候选', () => {
    const onCanPlay = vi.fn()
    new AudioEngine({ onCanPlay })
    audio.dispatch('canplay')
    expect(onCanPlay).toHaveBeenCalledWith(0)
  })

  it('非空 URL 的媒体错误回流并携带错误码', () => {
    const onError = vi.fn()
    new AudioEngine({ onError })
    audio.error = { code: 4 }
    audio.dispatch('error')
    expect(onError).toHaveBeenCalledWith('MEDIA_ERR_4', 0)
  })

  it('输出设备变化时报告当前是否正在播放，并在销毁后解绑', () => {
    const onOutputDeviceChange = vi.fn()
    const engine = new AudioEngine({ onOutputDeviceChange })
    audio.paused = false

    deviceChange?.()
    expect(onOutputDeviceChange).toHaveBeenCalledWith(true)

    engine.destroy()
    expect(deviceChange).toBeNull()
  })

  it('在线候选把内容别名与实际音源写入被动缓存请求', () => {
    const engine = new AudioEngine()
    engine.load('https://cdn.example.com/song.mp3', 0, 'qq:mid:lossless', {
      originSource: 'netease',
      originId: '123',
      resolvedSource: 'qq',
      resolvedId: 'mid',
      quality: 'lossless',
    })
    expect(audio.src).toContain('/api/audio?')
    expect(audio.src).toContain('cacheKey=qq%3Amid%3Alossless')
    expect(audio.src).toContain('originSource=netease')
    expect(audio.src).toContain('resolvedSource=qq')
  })
})
