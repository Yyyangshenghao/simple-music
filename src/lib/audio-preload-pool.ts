/** 单个暂停媒体的准备参数 不包含播放器状态 */
export interface AudioPreloadTarget {
  src: string
  startAt: number
  rate?: number
}

interface Entry extends AudioPreloadTarget {
  audio?: HTMLAudioElement
  state: 'queued' | 'preparing' | 'ready'
  promise: Promise<boolean>
  settle(value: boolean): void
  cleanup(): void
}

/**
 * 判断目标位置是否已完成定位并具有起播缓冲
 *
 * @param audio 暂停的媒体元素
 * @param startAt 目标起点秒数
 */
function readyAt(audio: HTMLAudioElement, startAt: number): boolean {
  if (audio.error || audio.seeking || audio.readyState < 3 || Math.abs(audio.currentTime - startAt) > 0.1) return false
  const end = Math.min(audio.duration || Infinity, startAt + 2 * audio.playbackRate)
  for (let i = 0; i < audio.buffered.length; i++) {
    if (audio.buffered.start(i) <= startAt && audio.buffered.end(i) >= end) return true
  }
  return false
}

/** 最多四个暂停媒体 串行准备并保留原实例供实际播放接管 */
export class AudioPreloadPool {
  private entries = new Map<string, Entry>()

  /** @param target 完整媒体地址和起点 */
  private key(target: AudioPreloadTarget): string { return `${target.src}\n${target.startAt}` }

  /**
   * 释放一个离开窗口的媒体并结束等待
   *
   * @param key 准备条目键
   * @param release 是否清空音频源 接管时保留
   */
  private remove(key: string, release = true): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    entry.cleanup()
    entry.settle(false)
    if (release && entry.audio) {
      entry.audio.pause()
      entry.audio.removeAttribute('src')
      entry.audio.load()
    }
  }

  /**
   * 注册准备条目 也可复用刚停止的当前媒体
   *
   * @param target 待准备的音频
   * @param audio 已播放过的媒体 缺省时延迟创建
   */
  private add(target: AudioPreloadTarget, audio?: HTMLAudioElement): void {
    const key = this.key(target)
    let settle!: (ready: boolean) => void
    const promise = new Promise<boolean>(resolve => { settle = resolve })
    this.entries.set(key, { ...target, audio, state: 'queued', promise, settle, cleanup() {} })
  }

  /** 按队列串行获取媒体信息和目标区间 */
  private pump(): void {
    if ([...this.entries.values()].some(entry => entry.state === 'preparing')) return
    const entry = [...this.entries.values()].find(item => item.state === 'queued')
    if (!entry) return
    const key = this.key(entry)
    const reused = !!entry.audio
    const audio = entry.audio ?? new Audio()
    entry.audio = audio
    entry.state = 'preparing'
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audio.defaultPlaybackRate = entry.rate ?? audio.playbackRate
    audio.playbackRate = entry.rate ?? audio.playbackRate
    let positioned = false
    const current = () => this.entries.get(key) === entry
    const check = () => {
      if (!current() || !positioned || !readyAt(audio, entry.startAt)) return
      entry.state = 'ready'
      entry.cleanup()
      // 只是降低浏览器的预取倾向 不宣称严格的字节上限
      audio.preload = 'metadata'
      entry.settle(true)
      this.pump()
    }
    const position = () => {
      if (!current() || positioned || audio.readyState < 1) return
      positioned = true
      audio.currentTime = entry.startAt
      check()
    }
    const fail = () => {
      if (!current()) return
      this.remove(key)
      this.pump()
    }
    const timer = setTimeout(fail, 5000)
    audio.addEventListener('loadedmetadata', position)
    for (const name of ['seeked', 'canplay', 'progress']) audio.addEventListener(name, check)
    audio.addEventListener('error', fail)
    entry.cleanup = () => {
      clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', position)
      for (const name of ['seeked', 'canplay', 'progress']) audio.removeEventListener(name, check)
      audio.removeEventListener('error', fail)
    }
    if (reused) position()
    else {
      audio.src = entry.src
      audio.load()
    }
  }

  /**
   * 更新前后各两首的窗口 相同目标保留进行中的请求
   *
   * @param targets 按优先级排列的目标
   */
  update(targets: AudioPreloadTarget[]): void {
    const unique = [...new Map(targets.map(target => [this.key(target), target])).values()].slice(0, 4)
    const keep = new Set(unique.map(target => this.key(target)))
    for (const key of this.entries.keys()) if (!keep.has(key)) this.remove(key)
    for (const target of unique) if (!this.entries.has(this.key(target))) this.add(target)
    this.pump()
  }

  /**
   * 保留切走的音频供上一首复用 淘汰更早的准备条目
   *
   * @param audio 已停止且与输出断开的媒体
   * @param target 原播放地址和选段起点
   */
  retain(audio: HTMLAudioElement, target: AudioPreloadTarget): void {
    this.remove(this.key(target))
    // 交接期间旧当前曲也在此登记 五个元素仍包含当前曲而非额外创建第六个
    while (this.entries.size >= 5) this.remove(this.entries.keys().next().value!)
    this.add(target, audio)
    this.pump()
  }

  /**
   * 取走已经定位且缓冲仍有效的媒体
   *
   * @param target 本次实际播放目标
   */
  take(target: AudioPreloadTarget): HTMLAudioElement | undefined {
    const key = this.key(target)
    const entry = this.entries.get(key)
    if (!entry?.audio || entry.state !== 'ready' || !readyAt(entry.audio, target.startAt)) {
      // 回退实际加载前终止相同目标的后台请求 避免两份下载并行
      this.remove(key)
      this.pump()
      return undefined
    }
    const audio = entry.audio
    this.remove(key, false)
    this.pump()
    return audio
  }

  /** 接管或回退创建新当前曲之前收敛到四个准备槽 */
  trim(): void { while (this.entries.size > 4) this.remove(this.entries.keys().next().value!) }

  /**
   * 等待已有准备并提升消费顺序 不重新创建请求
   *
   * @param target 实际待切目标
   */
  wait(target: AudioPreloadTarget): Promise<boolean> {
    const key = this.key(target)
    const entry = this.entries.get(key)
    if (!entry) return Promise.resolve(false)
    // 即将消费的目标放到末尾 避免保留旧当前曲时被容量淘汰
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.state === 'ready' && entry.audio
      ? Promise.resolve(readyAt(entry.audio, target.startAt)) : entry.promise
  }

  /** 释放全部准备实例 不触碰已接管的当前媒体 */
  clear(): void { for (const key of this.entries.keys()) this.remove(key) }
}
