import { describe, it, expect } from 'vitest'
import { buildFumeArticle, cameraSettled, fumeCameraTarget, fumeDecor, nearestTextLine, normalizeLineText, printedGlyphs, stepFumeCamera } from './fume-article'

// 每个非空白字宽一个字号，空格半个字号。
const measure = (text: string, size: number) => Array.from(text).reduce((w, c) => w + (/\s/.test(c) ? size / 2 : size), 0)
const lines = (texts: string[], gap = 4) => texts.map((text, i) => ({ text, time: i * gap }))

describe('浮名文章排版', () => {
  it('每句都有行，空句没有；同一种子结果固定', () => {
    const input = lines(['今日见到的夕阳', '', '洒落漫天星点', 'Every word lands'])
    const a = buildFumeArticle(input, measure, 7)
    expect(a.lineRows.map(rows => rows.length > 0)).toEqual([true, false, true, true])
    expect(buildFumeArticle(input, measure, 7)).toEqual(a)
  })

  it('长句按栏宽换行，英文单词不拆开，行首没有空白', () => {
    const long = '今日见到的夕阳洒落漫天星点今日见到的夕阳洒落漫天星点'
    const a = buildFumeArticle(lines([long, 'Every single word lands right on the beat of this song tonight']), measure, 1)
    expect(a.lineRows[0].length).toBeGreaterThan(1)
    const joined = a.lineRows[0].map(i => a.rows[i].text).join('')
    expect(joined).toBe(long)
    const latin = a.lineRows[1].map(i => a.rows[i].text)
    expect(latin.length).toBeGreaterThan(1)
    expect(latin.every(text => !/^\s/.test(text) && !/\s$/.test(text))).toBe(true)
    expect(latin.join(' ')).toBe('Every single word lands right on the beat of this song tonight')
    // 换行后的行记录自己在整句里的起始字号位置。
    const second = a.rows[a.lineRows[0][1]]
    expect(second.visibleStart).toBe(Array.from(a.rows[a.lineRows[0][0]].text).length)
  })

  it('间隔久或句数多时分段，段落在两栏交替且逐段下移', () => {
    const input = lines(['一', '二', '三', '四', '五', '六', '七', '八'], 2)
    input[3].time += 10
    const a = buildFumeArticle(input, measure, 3)
    const first = a.rows[a.lineRows[0][0]]
    const fourth = a.rows[a.lineRows[3][0]]
    expect(Math.abs(fourth.x - first.x)).toBeGreaterThan(400)
    expect(fourth.y).toBeGreaterThan(first.y)
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

describe('浮名镜头', () => {
  const article = buildFumeArticle(lines(['今日见到的夕阳', '', '洒落漫天星点']), measure, 2)
  const stage = { width: 1200, height: 700 }

  it('当前句以目标字号居中；过长时缩小到放得下；空句找最近的有字句', () => {
    const target = fumeCameraTarget(article, 0, stage, 80)!
    const row = article.rows[article.lineRows[0][0]]
    expect(target.scale).toBeCloseTo(80 / row.size)
    expect(target.x).toBeCloseTo(row.x + row.width / 2)
    const huge = fumeCameraTarget(article, 0, stage, 400)!
    expect(row.width * huge.scale).toBeLessThanOrEqual(stage.width * 0.84 + 0.01)
    expect(nearestTextLine(article, 1)).toBe(0)
    expect(fumeCameraTarget(article, -1, stage, 80)!.scale).toBeLessThan(target.scale)
  })

  it('平滑追随目标，时间足够后停稳；dt 为 0 不动', () => {
    const from = { x: 0, y: 0, scale: 1 }
    const to = { x: 500, y: 300, scale: 2 }
    expect(stepFumeCamera(from, to, 0)).toEqual(from)
    const half = stepFumeCamera(from, to, 0.2)
    expect(half.x).toBeGreaterThan(0)
    expect(half.x).toBeLessThan(500)
    let camera = from
    for (let i = 0; i < 200; i++) camera = stepFumeCamera(camera, to, 1 / 60)
    expect(cameraSettled(camera, to)).toBe(true)
    expect(cameraSettled(from, to)).toBe(false)
  })

  it('装饰数量有上限且按种子固定', () => {
    const decor = fumeDecor(article, 5)
    expect(decor.length).toBeGreaterThanOrEqual(4)
    expect(decor.length).toBeLessThanOrEqual(40)
    expect(fumeDecor(article, 5)).toEqual(decor)
  })

  it('镜头遇到非有限值直接到目标；超宽单词按字拆行', () => {
    expect(stepFumeCamera({ x: Number.NaN, y: 0, scale: 0 }, { x: 1, y: 2, scale: 3 }, 0.1)).toEqual({ x: 1, y: 2, scale: 3 })
    const a = buildFumeArticle(lines(['na-'.repeat(120)]), measure, 1)
    expect(a.lineRows[0].length).toBeGreaterThan(1)
    expect(Math.max(...a.lineRows[0].map(i => a.rows[i].width))).toBeLessThanOrEqual(40 * 15 * 1.2)
  })
})
