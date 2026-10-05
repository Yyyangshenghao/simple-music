import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearProviderRequestCache, requestProviderData } from '../lib/provider-request-cache'
import { useProviderStore } from '../stores/providers'
import { ArtistPage } from './ArtistPage'

vi.mock('../stores/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/providers')>()
  const store = original.useProviderStore
  return { ...original, useProviderStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store
  ) }
})
vi.mock('../components/Artist/ArtistHeader', () => ({ ArtistHeader: ({ artist }: { artist: { name: string } }) => <h1>{artist.name}</h1> }))
vi.mock('../components/Explore/PlaylistCard', () => ({ PlaylistCard: ({ playlist }: { playlist: { name: string } }) => <div>{playlist.name}</div> }))

describe('歌手页返回首帧', () => {
  beforeEach(() => {
    clearProviderRequestCache()
    useProviderStore.setState(state => ({ byId: { ...state.byId, qq: { enabled: true, auth: 'authenticated' } } }))
  })

  async function seed() {
    await requestProviderData('qq', 'artist:artist:detail', () => Promise.resolve({ id: 'artist', source: 'qq', name: '已浏览歌手' }))
    await requestProviderData('qq', 'artist:artist:albums', () => Promise.resolve([{ id: 'album', source: 'qq', name: '已浏览专辑' }]))
  }

  it('返回专辑标签时直接显示资料与专辑，避免先渲染空列表', async () => {
    await seed()
    const html = renderToStaticMarkup(<ArtistPage id="artist" source="qq" initialState={{ tab: 'albums', query: '', scrollTop: 500 }} />)
    expect(html).toContain('已浏览歌手')
    expect(html).toContain('已浏览专辑')
  })

  it('账号变更和禁用后不渲染此前缓存的资料', async () => {
    await seed()
    useProviderStore.getState().setAccountState('qq', 'anonymous')
    const html = renderToStaticMarkup(<ArtistPage id="artist" source="qq" initialState={{ tab: 'albums', query: '', scrollTop: 0 }} />)
    expect(html).not.toContain('已浏览歌手')
    expect(html).not.toContain('已浏览专辑')
  })
})
