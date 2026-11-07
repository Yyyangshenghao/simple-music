import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearchResults } from './useSearchResults'
import { advanceProviderAccountSession } from '../lib/provider-account-session'
import { useProviderStore } from '../stores/providers'
import type { Track } from '../types/domain'

const requests = vi.hoisted(() => ({
  songs: vi.fn(),
  artists: vi.fn(),
  albums: vi.fn(),
  playlists: vi.fn(),
}))

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void) => effect(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
vi.mock('../stores/providers', async importOriginal => {
  const original = await importOriginal<typeof import('../stores/providers')>()
  const store = original.useProviderStore
  return { ...original, useProviderStore: Object.assign(
    (select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store
  ) }
})
vi.mock('../providers/registry', () => ({
  providerFor: () => ({
    catalog: {
      searchTracks: requests.songs,
      searchArtists: requests.artists,
      searchAlbums: requests.albums,
      searchPlaylists: requests.playlists,
    },
  }),
}))

function setEnabled(enabled: boolean) {
  const { byId } = useProviderStore.getState()
  useProviderStore.setState({ byId: { ...byId, netease: { ...byId.netease, enabled, auth: 'authenticated' } } })
}

function track(name: string): Track {
  return { id: name, source: 'netease', provider: 'netease', type: 'song', name, artist: '', artists: [] }
}

describe('搜索结果保留', () => {
  beforeEach(() => {
    for (const request of Object.values(requests)) request.mockReset().mockResolvedValue([])
    setEnabled(false)
    setEnabled(true)
  })

  it('离开后仍接收在途结果，重新进入不会重复请求，同词提交可刷新', async () => {
    let finish!: (songs: Track[]) => void
    requests.songs.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    useSearchResults('晴天', true)
    useSearchResults('晴天', false)
    finish([track('第一批')])
    await vi.waitFor(() => expect(useSearchResults('晴天', false).songs.netease?.data).toEqual([track('第一批')]))
    const resumed = useSearchResults('晴天', true)
    expect(resumed.songs.netease?.data).toEqual([track('第一批')])
    expect(requests.songs).toHaveBeenCalledTimes(1)
    resumed.refresh()
    expect(requests.songs).toHaveBeenCalledTimes(2)
  })

  it('重试失败类别时复用已经成功的结果', async () => {
    requests.songs.mockResolvedValue([track('保留结果')])
    requests.albums.mockRejectedValueOnce(new Error('NETWORK'))
    useSearchResults('夜曲', true)
    await vi.waitFor(() => expect(useSearchResults('夜曲', false).albums.netease?.status).toBe('error'))
    useSearchResults('夜曲', true).retryFailed()
    await vi.waitFor(() => expect(useSearchResults('夜曲', false).albums.netease?.status).toBe('empty'))
    expect(requests.albums).toHaveBeenCalledTimes(2)
    expect(requests.songs).toHaveBeenCalledTimes(1)
    expect(useSearchResults('夜曲', false).songs.netease?.data).toEqual([track('保留结果')])
  })

  it('同词刷新保留旧结果，忽略重复刷新，失败后可重试并接受空结果', async () => {
    const old = [track('上一批')]
    requests.songs.mockResolvedValueOnce(old)
    useSearchResults('雨天', true)
    await vi.waitFor(() => expect(useSearchResults('雨天', false).busy).toBe(false))

    let fail!: (error: Error) => void
    requests.songs.mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    useSearchResults('雨天', false).refresh()
    useSearchResults('雨天', false).refresh()
    expect(requests.songs).toHaveBeenCalledTimes(2)
    expect(useSearchResults('雨天', false)).toMatchObject({ busy: true, songs: { netease: { status: 'loading', data: old } } })

    fail(new Error('NETWORK'))
    await vi.waitFor(() => expect(useSearchResults('雨天', false)).toMatchObject({ busy: false, songs: { netease: { status: 'error', data: old } } }))
    useSearchResults('雨天', false).retryFailed()
    await vi.waitFor(() => expect(useSearchResults('雨天', false).songs.netease).toMatchObject({ status: 'empty', data: [] }))
  })

  it('忽略换号后的迟到响应，停用再启用也重新请求', async () => {
    let finish!: (songs: Track[]) => void
    requests.songs.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce([track('新账号')])
    useSearchResults('海边', true)
    advanceProviderAccountSession('netease')
    setEnabled(true)
    useSearchResults('海边', true)
    finish([track('旧账号')])
    await vi.waitFor(() => expect(useSearchResults('海边', false).songs.netease?.data).toEqual([track('新账号')]))
    setEnabled(false)
    setEnabled(true)
    expect(useSearchResults('海边', true).songs.netease).toBeUndefined()
    expect(requests.songs).toHaveBeenCalledTimes(3)
  })
})
