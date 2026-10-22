import { describe, it, expect } from 'vitest'
import { compileSonnetProgram, formatTimecode, layoutSonnetShot, sonnetCamera, sonnetGeometry, sonnetShotAt, sonnetWordReveal, splitSonnetLine, type SonnetShot } from './sonnet-program'
import type { StyleWord } from './lyric-style-layouts'

const chars = (text: string, step = 300): StyleWord[] => Array.from(text).map((c, i) => ({ text: c, startMs: i * step, endMs: i * step + step }))
const measure = (text: string, size: number) => Array.from(text).length * size

describe('商籁编译', () => {
  it('短句一镜，长句在词组边界拆两镜且不丢字', () => {
    expect(splitSonnetLine(chars('今日见到的夕阳'))).toHaveLength(1)
    const long = chars('在这只属于你我的空旷夜空下慢慢地溶化成光')
    const parts = splitSonnetLine(long)
    expect(parts).toHaveLength(2)
    expect(parts.flat()).toEqual(long)
    expect(splitSonnetLine([])).toEqual([])
  })

  it('镜头按时间排序、相邻构图与几何不同、同时刻开始的句子顺延；结果固定', () => {
    const lines = [{ text: '甲乙丙', time: 2 }, { text: '丁戊己', time: 2 }, { text: '庚辛壬', time: 6 }]
    const program = compileSonnetProgram(lines, lines.map(l => chars(l.text)), 4)
    expect(program).toHaveLength(3)
    for (let i = 1; i < program.length; i++) {
      expect(program[i].start).toBeGreaterThan(program[i - 1].start)
      expect(program[i].layout).not.toBe(program[i - 1].layout)
      expect(program[i].geometry).not.toBe(program[i - 1].geometry)
      expect(program[i - 1].end).toBeLessThanOrEqual(program[i].start + 1e-9)
    }
    expect(program[0].words[0].startMs).toBe(0)
    // 顺延的镜头逐词时间跟着平移：绝对时刻不变。
    expect(program[1].start + program[1].words[0].startMs / 1000).toBeCloseTo(2)
    expect(compileSonnetProgram(lines, lines.map(l => chars(l.text)), 4)).toEqual(program)
  })

  it('长间奏时上一镜唱完 3 秒后收起；查找镜头', () => {
    const lines = [{ text: '甲乙', time: 0 }, { text: '丙丁', time: 30 }]
    const program = compileSonnetProgram(lines, lines.map(l => chars(l.text)), 1)
    expect(program[0].end).toBeCloseTo(3.6)
    expect(sonnetShotAt(program, 1)).toBe(0)
    expect(sonnetShotAt(program, 10)).toBe(-1)
    expect(sonnetShotAt(program, 31)).toBe(1)
    expect(sonnetShotAt(program, -1)).toBe(-1)
  })
})

describe('商籁排版与几何', () => {
  const shot = (layout: SonnetShot['layout'], text = '今日见到的夕阳'): SonnetShot => ({
    start: 0, end: 3, lineIndex: 0, words: [{ text: text.slice(0, 2), startMs: 0, endMs: 900 }, { text: text.slice(2, 4), startMs: 900, endMs: 1200 }, { text: text.slice(4), startMs: 1200, endMs: 1500 }],
    layout, geometry: 'sunburst', hero: 0, side: 1, seed: 3,
  })

  it('四种构图都覆盖全部词并缩放到画面里；巨字柱里重点词竖排', () => {
    for (const layout of ['pillar', 'stack', 'center', 'diagonal'] as const) {
      const runs = layoutSonnetShot(shot(layout), 1200, 800, 120, measure)
      expect(runs.map(r => r.word).sort()).toEqual([0, 1, 2])
      for (const run of runs) {
        const half = Math.max(run.width, run.height) / 2
        expect(Math.abs(run.x) + half).toBeLessThanOrEqual(1200 * 0.6)
      }
    }
    // 堆叠：相邻行不重叠。
    const stack = layoutSonnetShot(shot('stack', '今日见到的夕阳洒落漫天星点'), 1200, 800, 120, measure).sort((a, b) => a.y - b.y)
    const rowsY = [...new Set(stack.map(r => r.y))]
    for (let i = 1; i < rowsY.length; i++) {
      const upper = stack.find(r => r.y === rowsY[i - 1])!
      const lower = stack.find(r => r.y === rowsY[i])!
      expect(lower.y - lower.size / 2).toBeGreaterThanOrEqual(upper.y + upper.size / 2 - 1e-6)
    }
    // 英文重点词竖立时，柱子与文字块之间不留大空当。
    const latin = layoutSonnetShot({ ...shot('pillar', 'forever and ever'), words: [{ text: 'forever ', startMs: 0, endMs: 900 }, { text: 'and ', startMs: 900, endMs: 1000 }, { text: 'ever', startMs: 1000, endMs: 1100 }] }, 1200, 800, 120, measure)
    const hero = latin.find(r => r.word === 0)!
    const block = latin.filter(r => r.word !== 0)
    const blockEdge = Math.max(...block.map(r => r.x + r.width / 2))
    expect(hero.x - hero.size / 2 - blockEdge).toBeLessThan(hero.size)
    const pillar = layoutSonnetShot(shot('pillar'), 1200, 800, 120, measure)
    expect(pillar.find(r => r.word === 0)!.vertical).toBe(true)
    expect(layoutSonnetShot(shot('pillar', 'Hello my friend'), 1200, 800, 120, measure).find(r => r.word === 0)!.vertical).toBe(false)
  })

  it('每种几何都能随进度描出，进度为 0 时几乎没有线', () => {
    // 山脉描出过程中已经画出的点不变。
    const half = sonnetGeometry({ ...shot('center'), geometry: 'mountains' }, 1200, 800, 0.5, 0)
    const full0 = sonnetGeometry({ ...shot('center'), geometry: 'mountains' }, 1200, 800, 1, 0)
    half.forEach((stroke, i) => {
      if (stroke.type === 'path' && full0[i].type === 'path') expect(full0[i].points.slice(0, stroke.points.length)).toEqual(stroke.points)
    })
    for (const geometry of ['sunburst', 'diamonds', 'hexgrid', 'orbitals', 'planet', 'mountains', 'gear'] as const) {
      const full = sonnetGeometry({ ...shot('center'), geometry }, 1200, 800, 1, 0)
      expect(full.length).toBeGreaterThan(0)
      expect(sonnetGeometry({ ...shot('center'), geometry }, 1200, 800, 0, 0).length).toBeLessThanOrEqual(full.length)
    }
  })
})

describe('商籁镜头与揭示', () => {
  it('随镜头推进缓慢推近，随拍再推近并倾斜，方向随拍翻转', () => {
    const calm = sonnetCamera(1, 4, 0, 1, 1, 1)
    const hit = sonnetCamera(1, 4, 1, 1, 1, 1)
    expect(hit.scale).toBeGreaterThan(calm.scale)
    expect(sonnetCamera(1, 4, 1, -1, 1, 1).rotate).toBe(-hit.rotate)
    expect(sonnetCamera(1, 4, 1, 1, 1, 0)).toEqual(calm)
  })

  it('词提前 80ms 起跑并迅速落定；时间码格式', () => {
    const word = { text: '光', startMs: 1000, endMs: 1500 }
    expect(sonnetWordReveal(word, 800).opacity).toBe(0)
    expect(sonnetWordReveal(word, 1000).opacity).toBeGreaterThan(0.4)
    expect(sonnetWordReveal(word, 1300)).toMatchObject({ opacity: 1, scale: 1 })
    expect(sonnetWordReveal(word, 1250).sung).toBeCloseTo(0.5)
    expect(formatTimecode(83.456)).toBe('01:23.45')
  })
})
