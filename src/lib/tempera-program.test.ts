import { describe, it, expect } from 'vitest'
import { compileTemperaProgram, handoffSec, layoutShotText, releaseSpread, shotIndexAt, sliceLine, temperaComposition, visibleShots, wordMotion, type TemperaShot } from './tempera-program'
import type { StyleWord } from './lyric-style-layouts'

const chars = (text: string, step = 300): StyleWord[] => Array.from(text).map((c, i) => ({ text: c, startMs: i * step, endMs: i * step + step }))
const measure = (text: string, size: number) => Array.from(text).length * size

describe('凝彩切镜', () => {
  it('按词组切成 2–4 组一镜，覆盖全部字且不打乱顺序；整句模式一句一镜', () => {
    const words = chars('今日见到的夕阳洒落漫天星点')
    const slices = sliceLine(words, false)
    expect(slices.length).toBeGreaterThan(1)
    expect(slices.flat()).toEqual(words)
    expect(slices.every(slice => slice.length >= 1)).toBe(true)
    expect(sliceLine(words, true)).toEqual([words])
    expect(sliceLine([], false)).toEqual([])
  })

  it('末尾孤字并回上一镜', () => {
    const slices = sliceLine(chars('我们的未来会怎样呢啊'), false)
    expect(slices[slices.length - 1].map(w => w.text).join('').length).toBeGreaterThan(1)
  })
})

describe('凝彩编译', () => {
  const lines = [{ text: '今日见到的夕阳', time: 3 }, { text: '洒落漫天星点', time: 6 }, { text: '世界宽广', time: 15 }]
  const words = lines.map(line => chars(line.text))
  const program = compileTemperaProgram(lines, words, 42, { wholeLine: false })

  it('镜头首尾相接、按时间排序，间隔处插入过场镜头，相邻镜头构图不同', () => {
    for (let i = 1; i < program.length; i++) {
      expect(program[i].start).toBeCloseTo(program[i - 1].end, 6)
      expect(program[i].kind).not.toBe(program[i - 1].kind)
    }
    expect(program[0].lineIndex).toBe(-1)
    expect(program.some((shot, i) => i > 0 && shot.lineIndex === -1)).toBe(true)
    const lyric = program.filter(shot => shot.lineIndex >= 0)
    expect(lyric.flatMap(shot => shot.words.map(w => w.text)).join('')).toBe(lines.map(l => l.text).join(''))
    expect(compileTemperaProgram(lines, words, 42, { wholeLine: false })).toEqual(program)
  })

  it('长句不用整屏留白卡；流向在小范围内', () => {
    expect(program.every(shot => Math.abs(shot.flow) <= 0.25)).toBe(true)
    const long = compileTemperaProgram([{ text: '今日见到的夕阳洒落漫天星点', time: 0 }], [chars('今日见到的夕阳洒落漫天星点')], 1, { wholeLine: true })
    expect(long.every(shot => shot.kind !== 'blank')).toBe(true)
  })

  it('交接：窗口内新旧镜同屏，旧镜推出、新镜推入；静态模式硬切', () => {
    const lyric = program.filter(shot => shot.lineIndex >= 0)
    const a = program.indexOf(lyric[0])
    const next = program[a + 1]
    const mid = next.start - handoffSec(next) / 2
    const both = visibleShots(program, mid, true)
    expect(both).toHaveLength(2)
    expect(both[0].push).toBeGreaterThan(0)
    expect(both[1].push).toBeLessThan(0)
    expect(visibleShots(program, mid, false)).toHaveLength(1)
    expect(visibleShots(program, next.start + 0.01, true)[0]).toMatchObject({ index: a + 1, push: 0 })
    expect(shotIndexAt(program, -1)).toBe(-1)
    expect(visibleShots(program, program[program.length - 1].end + 5, true)).toEqual([])
  })
})

describe('凝彩构图与文字', () => {
  const shot = (kind: TemperaShot['kind']): TemperaShot => ({ start: 0, end: 3, lyricEnd: 2, lineIndex: 0, words: [], kind, flow: 0, seed: 7, hero: 0, watermark: '' })

  it('每种构图都给出合法区域；色块随入场进度从无到有', () => {
    for (const kind of ['split', 'band', 'frame', 'poster', 'disc', 'stripes', 'triangle', 'blank', 'sparse'] as const) {
      const done = temperaComposition(shot(kind), 1200, 800, 1, true)
      expect(done.region.w).toBeGreaterThan(0)
      expect(done.region.h).toBeGreaterThan(0)
      expect(temperaComposition(shot(kind), 1200, 800, 1, true)).toEqual(done)
    }
    expect(temperaComposition(shot('stripes'), 1200, 800, 0, true).shapes).toHaveLength(0)
    // 交接推出时整个构图要能离开画面：任何平涂色块都不超出画面 1.2 倍范围太多。
    for (const kind of ['split', 'band', 'frame', 'poster', 'blank'] as const) {
      for (const shape of temperaComposition(shot(kind), 1200, 800, 1, true).shapes) {
        if (shape.type !== 'poly') continue
        for (const [, y] of shape.points) expect(Math.abs(y - 400)).toBeLessThanOrEqual(800 * 0.75)
      }
    }
    expect(temperaComposition(shot('sparse'), 1200, 800, 1, false).shapes).toHaveLength(0)
  })

  it('重点词放大，放不下时整体缩小到区域内', () => {
    const words = [{ text: '今日' }, { text: '夕阳' }, { text: '星点' }]
    const runs = layoutShotText(words, 1, { w: 600, h: 300 }, 100, measure)
    expect(runs[1].size).toBeGreaterThan(runs[0].size)
    const width = Math.max(...runs.map(r => r.x + r.width)) - Math.min(...runs.map(r => r.x))
    expect(width).toBeLessThanOrEqual(600)
  })

  it('长词经过适配后，字号设置仍改变实际字形尺寸', () => {
    const words = [{ text: '在这只属于你我的空旷夜空下慢慢地溶化成一片温柔的光' }]
    const small = layoutShotText(words, 0, { w: 500, h: 250 }, 80, measure, 0.7)
    const large = layoutShotText(words, 0, { w: 500, h: 250 }, 80, measure, 1.5)
    expect(large[0].size / small[0].size).toBeCloseTo(1.5 / 0.7)
    expect(large[0].width).toBeLessThanOrEqual(500)
  })

  it('落字：起跑前不可见，透明度先于位移到位，唱完后才开始外扩', () => {
    const word = { text: '夕', startMs: 1000, endMs: 1400, enter: 'left' as const }
    expect(wordMotion(word, 0.5, 2, 0, 0.5).opacity).toBe(0)
    const early = wordMotion(word, 1.1, 2, 0, 0.5)
    expect(early.opacity).toBeGreaterThan(0.5)
    expect(early.dx).toBeLessThan(0)
    const late = wordMotion(word, 4, 2, 0, 0.5)
    expect(late.opacity).toBe(1)
    expect(Math.abs(late.dx) + Math.abs(late.dy)).toBeCloseTo(0)
    expect(late.scale).toBe(1)
    expect(wordMotion({ ...word, enter: 'stamp' }, 0.95, 2, 0, 0.5).scale).toBeGreaterThan(1.3)
    expect(releaseSpread(1.5, 2, 3)).toBe(1)
    expect(releaseSpread(10, 2, 3)).toBeCloseTo(1.055)
  })

  it('同一时刻开始的两句都能出镜；短镜头接手时完整就位', () => {
    const lines = [{ text: '甲乙', time: 2 }, { text: '丙丁', time: 2 }, { text: '戊', time: 2.3 }, { text: '己庚辛', time: 2.6 }]
    const words = lines.map(line => chars(line.text, 100))
    const program = compileTemperaProgram(lines, words, 3, { wholeLine: true })
    const texts = program.filter(shot => shot.lineIndex >= 0).map(shot => shot.words.map(w => w.text).join(''))
    expect(texts).toEqual(['甲乙', '丙丁', '戊', '己庚辛'])
    for (let i = 1; i < program.length; i++) expect(program[i].start).toBeGreaterThan(program[i - 1].start)
    for (const [i, shot] of program.entries()) {
      if (i === 0 || shot.lineIndex < 0) continue
      const at = visibleShots(program, shot.start + 0.001, true).find(v => v.index === i)!
      expect(Math.abs(at.push)).toBeLessThan(0.01)
    }
  })

  it('顺延的镜头逐词时间跟着平移，揭字仍对齐原音', () => {
    const lines = [{ text: '甲乙', time: 2 }, { text: '丙丁', time: 2 }]
    const program = compileTemperaProgram(lines, lines.map(line => chars(line.text, 100)), 3, { wholeLine: true })
    const shifted = program.find(shot => shot.words.map(w => w.text).join('') === '丙丁')!
    expect(shifted.start + shifted.words[0].startMs / 1000).toBeCloseTo(2)
    expect(shifted.end).toBeGreaterThan(shifted.start)
  })
})
