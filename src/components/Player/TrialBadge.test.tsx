import { beforeEach, expect, it, vi } from 'vitest'
import { TrialBadge } from './TrialBadge'

const h = vi.hoisted(() => ({
  player: { resolution: null as { trial: boolean; actualSource: string } | null },
}))
vi.mock('../../stores/player', () => ({ usePlayerStore: (select: (state: typeof h.player) => unknown) => select(h.player) }))

beforeEach(() => { h.player = { resolution: null } })

it('没有解析结果或完整音频时不显示', () => {
  expect(TrialBadge()).toBeNull()
  h.player.resolution = { trial: false, actualSource: 'qishui' }
  expect(TrialBadge()).toBeNull()
})

it('试听片段按实际音源说明原因', () => {
  h.player.resolution = { trial: true, actualSource: 'qishui' }
  const badge = TrialBadge()!.props.children
  expect(badge.props.children).toBe('试听')
  expect(badge.props.title).toBe('汽水音乐只提供试听片段，完整版请到官方 App 收听')
})
