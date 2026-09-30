import { describe, it, expect } from 'vitest'
import { parseLrc, alignTranslation, parseYrc, parseQrc, tokenizeForTiming, estimateWordTiming } from './lyric-parser'

describe('parseLrc', () => {
  it('parses timestamped lines', () => {
    expect(parseLrc('[00:01.50]hello\n[00:03.00]world')).toEqual([
      { time: 1.5, text: 'hello' },
      { time: 3, text: 'world' }
    ])
  })

  it('ignores metadata and empty lines', () => {
    expect(parseLrc('[ar:foo]\n[ti:bar]\n[00:00.00]hi\n\n[00:02.00]   ')).toEqual([{ time: 0, text: 'hi' }])
  })

  it('expands multi-timestamp lines and sorts', () => {
    expect(parseLrc('[00:05.00][00:01.00]repeat')).toEqual([
      { time: 1, text: 'repeat' },
      { time: 5, text: 'repeat' }
    ])
  })

  it('handles single-digit fraction as tenths', () => {
    expect(parseLrc('[01:02.5]x')).toEqual([{ time: 62.5, text: 'x' }])
  })
})

describe('parseYrc', () => {
  it('parses real yrc lines: absolute word start converted to line-relative offset', () => {
    const yrc = [
      '{"t":0,"c":[{"tx":"作词: "},{"tx":"某人"}]}',
      '[1000,2000](1000,300,0)你(1300,700,0)好(2000,1000,0)世界',
    ].join('\n')
    expect(parseYrc(yrc)).toEqual([
      {
        time: 1,
        durationMs: 2000,
        words: [
          { text: '你', startMs: 0, durationMs: 300 },
          { text: '好', startMs: 300, durationMs: 700 },
          { text: '世界', startMs: 1000, durationMs: 1000 },
        ],
      },
    ])
  })

  it('keeps multi-char english tokens with trailing spaces', () => {
    const yrc = '[100,900](100,300,0)EAS (400,300,0)MUSIC (700,300,0)LTD'
    const [line] = parseYrc(yrc)
    expect(line.words.map((w) => w.text)).toEqual(['EAS ', 'MUSIC ', 'LTD'])
    expect(line.words[1]).toEqual({ text: 'MUSIC ', startMs: 300, durationMs: 300 })
  })

  it('保留独立空格和文本括号，避免原生主歌词丢字', () => {
    const [line] = parseYrc('[1000,1000](1000,300,0)Hello(1300,100,0) (1400,600,0)(world)')
    expect(line.words.map(word => word.text).join('')).toBe('Hello (world)')
    expect(line.words[2].startMs).toBe(400)
  })

  it('skips whitespace-only tokens and lines without words', () => {
    expect(parseYrc('[0,500](0,250,0) (250,250,0)\n[500,500]')).toEqual([])
  })
})

describe('tokenizeForTiming', () => {
  it('keeps latin words whole (with trailing space) so flex wrap breaks at spaces', () => {
    expect(tokenizeForTiming("Don't stop me now")).toEqual(["Don't ", 'stop ', 'me ', 'now'])
  })

  it('splits CJK per character', () => {
    expect(tokenizeForTiming('你好世界')).toEqual(['你', '好', '世', '界'])
  })

  it('handles mixed CJK and latin', () => {
    expect(tokenizeForTiming('唱 hello 吧')).toEqual(['唱', ' ', 'hello ', '吧'])
  })
})

describe('estimateWordTiming', () => {
  it('distributes line duration by token char count, monotonically increasing', () => {
    const [line] = estimateWordTiming([
      { time: 0, text: 'go home' },
      { time: 2, text: 'x' },
    ])
    expect(line.durationMs).toBe(2000)
    expect(line.words.map((w) => w.text)).toEqual(['go ', 'home'])
    expect(line.words[0].startMs).toBe(0)
    // 'go ' 占 3/7 行时长
    expect(line.words[1].startMs).toBe(Math.round((3 / 7) * 2000))
  })

  it('returns empty words for empty text', () => {
    const [line] = estimateWordTiming([{ time: 0, text: '' }])
    expect(line.words).toEqual([])
  })
})

describe('alignTranslation', () => {
  it('matches translation by nearest time within tolerance', () => {
    const main = [
      { time: 1, text: 'hello' },
      { time: 3, text: 'world' }
    ]
    const tr = [
      { time: 1.1, text: '你好' },
      { time: 5, text: '远' }
    ]
    expect(alignTranslation(main, tr)).toEqual([
      { time: 1, text: '你好' },
      { time: 3, text: '' }
    ])
  })
})


describe('parseQrc', () => {
  it('保留英文空格，并将歌曲绝对时间转为句内偏移，保留停顿', () => {
    expect(parseQrc('[1000,2400]Hello (1100,400)world(2200,700)')).toEqual([{
      time: 1, durationMs: 2400, words: [
        { text: 'Hello ', startMs: 100, durationMs: 400 },
        { text: 'world', startMs: 1200, durationMs: 700 },
      ],
    }])
  })

  it('解析 XML 明文及转义字符，保留歌词中的括号', () => {
    expect(parseQrc('<QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="[1000,1000]You &amp; (me)(1000,1000)&#10;[3000,500]好(3000,500)"/></LyricInfo></QrcInfos>'))
      .toEqual([
        { time: 1, durationMs: 1000, words: [{ text: 'You & (me)', startMs: 0, durationMs: 1000 }] },
        { time: 3, durationMs: 500, words: [{ text: '好', startMs: 0, durationMs: 500 }] },
      ])
  })

  it.each(['密文a7c310', '[00:01.00]普通歌词', '[1000,1000]无逐字数据', '[1000,1000]残缺(1000,500)文本'])('非逐字或不完整数据安全降级：%s', text => {
    expect(parseQrc(text)).toEqual([])
  })
})
