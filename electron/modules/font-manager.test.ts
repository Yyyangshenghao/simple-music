import { describe, expect, it } from 'vitest'
import { normalizeFontFamilies, parseFontFamiliesJson } from './font-manager'

describe('font manager', () => {
  it('清理、去重并排序系统字体族', () => {
    expect(normalizeFontFamilies([
      { family: ' PingFang SC ', localizedName: '苹方-简' },
      'Arial',
      'arial',
      '.SF NS',
      '',
      null
    ])).toEqual([
      { family: 'Arial' },
      { family: 'PingFang SC', localizedName: '苹方-简' }
    ])
  })

  it('兼容 PowerShell 仅返回单个字体时的 JSON 字符串', () => {
    expect(parseFontFamiliesJson('\uFEFF"Microsoft YaHei"\n')).toEqual([
      { family: 'Microsoft YaHei', localizedName: '微软雅黑' }
    ])
  })

  it('读取中文名，并为已知但未内置中文名的字体补充别名', () => {
    expect(parseFontFamiliesJson(JSON.stringify([
      { family: 'LXGW WenKai Mono', localizedName: '霞鹜文楷等宽' },
      { family: 'HarmonyOS Sans SC' },
      { family: 'Microsoft YaHei' }
    ]))).toEqual([
      { family: 'HarmonyOS Sans SC', localizedName: '鸿蒙黑体' },
      { family: 'LXGW WenKai Mono', localizedName: '霞鹜文楷等宽' },
      { family: 'Microsoft YaHei', localizedName: '微软雅黑' }
    ])
  })
})
