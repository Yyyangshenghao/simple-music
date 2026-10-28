import { describe, it, expect } from 'vitest'
import { descendantsOf, labelForUrl, parseIoregGpu, parsePs } from './dev-metrics'

describe('labelForUrl', () => {
  it('按入口页面识别窗口', () => {
    expect(labelForUrl('http://localhost:5173/index.html#/library')).toBe('主窗口')
    expect(labelForUrl('file:///App/out/renderer/playback-host.html')).toBe('播放宿主')
    expect(labelForUrl('http://localhost:5173/overlays/desktop-lyrics/desktop-lyrics.html')).toBe('桌面歌词')
    expect(labelForUrl('https://music.apple.com/cn/')).toBe('Apple Music')
  })

  it('未知页面回退到 host，无效 URL 返回 null', () => {
    expect(labelForUrl('https://example.com/a')).toBe('example.com')
    expect(labelForUrl('')).toBeNull()
  })
})

describe('parsePs / descendantsOf', () => {
  const out = [
    '  100     1   3.5  204800 /Applications/Electron.app/Contents/MacOS/Electron',
    '  200   100   0.0   10240 /Applications/Electron.app/Contents/Frameworks/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU)',
    '  300   100  12.0   51200 Electron',
    '  301   300   1.0    2048 Electron Helper',
    '  400     1   9.9    1024 other',
    'garbage line'
  ].join('\n')

  it('解析含空格的命令名', () => {
    const rows = parsePs(out)
    expect(rows).toHaveLength(5)
    expect(rows[1]).toEqual({ pid: 200, ppid: 100, cpu: 0, rssKb: 10240, command: 'Electron Helper (GPU)' })
  })

  it('只返回指定根的后代', () => {
    expect(descendantsOf(parsePs(out), 100).map((row) => row.pid)).toEqual([200, 300, 301])
  })
})

describe('parseIoregGpu', () => {
  it('提取利用率与在用内存', () => {
    const out = '"PerformanceStatistics" = {"Renderer Utilization %"=40,"Device Utilization %"=42,"In use system memory"=3501359104}'
    expect(parseIoregGpu(out)).toEqual({ utilization: 42, inUseMemory: 3501359104 })
    expect(parseIoregGpu('')).toEqual({ utilization: null, inUseMemory: null })
  })
})
