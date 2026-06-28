import { describe, it, expect } from 'vitest'
import { parseLrc, alignTranslation } from './lyric-parser'

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
