/**
 * 伴奏人声混回：输入为 4 声道伴奏流（1、2 伴奏，3、4 人声侧轨），只输出按比例混回的人声，伴奏本身由轨道增益直通。
 * 人声拆成中置与两侧：中置以主唱为主（导唱），两侧多是叠轨、和声与 ad-lib。
 * 左 = 中·lead + 侧·backing，右 = 中·lead − 侧·backing；两项都为 1 时与原曲一致。
 */
export class StemMixer {
  readonly input: ChannelSplitterNode
  readonly output: ChannelMergerNode
  /** 同侧系数 (lead + backing) / 2，左人声进左、右人声进右 */
  private readonly same: GainNode[]
  /** 交叉系数 (lead − backing) / 2，左人声进右、右人声进左 */
  private readonly cross: GainNode[]

  constructor(private readonly ctx: BaseAudioContext, lead = 0, backing = 0) {
    this.input = ctx.createChannelSplitter(4)
    this.output = ctx.createChannelMerger(2)
    this.same = [ctx.createGain(), ctx.createGain()]
    this.cross = [ctx.createGain(), ctx.createGain()]
    for (const side of [0, 1]) {
      this.input.connect(this.same[side], 2 + side)
      this.same[side].connect(this.output, 0, side)
      this.input.connect(this.cross[side], 2 + side)
      this.cross[side].connect(this.output, 0, 1 - side)
    }
    this.set(lead, backing, 0)
  }

  set(lead: number, backing: number, seconds: number): void {
    const t = this.ctx.currentTime
    for (const [nodes, value] of [[this.same, (lead + backing) / 2], [this.cross, (lead - backing) / 2]] as const) {
      for (const node of nodes) {
        node.gain.cancelScheduledValues(t)
        node.gain.setValueAtTime(node.gain.value, t)
        node.gain.linearRampToValueAtTime(value, t + seconds)
      }
    }
  }

  disconnect(): void {
    this.input.disconnect()
    this.output.disconnect()
  }
}
