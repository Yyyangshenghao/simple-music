import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppleAudioSpectrum } from './apple-audio-spectrum'

describe('Apple Music 窗口频谱', () => {
  const track = { readyState: 'live', stop: vi.fn(), addEventListener: vi.fn() }
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const analyser = { fftSize: 0, frequencyBinCount: 1024, getByteFrequencyData: vi.fn((data: Uint8Array) => data.fill(96)), disconnect: vi.fn() }
  const context = { state: 'running', createMediaStreamSource: vi.fn(() => source), createAnalyser: vi.fn(() => analyser), resume: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  const getDisplayMedia = vi.fn(async () => stream)

  beforeEach(() => {
    vi.clearAllMocks()
    context.state = 'running'
    vi.stubGlobal('window', { desktop: { isDesktop: true } })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    vi.stubGlobal('AudioContext', vi.fn(() => context))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('从 Apple 窗口音轨读取频谱，不把捕获音频再次接到扬声器', async () => {
    const spectrum = new AppleAudioSpectrum()
    spectrum.start()
    await vi.waitFor(() => expect(source.connect).toHaveBeenCalledWith(analyser))
    expect(spectrum.read()).toHaveLength(1024)
    expect(spectrum.read()[0]).toBe(96)
    expect(source.connect).toHaveBeenCalledTimes(1)
    spectrum.stop()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(source.disconnect).toHaveBeenCalledOnce()
    expect(spectrum.read()).toHaveLength(0)
  })

  it('切歌时丢弃迟到的捕获结果', async () => {
    let resolve!: (value: typeof stream) => void
    getDisplayMedia.mockImplementationOnce(() => new Promise(resolvePromise => { resolve = resolvePromise }))
    const spectrum = new AppleAudioSpectrum()
    spectrum.start()
    spectrum.stop()
    resolve(stream)
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalledOnce())
    expect(spectrum.read()).toHaveLength(0)
  })

  it('音频上下文恢复未完成时切歌仍立即释放音轨', async () => {
    context.resume.mockImplementationOnce(() => new Promise(() => {}))
    const spectrum = new AppleAudioSpectrum()
    spectrum.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledOnce())
    spectrum.stop()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
    expect(spectrum.read()).toHaveLength(0)
  })

  it('恢复音频上下文卡住时允许后续用户操作重试', async () => {
    context.state = 'suspended'
    context.resume.mockImplementationOnce(() => new Promise(() => {}))
    const spectrum = new AppleAudioSpectrum()
    spectrum.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledOnce())
    spectrum.start()
    expect(context.resume).toHaveBeenCalledTimes(2)
    spectrum.stop()
  })
})
