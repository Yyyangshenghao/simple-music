import { describe, expect, it } from 'vitest'
import type { Track } from '../types/domain'
import { bilibiliCanonicalTrack, bilibiliIdentityKey, bilibiliMatchQueries, rankBilibiliSongCandidates, selectBilibiliSongMatch } from './bilibili-song-match'

const song = (overrides: Partial<Track> = {}): Track => ({
  provider: 'netease', source: 'netease', type: 'song', id: 'n-1', name: '晴天',
  artist: '周杰伦', artists: [{ id: 1, name: '周杰伦' }], duration: 269_000, album: '叶惠美', ...overrides,
})
const video = (title = '【4K】周杰伦 - 晴天 MV', overrides: Partial<Track> = {}): Track => ({
  provider: 'bilibili', source: 'bilibili', type: 'song', id: 'BV1xx', bvid: 'BV1xx', name: title, videoTitle: title,
  artist: '音乐搬运工', artists: [{ id: null, name: '音乐搬运工' }], uploader: '音乐搬运工', duration: 269_000, ...overrides,
})

describe('哔哩哔哩歌曲身份识别', () => {
  it.each(['【4K】周杰伦 - 晴天 MV', '【Hi-Res】《晴天》- 周杰伦', '晴天 - 周杰伦'])('按 %s 识别规范歌曲身份', title => {
    expect(selectBilibiliSongMatch(video(title), [song()])).toMatchObject({ track: { id: 'n-1', name: '晴天' } })
  })

  it('组合词共用查询预算，不逐个读法执行三级搜索，也不将 UP 主放进关键词', () => {
    expect(bilibiliMatchQueries(video())).toEqual(['周杰伦 晴天', '晴天 周杰伦', '周杰伦', '晴天'])
    expect(bilibiliMatchQueries(video('【Hi-Res】《晴天》- 周杰伦'))).toEqual(['晴天 周杰伦', '晴天'])
    expect(bilibiliMatchQueries(video('晴天'))).toEqual(['晴天'])
    expect(bilibiliMatchQueries(video('甲 - 乙 - 丙'))).toHaveLength(4)
  })

  it('标题只有歌名时通过精确标题、接近时长与唯一歌手识别，UP 主不当歌手', () => {
    expect(selectBilibiliSongMatch(video('《晴天》'), [song()])).toMatchObject({ track: { artist: '周杰伦' }, score: 90 })
    expect(selectBilibiliSongMatch(video('晴天'), [song({ duration: 270_501 })])).toBeNull()
    expect(selectBilibiliSongMatch(video('晴天了'), [song()])).toBeNull()
  })

  it('同名不同歌手都接近时长时拒绝猜测，即使某一候选分数稍高', () => {
    const other = song({ id: 'n-other', artist: '其他歌手', artists: [{ id: 2, name: '其他歌手' }], duration: 270_500 })
    expect(selectBilibiliSongMatch(video('晴天'), [song(), other])).toBeNull()
  })

  it('正反读法都存在可靠歌曲时视为歧义', () => {
    const reverse = song({ id: 'n-reverse', name: '周杰伦', artist: '晴天', artists: [{ id: 2, name: '晴天' }] })
    expect(selectBilibiliSongMatch(video(), [song(), reverse])).toBeNull()
  })

  it('同录音不同专辑的重复发行保留为后备，不制造歧义', () => {
    const reissue = song({ id: 'n-reissue', album: '精选集' })
    expect(selectBilibiliSongMatch(video(), [song(), reissue])).toMatchObject({
      track: { id: 'n-1' }, alternates: [{ track: { id: 'n-reissue' } }],
    })
  })

  it.each(['《晴天》周杰伦 Live', '周杰伦 - 晴天 翻唱', '周杰伦 - 晴天 (加速版)', '周杰伦 - 晴天 纯伴奏'])('拒绝将 %s 套用录音室版本', title => {
    expect(selectBilibiliSongMatch(video(title), [song()])).toBeNull()
  })

  it('可靠时长是硬条件，超过三秒或 ISRC 冲突时拒配', () => {
    expect(selectBilibiliSongMatch(video(), [song({ duration: 272_000 })])).not.toBeNull()
    expect(selectBilibiliSongMatch(video(), [song({ duration: 272_001 })])).toBeNull()
    expect(selectBilibiliSongMatch(video(), [song({ duration: undefined })])).toBeNull()
    expect(selectBilibiliSongMatch(video(undefined, { duration: 0 }), [song()])).toBeNull()
    expect(selectBilibiliSongMatch(video(undefined, { isrc: 'CN-A' }), [song({ isrc: 'CN-B' })])).toBeNull()
    expect(selectBilibiliSongMatch(video(undefined, { isrc: 'CN-A' }), [song({ isrc: 'cn-a' })])).not.toBeNull()
  })

  it('简介可明确歌名歌手，但不能盖过标题中冲突的歌名', () => {
    const hint = { name: '晴天', artists: ['周杰伦'] }
    expect(selectBilibiliSongMatch(video('这首歌真好听', { bilibiliLyricHint: hint }), [song()])).not.toBeNull()
    expect(selectBilibiliSongMatch(video('《夜曲》', { bilibiliLyricHint: hint }), [song()])).toBeNull()
  })

  it('身份键跟随核验信息变化，不因 URL 或展示读法改变', () => {
    const origin = video()
    expect(bilibiliIdentityKey({ ...origin, url: 'https://temporary.test', cover: 'new', bilibiliDisplayReading: { name: '晴天', artists: ['周杰伦'] } })).toBe(bilibiliIdentityKey(origin))
    expect(bilibiliIdentityKey({ ...origin, duration: 270_000 })).not.toBe(bilibiliIdentityKey(origin))
    expect(bilibiliIdentityKey({ ...origin, bilibiliLyricHint: { name: '晴天', artists: ['周杰伦'] } })).not.toBe(bilibiliIdentityKey(origin))
    expect(bilibiliIdentityKey({ ...origin, isrc: 'CN-A' })).not.toBe(bilibiliIdentityKey(origin))
    expect(bilibiliIdentityKey({ ...origin, lyricSearchVersionTitle: '晴天 Live' })).not.toBe(bilibiliIdentityKey(origin))
  })

  it('规范身份只更新音乐元数据，不改变 BV、音频地址、视频时长与原题', () => {
    const origin = video(undefined, { url: 'https://bili.test/audio', duration: 269_200 })
    const result = bilibiliCanonicalTrack(origin, song({ isrc: 'CN-A' }))
    expect(result).toMatchObject({ source: 'bilibili', provider: 'bilibili', id: origin.id, bvid: origin.bvid,
      uploader: origin.uploader, videoTitle: origin.videoTitle, duration: 269_200, url: origin.url,
      name: '晴天', artist: '周杰伦', artists: [{ id: null, name: '周杰伦' }], isrc: 'CN-A' })
    expect(result.bilibiliLyricHint).toEqual({ name: '晴天', artists: ['周杰伦'] })
    expect(bilibiliMatchQueries(result)).toEqual(['晴天 周杰伦', '晴天'])
    expect(selectBilibiliSongMatch(result, [song({ source: 'qq', provider: 'qq', id: 'q-1' })])).toMatchObject({ track: { id: 'q-1' } })
  })
})


describe('B 站探测候选评分', () => {
  it('组合词无结果后仍能按每个可能的歌名探测', () => {
    expect(bilibiliMatchQueries(video())).toEqual(['周杰伦 晴天', '晴天 周杰伦', '周杰伦', '晴天'])
  })

  it('用曲库候选核验含宣传尾句的标题，不把宣传语当歌手', () => {
    expect(selectBilibiliSongMatch(video('周杰伦《晴天》每次听都回到那个夏天'), [song()])).toMatchObject({ track: { name: '晴天' } })
    expect(selectBilibiliSongMatch(video('《晴天》每次听都回到那个夏天'), [song()])).toBeNull()
  })

  it('MV 多出片头时只提供人工候选，版本冲突仍拒绝', () => {
    const origin = video('周杰伦《晴天》', { duration: 280_000 })
    expect(selectBilibiliSongMatch(origin, [song()])).toBeNull()
    expect(rankBilibiliSongCandidates(origin, [song()])).toMatchObject([{ track: { name: '晴天' } }])
    expect(rankBilibiliSongCandidates(origin, [song()])[0].score).toBeLessThan(80)
    expect(rankBilibiliSongCandidates(video('周杰伦《晴天》Live'), [song()])).toEqual([])
  })

  it('不同平台的同录音候选合并，不占用前三首名额', () => {
    const ranked = rankBilibiliSongCandidates(video('晴天'), [song(), song({ source: 'qq', provider: 'qq', id: 'q-1' }),
      song({ id: 'other', artist: '其他歌手', artists: [{ id: 2, name: '其他歌手' }] })])
    expect(ranked).toHaveLength(2)
  })
})


it('候选反查不能盖过明确歌名或按歌手名子串自动关联', () => {
  expect(selectBilibiliSongMatch(video('周杰伦《晴天之后》'), [song()])).toBeNull()
  expect(rankBilibiliSongCandidates(video('周杰伦《晴天之后》'), [song()])).toEqual([])
  expect(selectBilibiliSongMatch(video('周杰伦《晴天》'), [song({ artist: '周杰', artists: [{ id: 2, name: '周杰' }] })])).toBeNull()
})


it('候选反查不把英文艺人的连字符前缀当作完整署名', () => {
  expect(selectBilibiliSongMatch(video('Jay-Z《Song Title》'), [song({ name: 'Song Title', artist: 'Jay', artists: [{ id: 2, name: 'Jay' }] })])).toBeNull()
})

it('人工候选按片头片尾的时长偏差继续区分分数', () => {
  const ranked = rankBilibiliSongCandidates(video('周杰伦《晴天》', { duration: 280_000 }), [song(), song({ id: 'closer', duration: 274_000 })])
  expect(ranked[0].track.id).toBe('closer')
  expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
})
