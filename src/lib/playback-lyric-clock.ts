/** 普通音频的歌词时钟：吸收宿主采样延迟，暂停保留已经呈现的位置。 */
export class PlaybackLyricClock {
  private sample = 0
  private anchor = 0
  private sampledAt = 0
  private playing = false
  private duration = 0
  private rate = 1

  reset(position: number, playing: boolean, duration: number, rate: number, now = performance.now()): void {
    this.sample = this.anchor = position
    this.sampledAt = now
    this.playing = playing
    this.duration = duration
    this.rate = rate
  }

  update(position: number, playing: boolean, duration: number, rate: number, now = performance.now()): void {
    const current = this.read(now)
    // 大幅校时直接跟随宿主；显式拖动、换曲等由调用方 reset，允许小幅后退。
    if (Math.abs(position - current) > 1.25) {
      this.reset(position, playing, duration, rate, now)
      return
    }
    const changed = position !== this.sample || playing !== this.playing || rate !== this.rate
    this.duration = duration
    if (!changed) return
    // 暂停后的淡出仍可能上报进度，不能让已经定格的画面再次移动。
    this.anchor = this.playing || playing ? Math.max(position, current) : current
    this.sample = Math.max(this.sample, position)
    this.sampledAt = now
    this.playing = playing
    this.rate = rate
  }

  read(now = performance.now()): number {
    const position = this.playing
      ? Math.min(Math.max(this.anchor, this.sample + 0.5 * this.rate), this.anchor + Math.max(0, now - this.sampledAt) / 1000 * this.rate)
      : this.anchor
    return Math.max(0, this.duration > 0 ? Math.min(this.duration, position) : position)
  }
}
