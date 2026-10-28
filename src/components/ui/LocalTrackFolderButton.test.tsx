import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '../../types/domain'
import { LocalTrackFolderButton } from './LocalTrackFolderButton'
import { useToastStore } from '../../stores/toast'
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: () => [false, vi.fn()] }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const track = { id: 42, name: '本地歌曲', source: 'local', provider: 'local', type: 'local', artist: '', artists: [] } as Track
it('只向桌面桥发送规范化索引 ID，不从音频地址推断路径', async () => {
  const revealLocalTrack = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('window', { desktop: { revealLocalTrack } })
  const button = LocalTrackFolderButton({ track: { ...track, url: '/api/local/audio?id=42' } })
  button.props.onClick()
  await vi.waitFor(() => expect(revealLocalTrack).toHaveBeenCalledWith('42'))
})
it('文件丢失给出恢复提示，桥不可用时禁用入口', async () => {
  const show = vi.spyOn(useToastStore.getState(), 'show')
  vi.stubGlobal('window', { desktop: { revealLocalTrack: vi.fn(async () => ({ ok: false })) } })
  LocalTrackFolderButton({ track }).props.onClick()
  await vi.waitFor(() => expect(show).toHaveBeenCalledWith(expect.stringContaining('重新导入')))
  vi.stubGlobal('window', { desktop: {} })
  expect(LocalTrackFolderButton({ track }).props.disabled).toBe(true)
})
