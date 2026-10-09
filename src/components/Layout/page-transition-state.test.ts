import { describe, expect, it } from 'vitest'
import type { AppView } from '../../stores/navigation'
import type { Playlist } from '../../types/domain'
import { initialPageTransition, nextPageTransition } from './page-transition-state'

const playlist: Playlist = { source: 'netease', provider: 'netease', type: 'playlist', id: 1, name: '歌单', cover: '', creator: '', trackCount: 0, playCount: 0 }
const detail: AppView = { type: 'playlist', from: 'library', playlist }

describe('歌单和专辑往返页面', () => {
  it.each(['playlist', 'album'] as const)('打开 %s 时保留来源页，返回和再次前进沿用同一列表实例', type => {
    const origin = initialPageTransition('library', 0)
    const view: AppView = { ...detail, playlist: { ...playlist, type } }
    const opened = nextPageTransition(origin, view, 1, 'push')
    expect(opened.origin).toBe(origin.current)
    expect(opened.current.key).not.toBe(origin.current.key)
    const returned = nextPageTransition(opened, 'library', 2, 'pop')
    expect(returned.current.key).toBe(origin.current.key)
    expect(returned.origin).toBeNull()
    expect(nextPageTransition(returned, view, 3, 'push').origin?.key).toBe(origin.current.key)
  })

  it('返回搜索页时保留列表实例，同时采用历史条目的分类及滚动快照', () => {
    const origin = initialPageTransition({ type: 'search', keyword: '晴天' }, 4)
    const opened = nextPageTransition(origin, detail, 5, 'push')
    const snapshot: AppView = { type: 'search', keyword: '晴天', pageState: { category: 'albums', sourceFilter: 'qq', scrollTop: 400 } }
    const returned = nextPageTransition(opened, snapshot, 6, 'pop')
    expect(returned.current.key).toBe(origin.current.key)
    expect(returned.current.view).toBe(snapshot)
  })

  it('新的同词搜索仍创建新页面，离开详情去其他页面释放来源页', () => {
    const origin = initialPageTransition({ type: 'search', keyword: '晴天' }, 0)
    const opened = nextPageTransition(origin, detail, 1, 'push')
    const newSearch = nextPageTransition(opened, { type: 'search', keyword: '晴天' }, 2, 'push')
    expect(newSearch.current.key).not.toBe(origin.current.key)
    expect(newSearch.origin).toBeNull()
    const other = nextPageTransition(opened, 'settings', 2, 'push')
    expect(other.origin).toBeNull()
    expect(other.current.view).toBe('settings')
  })

  it('连续打开详情只保留一个来源页，逐级返回后仍可恢复', () => {
    const origin = initialPageTransition('library', 50)
    const first = nextPageTransition(origin, detail, 51, 'push')
    const second = nextPageTransition(first, { ...detail, playlist: { ...playlist, id: 2 } }, 52, 'push')
    expect(second.origin).toBe(origin.current)
    const firstAgain = nextPageTransition(second, detail, 53, 'pop')
    expect(firstAgain.origin).toBe(origin.current)
    expect(nextPageTransition(firstAgain, 'library', 54, 'pop').current.key).toBe(origin.current.key)
  })

  it('直接进入详情时没有虚构来源页，同一导航状态重渲染不更换页面', () => {
    const state = initialPageTransition(detail, 0)
    expect(state.origin).toBeNull()
    expect(nextPageTransition(state, detail, 0, 'push')).toBe(state)
    expect(nextPageTransition(state, 'library', 1, 'pop').origin).toBeNull()
  })
})
