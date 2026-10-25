import { describe, it, expect } from 'vitest'
import { buildFumeCollage, cameraSettled, fumeCameraTarget, nearestTextLine, normalizeLineText, printedGlyphs, stepFumeCamera, type CollageBlock } from './fume-collage'

// 每个非空白字宽一个字号，空格半个字号。
const measure = (text: string, size: number) => Array.from(text).reduce((w, c) => w + (/\s/.test(c) ? size / 2 : size), 0)
const lines = (texts: string[], gap = 4) => texts.map((text, i) => ({ text, time: i * gap }))
const song = lines([
  '今日见到的夕阳', '洒落漫天星点', '', '我们过了', 'Every word lands right here', '风吹过', '夜空下慢慢', '让每个音符都有自己的形状',
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
])
const overlaps = (a: CollageBlock, b: CollageBlock) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('拼版排版', () => {
  it('每句都在某一块里，空句不在；同一种子结果固定', () => {
    const a = buildFumeCollage(song, measure, 7, { vertical: true })
    expect(a.blockOf.map(b => b >= 0)).toEqual(song.map(line => !!line.text))
    expect(buildFumeCollage(song, measure, 7, { vertical: true })).toEqual(a)
    for (const [index, block] of a.blockOf.entries()) {
      if (block >= 0) expect(a.blocks[block].lines.some(line => line.lineIndex === index)).toBe(true)
    }
  })

  it('块与块不重叠，按阅读顺序从左到右、从上到下排', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { blocks } = buildFumeCollage(song, measure, seed, { vertical: true })
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) expect(overlaps(blocks[i], blocks[j])).toBe(false)
        // 同一横带里往右排；换带时整条新带在之前所有块的下方。
        if (i && blocks[i].x <= blocks[i - 1].x) expect(blocks[i].y).toBeGreaterThanOrEqual(Math.max(...blocks.slice(0, i).map(b => b.y + b.height)))
      }
    }
  })

  it('长句按行宽换行，英文单词不拆开，行首行尾没有空白', () => {
    const long = '今日见到的夕阳洒落漫天星点今日见到的夕阳洒落漫天星点'
    const english = 'Every single word lands right on the beat of this song tonight'
    const a = buildFumeCollage(lines([long, english]), measure, 1, { vertical: true })
    const rowsOf = (index: number) => a.blocks[a.blockOf[index]].lines.find(line => line.lineIndex === index)!.rows
    expect(rowsOf(0).length).toBeGreaterThan(1)
    expect(rowsOf(0).join('')).toBe(long)
    expect(rowsOf(1).length).toBeGreaterThan(1)
    expect(rowsOf(1).every(text => !/^\s|\s$/.test(text))).toBe(true)
    expect(rowsOf(1).join(' ')).toBe(english)
  })

  it('竖排只给短的中日韩文段落、不连续出现；关掉后全部横排', () => {
    const seen = new Set<boolean>()
    for (let seed = 1; seed <= 30; seed++) {
      const { blocks } = buildFumeCollage(song, measure, seed, { vertical: true })
      blocks.forEach((block, i) => {
        seen.add(block.vertical)
        if (!block.vertical) return
        expect(i > 0 && blocks[i - 1].vertical).toBe(false)
        expect(block.lines.every(line => line.rows.length === 1 && !/[A-Za-z]/.test(line.rows[0]))).toBe(true)
        expect(block.height).toBeLessThanOrEqual(9 + 1e-6)
      })
      expect(buildFumeCollage(song, measure, seed, { vertical: false }).blocks.every(block => !block.vertical)).toBe(true)
    }
    expect(seen).toEqual(new Set([true, false]))
  })

  it('相邻块字号与颜色不同；大字只给放得进一行的短句', () => {
    const { blocks } = buildFumeCollage(song, measure, 9, { vertical: true })
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].tone).not.toBe(blocks[i - 1].tone)
      expect(blocks[i].size).not.toBe(blocks[i - 1].size)
    }
    for (const block of blocks) if (!block.vertical && block.size > 1) expect(block.lines.every(line => line.rows.length === 1)).toBe(true)
  })

  it('规范化空白', () => {
    expect(normalizeLineText('  我们   过了 ')).toBe('我们 过了')
  })
})

describe('逐字打印进度', () => {
  const words = [{ text: '今日 ', startMs: 0, endMs: 400 }, { text: '夕阳', startMs: 500, endMs: 900 }]
  it('按词的演唱时间累计非空白字，正在唱的词按进度给小数', () => {
    expect(printedGlyphs(words, -10)).toBe(0)
    expect(printedGlyphs(words, 200)).toBeCloseTo(1)
    expect(printedGlyphs(words, 450)).toBe(2)
    expect(printedGlyphs(words, 700)).toBeCloseTo(3)
    expect(printedGlyphs(words, 5000)).toBe(4)
  })
})

describe('拼版镜头', () => {
  const stage = { width: 1200, height: 700 }

  it('对准当前句中心，只平移不放大；比舞台大时才缩小；空句找最近的有字句', () => {
    const target = fumeCameraTarget({ x: 100, y: 200, width: 400, height: 80 }, stage)
    expect(target).toEqual({ x: 300, y: 240, scale: 1 })
    const huge = fumeCameraTarget({ x: 0, y: 0, width: 2400, height: 80 }, stage)
    expect(2400 * huge.scale).toBeCloseTo(stage.width * 0.86)
    const collage = buildFumeCollage(lines(['今日见到的夕阳', '', '洒落漫天星点']), measure, 2, { vertical: true })
    expect(nearestTextLine(collage, 1)).toBe(0)
    expect(nearestTextLine(collage, -1)).toBe(0)
  })

  it('平滑追随目标，时间足够后停稳；dt 为 0 不动', () => {
    const from = { x: 0, y: 0, scale: 1 }
    const to = { x: 500, y: 300, scale: 0.5 }
    expect(stepFumeCamera(from, to, 0)).toEqual(from)
    const half = stepFumeCamera(from, to, 0.2)
    expect(half.x).toBeGreaterThan(0)
    expect(half.x).toBeLessThan(500)
    let camera = from
    for (let i = 0; i < 200; i++) camera = stepFumeCamera(camera, to, 1 / 60)
    expect(cameraSettled(camera, to)).toBe(true)
    expect(stepFumeCamera({ x: NaN, y: 0, scale: 1 }, to, 0.1)).toEqual(to)
  })
})
