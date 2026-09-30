import { DOMParser } from '@xmldom/xmldom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { parseAppleLyrics } from './apple-lyric-parser'
beforeEach(() => vi.stubGlobal('DOMParser', DOMParser))
afterEach(() => vi.unstubAllGlobals())
const xml = (body: string) => `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${body}</div></body></tt>`

describe('Apple TTML', () => {
  it.each(['你好世界', '<span>你好</span><span>世界</span>'])('行级歌词保留时间，不伪造逐字节奏', text => {
    const result = parseAppleLyrics(xml(`<p begin="10" end="12">${text}</p><p begin="20" end="22">下句</p>`))
    expect(result.wordLines[0].words).toEqual([])
    expect(result.wordLines[0].durationMs).toBe(2000)
  })

  it('部分正文没有音节时间时整行降级，不把行时间冒充字时间', () => {
    const result = parseAppleLyrics(xml('<p begin="1" end="5"><span begin="1" end="2">你</span>好</p>'))
    expect(result.main[0].text).toBe('你好')
    expect(result.wordLines[0].words).toEqual([])
  })

  it('保留音节时间和英文空格，不在相邻音节间插空格', () => {
    const result = parseAppleLyrics(xml('<p begin="01:02.000" end="01:04.000"><span begin="62s" end="62500ms">Hel</span><span begin="62.5" end="63">lo</span> <span begin="63" end="64">world</span></p>'))
    expect(result.main).toEqual([{ time: 62, text: 'Hello world' }])
    expect(result.wordLines[0]).toEqual({ time: 62, durationMs: 2000, words: [
      { text: 'Hel', startMs: 0, durationMs: 500 }, { text: 'lo ', startMs: 500, durationMs: 500 }, { text: 'world', startMs: 1000, durationMs: 1000 },
    ] })
  })
  it('忽略 TTML 排版换行，同时保留正文里的空格', () => {
    const result = parseAppleLyrics(xml(`<p begin="1" end="3">
      <span begin="1" end="2">你</span>
      <span begin="2" end="3">好</span>
    </p><p begin="4" end="6"><span begin="4" end="5">Hello</span> <span begin="5" end="6">world</span></p>`))
    expect(result.main.map(line => line.text)).toEqual(['你好', 'Hello world'])
    expect(result.wordLines[0].words.map(word => word.text)).toEqual(['你', '好'])
  })
  it('不会把不同命名空间前缀的翻译混进原文', () => {
    const result = parseAppleLyrics(xml('<p begin="1" end="3"><span begin="1" end="3">Hello</span><span xmlns:m="http://www.w3.org/ns/ttml#metadata" m:role="x-translation">你好</span></p>'))
    expect(result.main[0].text).toBe('Hello')
    expect(result.aligned).toEqual([{ time: 1, text: '你好' }])
  })
  it('把 TTML 自带的翻译和音译按原文行对齐', () => {
    const result = parseAppleLyrics(xml('<p begin="3" end="5">愛<span xmlns:m="http://www.w3.org/ns/ttml#metadata" m:role="x-translation">爱</span><span xmlns:m="http://www.w3.org/ns/ttml#metadata" m:role="x-roman">ai</span></p><p begin="6" end="8">歌</p>'))
    expect(result.main.map(line => line.text)).toEqual(['愛', '歌'])
    expect(result.aligned).toEqual([{ time: 3, text: '爱' }, { time: 6, text: '' }])
    expect(result.roma).toEqual([{ time: 3, text: 'ai' }, { time: 6, text: '' }])
  })
  it('解码文本实体并保留中文逐字和嵌套音节', () => {
    const result = parseAppleLyrics(xml('<p begin="2" end="4"><span><span begin="2" end="3">你</span></span><span begin="3" end="4">&amp;我</span></p>'))
    expect(result.main[0].text).toBe('你&我')
    expect(result.wordLines[0].words).toHaveLength(2)
  })
  it('没有行时间时使用字时间，拒绝无时间正文与实体声明', () => {
    expect(parseAppleLyrics(xml('<p><span begin="3" end="4">词</span></p>')).main[0].time).toBe(3)
    expect(parseAppleLyrics(xml('<p>无时间</p>')).main).toEqual([])
    expect(parseAppleLyrics('<!DOCTYPE tt><tt/>').main).toEqual([])
  })
})
