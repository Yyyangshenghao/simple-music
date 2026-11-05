import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleQQSongComments } from './qq-client'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const response = (body: unknown) => ({ status: 200, text: async () => JSON.stringify(body) })
const comment = (id: number, content = `评论 ${id}`) => ({ commentid: String(id), rootcommentcontent: content, time: 1_700_000_000 })

describe('QQ 歌曲评论', () => {
  it('热评和最新首屏分开，翻页偏移不受空正文过滤影响', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ code: 0,
      hot_comment: { commentlist: [comment(100)] }, comment: { commenttotal: '12',
        commentlist: Array.from({ length: 6 }, (_, index) => comment(index + 1, index === 0 ? '' : undefined)) },
    })).mockResolvedValueOnce(response({ code: 0,
      hot_comment: { commentlist: [comment(100)] }, comment: { commenttotal: 12, commentlist: [comment(7)] },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await handleQQSongComments('', '4835221', '', 6, 0)
    expect(first).toMatchObject({ id: '4835221', total: 12, comments: [{ id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }, { id: '6' }], hotComments: [{ id: '100' }], nextOffset: 6 })
    expect((first.comments as Record<string, unknown>[])[0].time).toBe(1_700_000_000_000)
    const second = await handleQQSongComments('', '4835221', '', 6, 6)
    expect(second).toMatchObject({ comments: [{ id: '7' }], hotComments: [], nextOffset: undefined })
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('pagenum'))).toEqual(['0', '1'])
  })

  it('MID通过歌曲详情补真实数字id，不从字符串截取数字', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ songinfo: { data: { track_info: { id: 4835221, mid: '0039abc12', name: '歌曲' } } } }))
      .mockResolvedValueOnce(response({ code: 0, comment: { commenttotal: 0, commentlist: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await handleQQSongComments('', '0039abc12', '0039abc12', 20, 0)).toMatchObject({ id: '4835221', total: 0, comments: [], hotComments: [] })
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('topid')).toBe('4835221')
  })

  it.each(['0039abc12', '9e3', '9007199254740993', '0'])('只有错误id且没有mid时拒绝请求 %s', async id => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(handleQQSongComments('', id, '', 20, 0)).rejects.toThrow('MISSING_QQ_SONG_ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('未知总数不虚构为当前页数量，空终页停止', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ code: 0, comment: {
      commentlist: Array.from({ length: 6 }, (_, index) => comment(index + 1)),
    } })).mockResolvedValueOnce(response({ code: 0, comment: { commentlist: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await handleQQSongComments('', '4835221', '', 6, 0)).toMatchObject({ total: null, nextOffset: 6 })
    expect(await handleQQSongComments('', '4835221', '', 6, 6)).toMatchObject({ total: null, comments: [], nextOffset: undefined })
  })

  it('评论转义文字和换行按纯文本返回', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ code: 0, comment: {
      commenttotal: 1, commentlist: [comment(1, '你&amp;我<br/>下一行')],
    } })))
    expect(await handleQQSongComments('', '4835221', '', 20, 0)).toMatchObject({ comments: [{ content: '你&我\n下一行' }] })
  })

  it.each([{ code: 1, comment: { commentlist: [] } }, { code: 0 }, { code: 0, comment: { commentlist: null } }])('业务失败或无效列表不伪装空评论 %j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)))
    await expect(handleQQSongComments('', '4835221', '', 20, 0)).rejects.toThrow('QQ_SONG_COMMENTS_FAILED')
  })
})
