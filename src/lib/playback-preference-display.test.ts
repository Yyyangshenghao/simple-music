import { describe, expect, it } from 'vitest'
import { playbackStrategySummary } from './playback-preference-display'

describe('playbackStrategySummary', () => {
  const providers = ['QQ音乐', '网易云']

  it('跟随歌曲来源时说明平台顺序只是失败后的接力顺序', () => {
    expect(playbackStrategySummary(providers, true, true))
      .toBe('歌曲来源已启用时先用它；失败后按 QQ音乐 → 网易云 中尚未尝试的平台接力')
  })

  it('关闭来源优先后明确使用固定顺序', () => {
    expect(playbackStrategySummary(providers, false, true))
      .toBe('所有歌曲依次尝试：QQ音乐 → 网易云')
  })

  it('关闭自动换源后只说明实际会尝试的平台', () => {
    expect(playbackStrategySummary(providers, true, false))
      .toBe('只尝试一个平台：歌曲来源已启用时优先，否则使用 QQ音乐')
    expect(playbackStrategySummary(providers, false, false))
      .toBe('所有歌曲只尝试：QQ音乐')
  })

  it('没有平台时给出明确空状态', () => {
    expect(playbackStrategySummary([], false, true)).toBe('暂无已启用的在线音源')
  })

  it('单平台时隐藏无意义的接力差异', () => {
    expect(playbackStrategySummary(['QQ音乐'], true, true)).toBe('所有在线歌曲使用 QQ音乐')
    expect(playbackStrategySummary(['QQ音乐'], false, false)).toBe('所有在线歌曲使用 QQ音乐')
  })
})
