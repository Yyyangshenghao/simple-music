import { BilibiliMusicService } from '../lib/bilibili-service'
import { createLegacyProvider } from './legacy-provider-adapter'
import { PlaybackUnavailableError, type QualityOption } from './types'

export const bilibiliService = new BilibiliMusicService()

/** 游客可搜索和点播音频，也可跨源兜底；音频走 /api/audio 代理补 Referer。 */
export const bilibiliProvider = createLegacyProvider({
  descriptor: {
    id: 'bilibili', label: '哔哩哔哩', color: '#FB7299',
    colorSoft: 'rgba(251, 114, 153, 0.4)', iconKey: 'bilibili', defaultEnabled: false,
  },
  service: bilibiliService,
  surfaces: [],
})

bilibiliProvider.playback = {
  async getQualities(track) {
    const info = await bilibiliService.getPlayInfo(track)
    const seen = new Set<string>()
    return info.candidates
      .filter((item) => !seen.has(item.level) && seen.add(item.level))
      .map((item, rank): QualityOption => ({ id: item.level, label: item.quality, rank, bitrate: item.br }))
  },
  async resolve(track, quality, signal) {
    const info = await bilibiliService.getPlayInfo(track, signal).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'BILIBILI_RATE_LIMITED') {
        throw new PlaybackUnavailableError('哔哩哔哩请求受限，请稍后再试')
      }
      throw error
    })
    if (!info.candidates.length) throw new PlaybackUnavailableError('哔哩哔哩没有返回可播放的音频')
    // 已知的游客档位从该档起向下尝试；无对应档位时沿用最高可用档。
    const requestedIndex = info.candidates.findIndex((item) => item.level === quality)
    const candidates = info.candidates.slice(Math.max(requestedIndex, 0))
    const ranks = new Map<string, number>()
    return candidates.map((item) => {
      if (!ranks.has(item.level)) ranks.set(item.level, ranks.size)
      return {
        source: 'bilibili' as const,
        track,
        quality: { id: item.level, label: item.quality, rank: ranks.get(item.level)!, bitrate: item.br },
        url: item.url,
        trial: false,
        expiresAt: info.expiresAt,
      }
    })
  },
  getLyrics: async () => [],
}
