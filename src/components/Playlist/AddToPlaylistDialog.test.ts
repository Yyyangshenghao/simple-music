import { describe, expect, it, vi } from 'vitest'

vi.mock('../../providers/registry', () => ({ providerFor: (source: string) => ({ playlistWriter: source === 'apple' ? undefined : { mutatePlatformPlaylist: vi.fn() } }) }))
const { platformTarget } = await import('./AddToPlaylistDialog')

describe('加入歌单弹窗的平台页签', () => {
  it('跟随当前内容平台，来源一致时可写', () => {
    expect(platformTarget('netease', ['netease'], true)).toEqual({ source: 'netease', label: '网易云歌单', unavailable: '' })
    expect(platformTarget('qq', [], true)).toEqual({ source: 'qq', label: 'QQ音乐歌单', unavailable: '' })
  })

  it('混入其他平台歌曲、离线、未登录或平台不可写时说明原因', () => {
    expect(platformTarget('netease', ['netease', 'qq'], true).unavailable).toContain('只能把网易云的歌曲加入网易云歌单')
    expect(platformTarget('qq', ['local'], true).unavailable).toContain('其他平台的歌曲请加入应用歌单')
    expect(platformTarget('netease', ['netease'], false)).toMatchObject({ source: null, unavailable: '离线列表只能加入应用歌单' })
    expect(platformTarget(null, ['netease'], true)).toMatchObject({ source: null, label: '平台歌单', unavailable: '登录音乐平台后可加入平台歌单' })
    expect(platformTarget('apple', ['apple'], true)).toMatchObject({ source: null, label: 'Apple Music歌单', unavailable: 'Apple Music暂不支持加入平台歌单' })
  })
})
