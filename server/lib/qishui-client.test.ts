import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractRouterData,
  fetchQishuiAlbum,
  fetchQishuiListeningModes,
  fetchQishuiPlaylist,
  fetchQishuiStreams,
  mapQishuiTrack,
  pickQishuiStreams,
  qishuiImageUrl,
  resetQishuiState,
  searchQishuiTracks,
  type QishuiFetch,
} from './qishui-client'

const cover = { uri: 'tos-cn/abc', urls: ['https://p3-luna.douyinpic.com/img/'] }
const rawTrack = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: '晴天', duration: 237336,
  artists: [{ id: '11', name: '歌手甲' }, { id: '12', name: '歌手乙' }],
  album: { id: '21', name: '专辑', url_cover: cover },
  ...extra,
})
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

function routed(routes: Record<string, () => Response>): QishuiFetch & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find(prefix => url.startsWith(prefix))
    if (!key) throw new Error(`unexpected ${url}`)
    return routes[key]()
  })
}

const playInfo = (duration: number, auth = '') => json({ Result: { Data: { PlayInfoList: [
  { Quality: 'medium', Bitrate: 65000, Duration: duration, MainPlayUrl: 'https://v11-luna.douyinvod.com/m', PlayAuth: auth },
  { Quality: 'higher', Bitrate: 129000, Duration: duration, MainPlayUrl: 'https://v11-luna.douyinvod.com/h', PlayAuth: auth },
  { Quality: 'highest', Bitrate: 257000, Duration: duration, MainPlayUrl: 'https://v11-luna.douyinvod.com/x', PlayAuth: auth },
] } } })

const seo = (track: unknown, playerUrl = 'https://vod-luna.douyin.com/?Action=GetPlayInfo&sig=1') => json({
  seo_track: { track, lyric: { content: '[1000,800]<0,400,0>故<400,400,0>事' } },
  track_player: { url_player_info: playerUrl },
})

beforeEach(() => resetQishuiState())

describe('汽水音乐游客接口', () => {
  it('曲目映射保留毫秒时长、多歌手与会员标记，拒绝非数字 ID', () => {
    const track = mapQishuiTrack(rawTrack('7676337516358617115', { label_info: { only_vip_playable: true } }))
    expect(track).toMatchObject({
      source: 'qishui', provider: 'qishui', id: '7676337516358617115', duration: 237336,
      artist: '歌手甲 / 歌手乙', album: '专辑', vipOnly: true,
      cover: 'https://p3-luna.douyinpic.com/img/tos-cn/abc~c5_300x300.jpg',
    })
    expect(mapQishuiTrack(rawTrack('../x'))).toBeNull()
    expect(qishuiImageUrl({ uri: 'a', urls: ['http://insecure/'] })).toBe('')
  })

  it('用汽水返回的图片模板生成指定大小的歌单封面', () => {
    expect(qishuiImageUrl({
      uri: 'tos-cn-i-b829550vbb/cover',
      urls: ['https://p3-luna.douyinpic.com/img/'],
      template_prefix: 'tplv-b829550vbb',
    }, 512)).toBe('https://p3-luna.douyinpic.com/img/tos-cn-i-b829550vbb/cover~tplv-b829550vbb-resize:512:512.image')
  })

  it('搜索去重并按 limit 截断（上游忽略 count）', async () => {
    const data = ['1', '1', '2', '3'].map(id => ({ entity: { track: rawTrack(id) } }))
    const fetchImpl = routed({ 'https://api.qishui.com/luna/search/track': () => json({ result_groups: [{ data }] }) })
    const songs = await searchQishuiTracks('晴天', 2, fetchImpl)
    expect(songs.map(song => song.id)).toEqual(['1'])
    expect(String(fetchImpl.mock.calls[0][0])).toContain('device_platform=web')
  })

  it('听歌模式保留官方场景顺序，去掉重复、异常与涉及速率的场景', async () => {
    const scene = (scene_mode_id: unknown, text: string, sub_queue_type?: string) => ({
      type: 'scene_mode', text, entity: { feed_scene_mode: { scene_mode_id, sub_queue_type } },
      url_info: scene_mode_id === 25 ? { ...cover, template_prefix: 'tplv-b829550vbb' } : undefined,
    })
    const fetchImpl = routed({ 'https://api.qishui.com/luna/pc/feed/mode': () => json({
      feed_mode_block: [
        { type: 'unknown', feed_mode: [scene(1, '其他栏目')] },
        { type: 'scene_music', feed_mode: [null, scene(25, '轻音乐'), scene(25, '重复'),
          { ...scene('32', ' 古典 '), url_info: { uri: 'broken', urls: 'https://example.com/' } }, scene('a', '异常'), scene(14, '沉浸0.8x', 'scene_mode_slow_motion')] },
      ],
    }) })
    await expect(fetchQishuiListeningModes(fetchImpl)).resolves.toEqual([
      { id: 'default', label: '默认模式' }, { id: 'familiar', label: '熟悉模式' }, { id: 'fresh', label: '新鲜模式' },
      { id: '25', label: '轻音乐', icon: 'https://p3-luna.douyinpic.com/img/tos-cn/abc~tplv-b829550vbb-resize:96:96.image' },
      { id: '32', label: '古典' },
    ])
  })

  it('免费曲返回整曲明文流，会员曲标为试听；带 PlayAuth 的加密流不返回', async () => {
    const free = routed({
      'https://beta-luna.douyin.com/': () => seo(rawTrack('100')),
      'https://vod-luna.douyin.com/': () => playInfo(237.336),
    })
    const streams = await fetchQishuiStreams('100', free)
    expect(streams.map(item => [item.level, item.trial])).toEqual([['exhigh', false], ['higher', false], ['standard', false]])
    expect(pickQishuiStreams(streams, 'higher').map(item => item.level)).toEqual(['higher', 'standard'])
    expect(pickQishuiStreams(streams, 'max')[0].level).toBe('exhigh')

    resetQishuiState()
    const vip = routed({
      'https://beta-luna.douyin.com/': () => seo(rawTrack('100')),
      'https://vod-luna.douyin.com/': () => playInfo(60.001),
    })
    expect((await fetchQishuiStreams('100', vip)).every(item => item.trial)).toBe(true)

    resetQishuiState()
    const encrypted = routed({
      'https://beta-luna.douyin.com/': () => seo(rawTrack('100')),
      'https://vod-luna.douyin.com/': () => playInfo(237.336, 'spade_xxx'),
    })
    expect(await fetchQishuiStreams('100', encrypted)).toEqual([])
  })

  it('上游返回的播放信息地址不在汽水点播域名时拒绝请求', async () => {
    const fetchImpl = routed({ 'https://beta-luna.douyin.com/': () => seo(rawTrack('100'), 'https://evil.example.com/x') })
    await expect(fetchQishuiStreams('100', fetchImpl)).rejects.toThrow('UNSAFE_UPSTREAM')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('歌单按游标翻页直到空页或游标重复', async () => {
    const pages = [
      { playlist: { id: '9', title: '歌单', count_tracks: 3, owner: { nickname: '谁' } }, next_cursor: '2', media_resources: [
        { type: 'track', entity: { track_wrapper: { track: rawTrack('1') } } },
        { type: 'track', entity: { track_wrapper: { track: rawTrack('2') } } },
      ] },
      { next_cursor: '3', media_resources: [{ type: 'track', entity: { track_wrapper: { track: rawTrack('3') } } }] },
      { next_cursor: '3', media_resources: [] },
    ]
    let call = 0
    const fetchImpl = routed({ 'https://api.qishui.com/luna/pc/playlist/detail': () => json(pages[call++]) })
    const { playlist, tracks } = await fetchQishuiPlaylist('9', fetchImpl)
    expect(playlist).toMatchObject({ id: '9', name: '歌单', creator: '谁', source: 'qishui' })
    expect(tracks.map(track => track.id)).toEqual(['1', '2', '3'])
  })

  it('分享页数据按括号配对截取，字符串里的括号不影响', async () => {
    const page = { loaderData: { album_page: { albumInfo: { id: '21', name: '专辑 {特别版}', artists: [{ id: '11', name: '歌手甲' }], count_tracks: 1, url_cover: cover }, trackList: [rawTrack('1')] } } }
    const html = `<script>window._ROUTER_DATA = ${JSON.stringify(page)};window.x={}</script>`
    expect(extractRouterData(html)).toEqual(page)
    expect(extractRouterData('<html></html>')).toBeNull()
    const fetchImpl = routed({ 'https://www.qishui.com/share/album': () => new Response(html) })
    const { album, tracks } = await fetchQishuiAlbum('21', fetchImpl)
    expect(album).toMatchObject({ type: 'album', name: '专辑 {特别版}', creator: '歌手甲' })
    expect(tracks).toHaveLength(1)
  })
})

describe('汽水音乐音频代理', () => {
  it('抖音点播 CDN 换用汽水 Referer，网易默认 Referer 会被拒绝', async () => {
    const { audioProxyHeadersFor } = await import('./netease-client')
    expect(audioProxyHeadersFor('https://v11-luna.douyinvod.com/x/', 'bytes=0-').Referer).toBe('https://www.qishui.com/')
    expect(audioProxyHeadersFor('https://m701.music.126.net/a.mp3', '').Referer).toBe('https://music.163.com/')
  })
})
