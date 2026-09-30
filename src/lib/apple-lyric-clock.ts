/** 将 MusicKit 的离散进度转换为逐帧歌词时间；停滞时限制推算范围。 */
export class AppleLyricClock {
  private sample = 0
  private anchor = 0
  private sampledAt = 0
  private playing = false
  private duration = 0

  reset(position: number, playing: boolean, duration = this.duration, now = performance.now()): void {
    this.sample = this.anchor = position
    this.sampledAt = now
    this.playing = playing
    this.duration = duration
  }

  update(position: number, playing: boolean, duration: number, now = performance.now()): void {
    const current = this.read(now)
    if (!playing || !this.playing || Math.abs(position - current) > 1.25) {
      // 暂停/恢复确认仍可能携带整秒位置，保留已呈现的小数，避免高亮回退。
      const aligned = Math.abs(position - current) <= 1.25 ? Math.max(position, current) : position
      this.reset(aligned, playing, duration, now)
      return
    }
    this.duration = duration
    // 相同快照不续期，后台卡住时不能让歌词无限前进。
    if (position === this.sample) return
    this.sample = position
    this.anchor = Math.max(position, current)
    this.sampledAt = now
  }

  read(now = performance.now()): number {
    const position = this.playing
      ? Math.min(this.sample + 1.25, this.anchor + Math.max(0, now - this.sampledAt) / 1000)
      : this.anchor
    return Math.max(0, this.duration > 0 ? Math.min(this.duration, position) : position)
  }
}
