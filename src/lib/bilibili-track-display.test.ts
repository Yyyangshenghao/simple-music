import { describe, expect, it } from 'vitest'
import { bilibiliTrackDisplay } from './bilibili-track-display'
import type { Track } from '../types/domain'

const video: Track = {
  source: 'bilibili', provider: 'bilibili', type: 'song', id: 'BV1BZbSzZEGT',
  name: '【4K】周杰伦 - 晴天 MV', artist: '上传账号', artists: [],
  videoTitle: '【4K】周杰伦 - 晴天 MV', uploader: '上传账号',
}
const matched: Track = {
  source: 'netease', provider: 'netease', type: 'song', id: 186016,
  name: '晴天', artist: '周杰伦', artists: [{ id: 6452, name: '周杰伦' }],
}

describe('哔哩哔哩已识别身份展示', () => {
  it('使用平台规范歌名歌手，并保留视频原题和播放身份', () => {
    expect(bilibiliTrackDisplay(video, matched)).toEqual({
      name: '晴天', artist: '周杰伦', caption: video.videoTitle,
    })
    expect(video).toMatchObject({ source: 'bilibili', id: 'BV1BZbSzZEGT', artist: '上传账号' })
  })

  it('没有识别结果时沿用原题与 UP 主回退', () => {
    expect(bilibiliTrackDisplay(video)).toEqual({
      name: video.videoTitle, artist: 'UP 主 · 上传账号', caption: undefined,
    })
  })

  it('普通歌曲不受 B 站识别结果影响，同名原题不重复展示', () => {
    expect(bilibiliTrackDisplay(matched, matched)).toBeUndefined()
    expect(bilibiliTrackDisplay({ ...video, videoTitle: '晴天' }, matched)?.caption).toBeUndefined()
  })
})
