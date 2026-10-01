/** 从应用内 Apple Music 窗口取得只读音频流，供现有可视化组件读取频谱。 */
export class AppleAudioSpectrum {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private frequency = new Uint8Array(new ArrayBuffer(0))
  private pending = false
  private generation = 0

  start(): void {
    if (!window.desktop?.isDesktop || !navigator.mediaDevices?.getDisplayMedia) return
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {})
    if (this.pending || this.stream) return
    this.pending = true
    const generation = ++this.generation
    let capture: Promise<MediaStream>
    try {
      // 在同一用户手势内启动 Web Audio 与窗口捕获；两者都不能等播放轮询完成。
      const context = new AudioContext()
      this.context = context
      void context.resume().catch(() => {})
      capture = navigator.mediaDevices.getDisplayMedia({ audio: true, video: { frameRate: 1, width: 16, height: 16 } })
    } catch {
      this.stop()
      return
    }
    void capture.then(stream => {
      if (generation !== this.generation || stream.getAudioTracks().length === 0 || stream.getAudioTracks()[0].readyState === 'ended') {
        stream.getTracks().forEach(track => track.stop())
        if (generation === this.generation) this.stop()
        return
      }
      this.stream = stream
      this.pending = false
      try {
        const context = this.context!
        const source = context.createMediaStreamSource(stream)
        this.source = source
        const analyser = context.createAnalyser()
        this.analyser = analyser
        analyser.fftSize = 2048
        source.connect(analyser)
        this.frequency = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
        stream.getAudioTracks()[0].addEventListener('ended', () => {
          if (generation === this.generation) this.stop()
        }, { once: true })
        // 主进程允许本地回放；这里不接 destination，避免音频重复播放。
        if (generation === this.generation && stream.getAudioTracks()[0].readyState === 'ended') this.stop()
      } catch {
        if (generation === this.generation) this.stop()
      }
    }).catch(() => {
      // 拒绝捕获或 DRM 不提供音频时，播放本身不受影响。
      if (generation === this.generation) this.stop()
    }).finally(() => { if (generation === this.generation) this.pending = false })
  }

  read(): Uint8Array {
    if (this.analyser && this.context?.state === 'running') this.analyser.getByteFrequencyData(this.frequency)
    return this.frequency
  }

  stop(): void {
    this.generation++
    this.pending = false
    this.stream?.getTracks().forEach(track => track.stop())
    this.source?.disconnect()
    this.analyser?.disconnect()
    void this.context?.close()
    this.stream = null
    this.context = null
    this.source = null
    this.analyser = null
    this.frequency = new Uint8Array(new ArrayBuffer(0))
  }
}

export const appleAudioSpectrum = new AppleAudioSpectrum()
