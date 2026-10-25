import type { Track } from '../types/domain'
import type { LyricPrioritySource } from '../types/lyrics-source'
import { useLyricsSourceStore } from '../stores/lyrics-source'
import { queryLyricsSource } from './lyrics-source-query'

import { LYRICS_TEST_SONGS } from '../types/lyrics-source'

export function createLyricsSourceProbe() {
  const running = new Map<LyricPrioritySource, AbortController>()
  return {
    async test(origin: LyricPrioritySource, key: string): Promise<void> {
      if (running.has(origin)) return
      const sample = LYRICS_TEST_SONGS.find(song => song.key === key)
      if (!sample) throw new Error('未知测试歌曲')
      const controller = new AbortController()
      running.set(origin, controller)
      const start = performance.now()
      const publish = (status: 'loading' | 'idle' | 'ready' | 'empty' | 'mismatch' | 'error' | 'disabled' | 'login' | 'unavailable', message?: string) => {
        useLyricsSourceStore.setState(state => ({ probes: { ...state.probes, [origin]: {
          status, sample: sample.name, message, ...(status === 'loading' ? {} : { ms: Math.round(performance.now() - start) }),
        } } }))
      }
      publish('loading')
      try {
        const track: Track = { ...sample, source: 'netease', provider: 'netease', type: 'song', artists: [{ id: '', name: sample.artist }] }
        const response = await queryLyricsSource(track, origin, ['netease', 'qq'], controller.signal, undefined, { probe: true })
        if (!controller.signal.aborted) publish(response.status === 'loading' ? 'idle' : response.status, response.message)
      } catch (error) {
        if (!controller.signal.aborted) publish(error instanceof DOMException && error.name === 'AbortError' ? 'idle' : 'error', '测试已中断，请重试')
      } finally { running.delete(origin) }
    },
    stop() {
      for (const controller of running.values()) controller.abort()
      running.clear()
    },
  }
}
