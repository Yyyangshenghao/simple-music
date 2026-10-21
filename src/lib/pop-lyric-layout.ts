import { groupLyricBreakUnits } from './lyric-line-break'
import type { PopWord } from './pop-lyric-timing'

export type PopComposition = 'impact' | 'cascade' | 'verse'
export type PopReveal = 'rise' | 'sweep' | 'fold'

export interface PopPhrase {
  units: number[][]
  accent: boolean
  align: 'start' | 'center' | 'end'
  scale: number
  angle: number
}

export interface PopLyricLayout {
  composition: PopComposition
  reveal: PopReveal
  phrases: PopPhrase[]
}

/** 用大致字面宽度平衡中英文分句，不改动逐字 token 与演唱时间。 */
function textWeight(text: string): number {
  return Array.from(text).reduce((total, char) => total + (/\s/u.test(char) ? 0.3 : /[\p{Script=Latin}\p{Number}]/u.test(char) ? 0.55 : 1), 0)
}

/** 优先沿词组、标点和演唱停顿分段，固定行序让重复进入同句时构图一致。 */
export function buildPopLyricLayout(words: readonly PopWord[], dwellSec: number, seed: number): PopLyricLayout {
  const units = groupLyricBreakUnits(words.map(word => word.text))
  const weights = units.map(unit => textWeight(unit.map(index => words[index].text).join('')))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const composition: PopComposition = total <= 6 || units.length < 2 || dwellSec < 1.2 ? 'impact' : total > 22 ? 'verse' : 'cascade'
  const count = Math.min(units.length, composition === 'impact' ? 1 : composition === 'cascade' ? 2 : 3)
  const rows: number[][][] = []
  let start = 0
  let remaining = total
  for (let row = 0; row < count - 1; row++) {
    const target = remaining / (count - row) * (row === 0 && composition === 'cascade' ? 0.82 : 1)
    let weight = 0
    let best = start + 1
    let bestScore = Infinity
    for (let end = start + 1; end <= units.length - (count - row - 1); end++) {
      weight += weights[end - 1]
      const last = words[units[end - 1].at(-1)!]
      const next = words[units[end][0]]
      const gap = next.startMs - last.startMs - last.durationMs
      const boundary = /[，。！？、；：,.!?;:]\s*$/u.test(last.text) ? 2.4 : gap >= 120 ? 0.7 : 0
      const score = Math.abs(weight - target) - boundary
      if (score < bestScore) { bestScore = score; best = end }
    }
    rows.push(units.slice(start, best))
    remaining -= weights.slice(start, best).reduce((sum, weight) => sum + weight, 0)
    start = best
  }
  if (units.length) rows.push(units.slice(start))
  const direction = Math.floor(seed / 1000) % 2 ? 1 : -1
  const accent = rows.length > 1 ? rows.length - 1 : 0
  return {
    composition,
    reveal: composition === 'impact' ? 'fold' : composition === 'cascade' ? 'sweep' : 'rise',
    phrases: rows.map((units, index) => ({
      units,
      accent: index === accent,
      align: rows.length === 1 ? 'center' : (index + (direction > 0 ? 0 : 1)) % 2 ? 'end' : 'start',
      scale: rows.length === 1 ? 1.18 : index === accent ? 1.08 : 0.76,
      angle: direction * (index % 2 ? 1.8 : -2.4),
    })),
  }
}
