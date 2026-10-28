/** 补回低频的截止频率:贝斯和底鼓多在此以下,人声基频大多在此以上。 */
const BASS_CUTOFF_HZ = 150
/** 左右相减后的侧声道增益;不相关的左右声道相减后能量约升 3dB,这里压回原响度附近。 */
const SIDE_GAIN = 0.7

/**
 * K 歌中置消除:居中混音的人声在左右声道相同,相减即可抵消;
 * 同样居中的低频一并被消掉,所以再把单声道低通补回,保住贝斯和底鼓。
 * 输出为单声道(左右相同),避免反相输出在耳机里发虚、在单声道外放里互相抵消。
 * 干声与湿声并联在 input/output 之间,开关时交叉淡变。
 */
export class KaraokeFilter {
  readonly input: GainNode
  readonly output: GainNode
  private readonly dry: GainNode
  private readonly wet: GainNode
  private readonly nodes: AudioNode[]

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet = ctx.createGain()
    this.wet.gain.value = 0

    const splitter = ctx.createChannelSplitter(2)
    const left = ctx.createGain()
    const right = ctx.createGain()
    left.gain.value = SIDE_GAIN
    right.gain.value = -SIDE_GAIN
    const mix = this.mono(1)
    const mid = this.mono(0.5)
    const low1 = this.lowpass()
    const low2 = this.lowpass()

    this.input.connect(this.dry).connect(this.output)
    this.input.connect(splitter)
    splitter.connect(left, 0)
    splitter.connect(right, 1)
    splitter.connect(mid, 0)
    splitter.connect(mid, 1)
    left.connect(mix)
    right.connect(mix)
    // 两级 12dB/oct 低通串联,避免中低频的人声跟着补回来
    mid.connect(low1).connect(low2).connect(mix)
    mix.connect(this.wet).connect(this.output)

    this.nodes = [this.input, this.dry, splitter, left, right, mid, low1, low2, mix, this.wet, this.output]
  }

  /**
   * 在干声和消除人声之间淡变
   *
   * @param on 是否消除人声
   * @param seconds 淡变时长,0 为立即切换
   */
  setEnabled(on: boolean, seconds: number): void {
    const t = this.ctx.currentTime
    for (const [node, target] of [[this.dry, on ? 0 : 1], [this.wet, on ? 1 : 0]] as const) {
      const g = node.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      if (seconds > 0) g.linearRampToValueAtTime(target, t + seconds)
      else g.setValueAtTime(target, t)
    }
  }

  disconnect(): void {
    for (const node of this.nodes) node.disconnect()
  }

  /** 把多路输入混成单声道的求和节点。 */
  private mono(gain: number): GainNode {
    const node = this.ctx.createGain()
    node.channelCount = 1
    node.channelCountMode = 'explicit'
    node.gain.value = gain
    return node
  }

  private lowpass(): BiquadFilterNode {
    const node = this.ctx.createBiquadFilter()
    node.type = 'lowpass'
    node.frequency.value = BASS_CUTOFF_HZ
    node.Q.value = Math.SQRT1_2
    return node
  }
}
