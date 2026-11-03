import { BilibiliMusicService } from '../lib/bilibili-service'
import { createLegacyProvider } from './legacy-provider-adapter'
import { PlaybackUnavailableError, type QualityOption } from './types'

export const bilibiliService = new BilibiliMusicService()

/** 只作跨源兜底：不进内容平台、搜索与我的库，不需要账号；音频走 /api/audio 代理补 Referer。 */
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
  async resolve(track, _quality, signal) {
    // 游客只有三档 AAC，一次给出全部节点（高档在前），媒体出错时解析器按序换下一个。
    const info = await bilibiliService.getPlayInfo(track, signal)
    if (!info.candidates.length) throw new PlaybackUnavailableError('哔哩哔哩没有返回可播放的音频')
    const ranks = new Map<string, number>()
    return info.candidates.map((item) => {
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
