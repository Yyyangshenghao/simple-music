import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  kugouCover,
  kugouGet,
  kugouSongQualities,
  kugouSongUrl,
  kugouTiersFrom,
  kugouTrackUrlKey,
  mapKugouListSong,
  mapKugouSearchSong,
  normalizeKugouHash,
  resetKugouClientState,
  splitKugouFilename,
} from './kugou-client'

const HASH = '936bfc076ea0e42e62ea66b8377110d4'
const HASH_320 = '7c4f6c998383aad495f8cdf0e8bf793b'
const HASH_SQ = '0a69169202de95aaf24a9944ccf0730d'
const CLIP = 'bbb8430047adcbafd1920315b38ddc0a'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const songInfo = (extra: Record<string, unknown> = {}) => json({
  hash: HASH.toUpperCase(), songName: '孤勇者', author_name: '陈奕迅', authors: [{ author_id: 420, author_name: '陈奕迅' }],
  albumid: 50223611, album_img: 'http://imge.kugou.com/stdmusic/{size}/a.jpg', timeLength: 256, privilege: 10,
  extra: { '320hash': HASH_320.toUpperCase(), sqhash: HASH_SQ.toUpperCase() },
  trans_param: { hash_offset: { clip_hash: CLIP.toUpperCase() } },
  ...extra,
})
const tracker = (url: string) => json({ status: 1, bitRate: 128000, url: [url] })
const blocked = () => json({ status: 2 })

/** 按 URL 路由的上游假实现：详情一次，trackercdn 按 hash 决定能否取到。 */
function upstream(playable: Record<string, string>, info = songInfo) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.hostname === 'm.kugou.com') return info()
    if (url.hostname === 'trackercdn.kugou.com') {
      const hash = url.searchParams.get('hash') ?? ''
      expect(url.searchParams.get('key')).toBe(kugouTrackUrlKey(hash))
      return playable[hash] ? tracker(playable[hash]) : blocked()
    }
    throw new Error(`unexpected ${url}`)
  })
}

beforeEach(() => resetKugouClientState())

describe('酷狗游客接口映射', () => {
  it('hash 统一小写，非法值丢弃', () => {
    expect(normalizeKugouHash(HASH.toUpperCase())).toBe(HASH)
    expect(normalizeKugouHash('../etc/passwd')).toBe('')
  })

  it('封面替换尺寸占位并升级 https', () => {
    expect(kugouCover('http://imge.kugou.com/stdmusic/{size}/a.jpg')).toBe('https://imge.kugou.com/stdmusic/480/a.jpg')
    expect(kugouCover(undefined)).toBe('')
  })

  it('列表 filename 拆成歌手与歌名', () => {
    expect(splitKugouFilename('周杰伦 - 晴天')).toEqual({ artist: '周杰伦', name: '晴天' })
    expect(splitKugouFilename('A - B - C')).toEqual({ artist: 'A', name: 'B - C' })
    expect(splitKugouFilename('晴天')).toEqual({ artist: '', name: '晴天' })
  })

  it('搜索结果映射为毫秒时长、带歌手 ID 与各档 hash', () => {
    const song = mapKugouSearchSong({
      FileHash: HASH.toUpperCase(), SongName: '<em>孤勇者</em>', SingerName: '陈奕迅', Singers: [{ id: 420, name: '陈奕迅' }],
      AlbumID: '50223611', AlbumName: '孤勇者', Duration: 256, Privilege: 10, Image: 'http://imge.kugou.com/stdmusic/{size}/a.jpg',
      HQFileHash: HASH_320, SQFileHash: HASH_SQ, MixSongID: '348254775', trans_param: { hash_offset: { clip_hash: CLIP } },
    })
    expect(song).toMatchObject({
      provider: 'kugou', source: 'kugou', type: 'song', id: HASH, name: '孤勇者', artist: '陈奕迅',
      artists: [{ id: '420', name: '陈奕迅' }], artistId: '420', albumId: '50223611', duration: 256000, fee: 10,
      hash320: HASH_320, hashSq: HASH_SQ, clipHash: CLIP, cover: 'https://imge.kugou.com/stdmusic/480/a.jpg',
    })
    expect(mapKugouSearchSong({ FileHash: 'bad', SongName: 'x' })).toBeNull()
  })

  it('列表歌曲缺歌手 ID 时 id 为 null，不生成歌手页入口', () => {
    const song = mapKugouListSong({ hash: HASH, filename: '陈奕迅、张杰 - 孤勇者', duration: 256, privilege: 0 }, { album: '专辑', albumId: '1' })
    expect(song).toMatchObject({ name: '孤勇者', artist: '陈奕迅、张杰', album: '专辑', albumId: '1', duration: 256000 })
    expect(song?.artists).toEqual([{ id: null, name: '陈奕迅' }, { id: null, name: '张杰' }])
    expect(song?.artistId).toBeUndefined()
  })

  it('请求档位决定回退起点', () => {
    expect(kugouTiersFrom('max').map(t => t.level)).toEqual(['lossless', 'exhigh', 'standard'])
    expect(kugouTiersFrom('exhigh').map(t => t.level)).toEqual(['exhigh', 'standard'])
    expect(kugouTiersFrom('standard').map(t => t.level)).toEqual(['standard'])
  })
})

describe('酷狗上游安全边界', () => {
  it('只请求固定域名', async () => {
    const fetchMock = vi.fn()
    await expect(kugouGet('http://127.0.0.1:35530/api/local/scan', fetchMock as typeof fetch)).rejects.toThrow('UNSAFE_UPSTREAM')
    await expect(kugouGet('http://evil.example.com/a', fetchMock as typeof fetch)).rejects.toThrow('UNSAFE_UPSTREAM')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trackercdn 返回的非公网地址不作为播放地址', async () => {
    const fetchMock = upstream({ [HASH]: 'http://192.168.1.2/a.mp3' })
    const result = await kugouSongUrl(HASH, 'standard', fetchMock as typeof fetch)
    expect(result.url).toBe('')
  })
})

describe('酷狗播放地址', () => {
  it('免费曲从请求档位逐档向下，返回最高可得档并保留下一档候选', async () => {
    const fetchMock = upstream({ [HASH_320]: 'http://fs.kugou.com/320.mp3', [HASH]: 'http://fs.kugou.com/128.mp3' })
    const result = await kugouSongUrl(HASH, 'max', fetchMock as typeof fetch)
    expect(result).toMatchObject({ url: 'http://fs.kugou.com/320.mp3', level: 'exhigh', trial: false })
    expect((result.candidates as unknown[]).length).toBe(2)
  })

  it('付费曲拿不到完整文件时取 60 秒试听并标记 trial', async () => {
    const fetchMock = upstream({ [CLIP]: 'http://fs.kugou.com/clip.mp3' })
    const result = await kugouSongUrl(HASH, 'max', fetchMock as typeof fetch)
    expect(result).toMatchObject({ url: 'http://fs.kugou.com/clip.mp3', trial: true, quality: '试听' })
  })

  it('完整文件与试听都没有时返回受限提示', async () => {
    const result = await kugouSongUrl(HASH, 'max', upstream({}) as typeof fetch)
    expect(result.url).toBe('')
    expect(result.restriction).toEqual({ message: '酷狗音乐需要会员或购买，游客无法播放' })
  })

  it('音质菜单只列出游客能取到完整文件的档位，详情短期复用', async () => {
    const fetchMock = upstream({ [HASH]: 'http://fs.kugou.com/128.mp3' })
    expect(await kugouSongQualities(HASH, fetchMock as typeof fetch)).toEqual([{ level: 'standard', label: '标准', br: 128000 }])
    await kugouSongUrl(HASH, 'standard', fetchMock as typeof fetch)
    expect(fetchMock.mock.calls.filter(([input]) => new URL(String(input)).hostname === 'm.kugou.com')).toHaveLength(1)
  })

  it('详情或高档探测出错时退回 128 档；全部失败才按上游故障抛出', async () => {
    const flaky = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'm.kugou.com') throw new Error('timeout')
      return url.searchParams.get('hash') === HASH ? tracker('http://fs.kugou.com/128.mp3') : blocked()
    })
    expect(await kugouSongUrl(HASH, 'max', flaky as typeof fetch)).toMatchObject({ url: 'http://fs.kugou.com/128.mp3', level: 'standard' })
    const down = vi.fn(async () => { throw new Error('offline') })
    await expect(kugouSongUrl(HASH, 'max', down as typeof fetch)).rejects.toThrow('offline')
  })

  it('不跟随上游重定向', async () => {
    const fetchMock = vi.fn(async () => json({}))
    await kugouGet('http://mobilecdn.kugou.com/api/v3/search/hot', fetchMock as typeof fetch)
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }))
  })

  it('非法 hash 不请求上游', async () => {
    const fetchMock = vi.fn()
    expect(await kugouSongUrl('x', 'max', fetchMock as typeof fetch)).toMatchObject({ url: '', error: 'MISSING_HASH' })
    expect(await kugouSongQualities('x', fetchMock as typeof fetch)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
