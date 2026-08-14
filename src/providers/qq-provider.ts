import { QQMusicService } from '../lib/qq-music-service'
import { createLegacyProvider } from './legacy-provider-adapter'

export const qqProvider = createLegacyProvider({
  descriptor: {
    id: 'qq',
    label: 'QQ音乐',
    color: '#0DAF52',
    colorSoft: 'rgba(13, 175, 82, 0.4)',
    iconKey: 'qq',
    defaultEnabled: true,
  },
  service: new QQMusicService(),
  surfaces: [
    {
      id: 'qq:radio',
      source: 'qq',
      kind: 'radio',
      title: '猜你喜欢',
      subtitle: '根据你的口味',
      presentation: 'hero',
      refresh: 'stream',
      auth: 'required',
    },
    {
      id: 'qq:radar',
      source: 'qq',
      kind: 'radar',
      title: '私人雷达',
      subtitle: '根据你的口味',
      presentation: 'hero',
      refresh: 'session',
      auth: 'required',
    },
    {
      id: 'qq:playlist-feed',
      source: 'qq',
      kind: 'playlist-feed',
      title: 'QQ音乐推荐歌单',
      presentation: 'stack',
      refresh: 'paged',
      auth: 'none',
    },
  ],
})
