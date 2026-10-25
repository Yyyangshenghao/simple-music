import { describe, expect, it } from 'vitest'
import { realignCompanionLines } from './lyric-realign'

// 测试数据只用占位文本
const L = (time: number, text: string) => ({ time, text })

describe('换行版本后重新对应翻译/音译', () => {
  it('行起点相差超过 0.3s 仍按文本对上', () => {
    const oldMain = [L(10, '甲乙丙'), L(15, '丁戊')]
    const newMain = [L(10.8, '甲乙丙'), L(17, '丁戊')]
    const roma = [L(10, 'a b c'), L(15, 'd e')]
    expect(realignCompanionLines(oldMain, newMain, roma).map(l => l.text)).toEqual(['a b c', 'd e'])
  })

  it('两句合成一句时拼接两句音译，标点空格不影响匹配', () => {
    const oldMain = [L(1, '甲乙'), L(3, '丙丁，'), L(6, '戊')]
    const newMain = [L(1.4, '甲乙 丙丁'), L(6.5, '戊')]
    const roma = [L(1, 'a b'), L(3, 'c d'), L(6, 'e')]
    expect(realignCompanionLines(oldMain, newMain, roma).map(l => l.text)).toEqual(['a b c d', 'e'])
  })

  it('一句拆成两句时整句音译只放在第一段', () => {
    const oldMain = [L(1, '甲乙丙丁'), L(6, '戊')]
    const newMain = [L(1, '甲乙'), L(3, '丙丁'), L(6, '戊')]
    const roma = [L(1, 'a b c d'), L(6, 'e')]
    expect(realignCompanionLines(oldMain, newMain, roma).map(l => l.text)).toEqual(['a b c d', '', 'e'])
  })

  it('新版本删掉一句时跳过后重新同步', () => {
    const oldMain = [L(1, '甲'), L(2, '乙'), L(3, '丙')]
    const newMain = [L(1, '甲'), L(3.2, '丙')]
    const roma = [L(1, 'a'), L(2, 'b'), L(3, 'c')]
    expect(realignCompanionLines(oldMain, newMain, roma).map(l => l.text)).toEqual(['a', 'c'])
  })

  it('文本对不上时按 2s 内最近且未用过的原行兜底', () => {
    const oldMain = [L(1, '甲'), L(5, '乙')]
    const newMain = [L(2.5, '子'), L(5.5, '丑'), L(20, '寅')]
    const roma = [L(1, 'a'), L(5, 'b')]
    expect(realignCompanionLines(oldMain, newMain, roma).map(l => l.text)).toEqual(['a', 'b', ''])
  })

  it('原本没有翻译/音译时返回空数组', () => {
    expect(realignCompanionLines([L(1, '甲')], [L(1, '甲')], [L(1, '')])).toEqual([])
  })
})
