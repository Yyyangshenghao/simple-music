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
})
