import { Children, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerBar } from './PlayerBar'
import { usePlayerStore } from '../../stores/player'
import { useNavigationStore } from '../../stores/navigation'
import type { Track } from '../../types/domain'

const clicks = vi.hoisted(() => [] as (() => void)[])
vi.mock('../../stores/player', async importOriginal => {
  const original = await importOriginal<typeof import('../../stores/player')>()
  return {
    ...original,
    usePlayerStore: Object.assign(
      (selector: (state: ReturnType<typeof original.usePlayerStore.getState>) => unknown) => selector(original.usePlayerStore.getState()),
      original.usePlayerStore,
    ),
  }
})
vi.mock('../ui/ArtistLinks', async importOriginal => {
  const original = await importOriginal<typeof import('../ui/ArtistLinks')>()
  return {
    ArtistLinks(props: Parameters<typeof original.ArtistLinks>[0]) {
      const element = original.ArtistLinks(props)
      function collect(node: ReactNode) {
        Children.forEach(node, child => {
          if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) return
          if (child.type === 'button' && child.props.onClick) clicks.push(child.props.onClick)
          collect(child.props.children)
        })
      }
      collect(element)
      return element
    },
  }
})

const track: Track = {
  id: 'song', type: 'track', provider: 'qq', source: 'qq', name: '合作歌曲',
  artist: '歌手一 / 歌手二', artists: [{ id: 'mid-1', name: '歌手一' }, { id: 'mid-2', name: '歌手二' }],
}
const player = usePlayerStore.getState()
const navigation = useNavigationStore.getState()
afterEach(() => {
  usePlayerStore.setState(player, true)
  useNavigationStore.setState(navigation, true)
  clicks.length = 0
})

describe('播放栏歌手跳转', () => {
  it('歌词打开时，先收起歌词再跳转到点击的合作歌手', () => {
    usePlayerStore.setState({ currentTrack: track })
    useNavigationStore.setState({ currentView: 'explore', history: [], future: [] })
    let lyricsOpen = true
    const closeLyrics = vi.fn(() => {
      expect(useNavigationStore.getState().currentView).toBe('explore')
      lyricsOpen = false
    })
    renderToStaticMarkup(<PlayerBar onArtistNavigate={closeLyrics} />)
    expect(clicks).toHaveLength(2)
    clicks[1]()
    expect(closeLyrics).toHaveBeenCalledOnce()
    expect(lyricsOpen).toBe(false)
    expect(useNavigationStore.getState().currentView).toEqual({ type: 'artist', id: 'mid-2', source: 'qq' })
  })

  it('普通页面未传歌词关闭回调时仍能跳转', () => {
    usePlayerStore.setState({ currentTrack: track })
    renderToStaticMarkup(<PlayerBar />)
    clicks[0]()
    expect(useNavigationStore.getState().currentView).toEqual({ type: 'artist', id: 'mid-1', source: 'qq' })
  })

  it('本地曲目与缺少歌手 ID 的曲目不会关闭歌词或发起跳转', () => {
    const closeLyrics = vi.fn()
    for (const currentTrack of [
      { ...track, provider: 'local' as const, source: 'local' as const },
      { ...track, artists: [{ id: null, name: '无 ID 歌手' }] },
    ]) {
      usePlayerStore.setState({ currentTrack })
      renderToStaticMarkup(<PlayerBar onArtistNavigate={closeLyrics} />)
    }
    expect(clicks).toHaveLength(0)
    expect(closeLyrics).not.toHaveBeenCalled()
    expect(useNavigationStore.getState().currentView).toEqual(navigation.currentView)
  })
})
