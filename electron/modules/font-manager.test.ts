import { describe, expect, it, vi } from 'vitest'
import { createFontListCache, normalizeFontFamilies, parseFontFamiliesJson, parseFontconfigFamilies } from './font-manager'

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

  it('解析 fontconfig 输出：首个别名当族名，中文别名当本地化名', () => {
    expect(parseFontconfigFamilies([
      'JetBrainsMonoNL Nerd Font Mono,JetBrainsMonoNL NFM,JetBrainsMonoNL NFM ExtraLight',
      'Noto Sans CJK SC,思源黑体',
      'Sarasa Term Slab CL,Sarasa Term Slab CL Light',
      'Noto Sans CJK SC,思源黑体',
      ''
    ].join('\n'))).toEqual([
      { family: 'JetBrainsMonoNL Nerd Font Mono' },
      { family: 'Noto Sans CJK SC', localizedName: '思源黑体' },
      { family: 'Sarasa Term Slab CL' }
    ])
  })

  it('字体列表只读一次，并发请求共用同一次读取', async () => {
    const read = vi.fn().mockResolvedValue([{ family: 'Inter' }])
    const list = createFontListCache(read)
    const [a, b] = await Promise.all([list(), list()])
    await list()
    expect(read).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('读取失败不缓存，重试会重新读取', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('TIMEOUT')).mockResolvedValue([{ family: 'Inter' }])
    const list = createFontListCache(read)
    await expect(list()).rejects.toThrow('TIMEOUT')
    await expect(list()).resolves.toEqual([{ family: 'Inter' }])
    expect(read).toHaveBeenCalledTimes(2)
  })
})
