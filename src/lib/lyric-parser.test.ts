import { describe, it, expect } from 'vitest'
import { parseLrc, alignTranslation, parseYrc } from './lyric-parser'

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

  it('skips whitespace-only tokens and lines without words', () => {
    expect(parseYrc('[0,500](0,250,0) (250,250,0)\n[500,500]')).toEqual([])
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
