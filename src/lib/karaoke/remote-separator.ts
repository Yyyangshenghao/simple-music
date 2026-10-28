import { api } from '../api'
import type { KaraokePort, KaraokeProgress } from '../../types/karaoke'
import type { KaraokeHelperEvent, KaraokeHelperRequest } from '../../types/ipc'
import type { KaraokeModelId } from '../../types/karaoke'

export interface KaraokeHelperChannel {
  karaokeRequest(request: KaraokeHelperRequest): void
  onKaraokeEvent(cb: (event: KaraokeHelperEvent) => void): () => void
}

const abortError = () => new DOMException('Aborted', 'AbortError')

/**
 * 宿主侧 K 歌端口：分离交给主进程拉起的独立进程，避免推理与界面合成争用同一个 GPU 进程。
 * 取消立即结束本地等待；分离进程内部串行执行，不会与下一首并发推理。
 */
export function createRemoteSeparator(bridge: Partial<KaraokeHelperChannel> | undefined = typeof window !== 'undefined' ? window.desktop : undefined): KaraokePort {
  // 没有桌面桥时明确报告不支持生成，不以实时音效替代生成文件。
  const channel = typeof bridge?.karaokeRequest === 'function' && typeof bridge.onKaraokeEvent === 'function'
    ? bridge as KaraokeHelperChannel : undefined
  const known = new Map<string, string>()
  let support: Promise<boolean> | null = null
  let nextId = 0
  const session = Math.random().toString(36).slice(2, 10)
  const jobs = new Map<string, { onProgress(p: KaraokeProgress): void; resolve(url: string): void; reject(error: Error): void; known: string }>()
  const knownId = (model: KaraokeModelId, key: string) => `${model}|${key}`
  const remember = (id: string, url: string) => {
    known.delete(id)
    known.set(id, url)
    if (known.size > 256) known.delete(known.keys().next().value!)
  }
  let listening = false

  function listen(target: KaraokeHelperChannel): void {
    if (listening) return
    listening = true
    target.onKaraokeEvent((event) => {
      const job = jobs.get(event.id)
      if (!job) return
      if (event.type === 'progress') {
        job.onProgress({ phase: event.phase, progress: event.progress })
        return
      }
      jobs.delete(event.id)
      if (event.type === 'done') {
        remember(job.known, event.url)
        job.resolve(event.url)
      } else job.reject(event.aborted ? abortError() : new Error(event.message))
    })
  }

  return {
    supported() {
      // 桌面端先尝试原生 GPU，实际设备与模型兼容性在分离实例初始化时校验。
      support ??= Promise.resolve(!!channel)
      return support
    },
    knownStem: (model, key) => known.get(knownId(model, key)) ?? null,
    forget(model, key) { known.delete(knownId(model, key)) },
    async separate(model, key, src, onProgress, signal) {
      if (!channel) throw new Error('分离进程不可用')
      // 已有伴奏时直接用，不为一次查询拉起分离进程
      const stem = api.url('/api/karaoke/stem', { model, key })
      const head = await fetch(stem, { method: 'HEAD', signal }).catch(() => null)
      if (signal.aborted) throw abortError()
      if (head?.ok) {
        remember(knownId(model, key), stem)
        return stem
      }
      listen(channel)
      const id = `${session}-${++nextId}`
      return new Promise<string>((resolve, reject) => {
        const onAbort = () => {
          if (!jobs.delete(id)) return
          channel.karaokeRequest({ type: 'cancel', id })
          reject(abortError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        const settle = <T>(fn: (value: T) => void) => (value: T) => { signal.removeEventListener('abort', onAbort); fn(value) }
        jobs.set(id, { known: knownId(model, key), onProgress, resolve: settle(resolve), reject: settle(reject) })
        channel.karaokeRequest({ type: 'separate', id, model, key, src })
      })
    },
    release() {
      for (const job of [...jobs.values()]) job.reject(abortError())
      jobs.clear()
      channel?.karaokeRequest({ type: 'release' })
    },
  }
}
