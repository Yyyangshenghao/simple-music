import { NeteaseMusicService } from '../lib/netease-music-service'
import { createLegacyProvider } from './legacy-provider-adapter'

export const neteaseProvider = createLegacyProvider({
  descriptor: {
    id: 'netease',
    label: '网易云',
    color: '#D43C33',
    colorSoft: 'rgba(212, 60, 51, 0.4)',
    iconKey: 'netease',
    defaultEnabled: true,
  },
  service: new NeteaseMusicService(),
  surfaces: [
    {
      id: 'netease:daily-songs',
      source: 'netease',
      kind: 'daily-tracks',
      title: '每日推荐',
      subtitle: '每天更新',
      presentation: 'hero',
      refresh: 'daily',
      auth: 'required',
    },
    {
      id: 'netease:radar',
      source: 'netease',
      kind: 'radar',
      title: '私人雷达',
      subtitle: '根据你的口味',
      presentation: 'hero',
      refresh: 'daily',
      auth: 'required',
    },
    {
      id: 'netease:playlist-feed',
      source: 'netease',
      kind: 'playlist-feed',
      title: '网易云推荐歌单',
      presentation: 'stack',
      refresh: 'paged',
      auth: 'optional',
    },
  ],
})
