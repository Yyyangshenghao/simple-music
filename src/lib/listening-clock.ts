/** 只累计媒体确实前进的实际时间，定位和等待由宿主显式暂停计时。 */
export class ListeningClock {
  seconds = 0
  mediaSeconds = 0
  private position = 0
  private at = 0
  private playing = false
  private rate = 1

  sample(position: number, now: number): void {
    if (!Number.isFinite(position) || !Number.isFinite(now)) return
    const elapsed = Math.max(0, (now - this.at) / 1000)
    const progress = Math.max(0, (position - this.position) / this.rate)
    if (this.playing) {
      const listened = Math.min(elapsed, progress)
      this.seconds += listened
      this.mediaSeconds += listened * this.rate
    }
    this.position = position
    this.at = now
  }

  update(playing: boolean, position: number, now: number, rate = 1): void {
    this.sample(position, now)
    this.playing = playing
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 1
  }

  rebase(position: number, now: number): void {
    this.position = position
    this.at = now
  }
}
