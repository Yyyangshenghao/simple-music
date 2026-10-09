import { beforeEach, describe, expect, it } from 'vitest'
import { useNavigationStore } from './navigation'

describe('歌手页导航状态', () => {
  beforeEach(() => useNavigationStore.setState({ currentView: 'explore', history: [], future: [] }))

  it('从专辑返回歌手时恢复标签、搜索词及滚动位置，前进后再次返回仍保留', () => {
    const nav = useNavigationStore.getState()
    nav.navigateTo({ type: 'artist', id: 1, source: 'qq' })
    nav.updateArtistPageState('1', 'qq', { tab: 'albums', query: '测试', scrollTop: 420 })
    nav.navigateTo({ type: 'playlist', from: 'explore', playlist: {
      id: 'album', provider: 'qq', source: 'qq', type: 'album', name: '专辑', cover: '',
      trackCount: 1, playCount: 0, creator: '',
    } })
    nav.goBack()
    expect(useNavigationStore.getState().currentView).toMatchObject({
      type: 'artist', pageState: { tab: 'albums', query: '测试', scrollTop: 420 },
    })
    nav.goForward()
    nav.goBack()
    expect(useNavigationStore.getState().currentView).toMatchObject({ pageState: { tab: 'albums', scrollTop: 420 } })
  })

  it('退出时迟到的滚动事件不修改其他歌手或平台，也不清空前进栈', () => {
    const nav = useNavigationStore.getState()
    nav.navigateTo({ type: 'artist', id: '1', source: 'qq' })
    nav.updateArtistPageState('1', 'qq', { tab: 'albums' })
    nav.navigateTo({ type: 'artist', id: '1', source: 'netease' })
    nav.updateArtistPageState('1', 'qq', { scrollTop: 900 })
    expect(useNavigationStore.getState().currentView).not.toHaveProperty('pageState')
    nav.goBack()
    nav.updateArtistPageState('1', 'qq', { scrollTop: 200 })
    expect(useNavigationStore.getState().future).toHaveLength(1)
    nav.navigateTo({ type: 'artist', id: '1', source: 'qq' })
    expect(useNavigationStore.getState().currentView).not.toHaveProperty('pageState')
  })

  it('记录滚动位置不改变路由引用，避免唤醒整个应用和页面转场', () => {
    const nav = useNavigationStore.getState()
    nav.navigateTo({ type: 'artist', id: '1', source: 'qq' })
    const view = useNavigationStore.getState().currentView
    nav.updateArtistPageState('1', 'qq', { scrollTop: 420 })
    expect(useNavigationStore.getState().currentView).toBe(view)
    nav.navigateTo('library')
    nav.goBack()
    expect(useNavigationStore.getState().artistPageState.scrollTop).toBe(420)
  })
})

describe('搜索页导航状态', () => {
  beforeEach(() => useNavigationStore.setState({ currentView: 'explore', history: [], future: [] }))

  it.each(['artist', 'album', 'playlist'] as const)('从 %s 返回时恢复搜索筛选和位置，前进后再次返回仍保留', (kind) => {
    const nav = useNavigationStore.getState()
    const pageState = { category: kind === 'artist' ? 'artists' as const : kind === 'album' ? 'albums' as const : 'playlists' as const, sourceFilter: 'qq' as const, scrollTop: 420 }
    nav.navigateTo({ type: 'search', keyword: '晴天' })
    nav.updateSearchPageState('晴天', pageState)
    const view = useNavigationStore.getState().currentView
    nav.navigateTo(kind === 'artist' ? { type: 'artist', id: 1, source: 'qq' } : {
      type: 'playlist', from: 'explore', playlist: {
        id: 'collection', provider: 'qq', source: 'qq', type: kind, name: '集合', cover: '',
        trackCount: 1, playCount: 0, creator: '',
      },
    })
    nav.goBack()
    expect(useNavigationStore.getState().searchPageState).toEqual(pageState)
    expect(useNavigationStore.getState().currentView).toEqual({ ...view as object, pageState })
    nav.goForward()
    nav.goBack()
    expect(useNavigationStore.getState().searchPageState).toEqual(pageState)
  })

  it('不同历史条目独立保存筛选，同词新搜索也从默认状态开始', () => {
    const nav = useNavigationStore.getState()
    nav.navigateTo({ type: 'search', keyword: '晴天' })
    nav.updateSearchPageState('晴天', { category: 'artists', sourceFilter: 'qq', scrollTop: 200, artistScrollTop: 120 })
    nav.navigateTo({ type: 'search', keyword: '夜曲' })
    nav.updateSearchPageState('夜曲', { category: 'playlists', scrollTop: 300 })
    nav.updateSearchPageState('晴天', { scrollTop: 900 })
    expect(useNavigationStore.getState().searchPageState.scrollTop).toBe(300)
    nav.goBack()
    expect(useNavigationStore.getState().searchPageState).toEqual({ category: 'artists', sourceFilter: 'qq', scrollTop: 200, artistScrollTop: 120 })
    const revision = useNavigationStore.getState().navigationRevision
    nav.navigateTo({ type: 'search', keyword: '晴天' })
    expect(useNavigationStore.getState().navigationRevision).toBeGreaterThan(revision)
    expect(useNavigationStore.getState().searchPageState).toEqual({ category: 'all', sourceFilter: null, scrollTop: 0 })
  })

  it('保存滚动位置不改变路由引用、不清空前进栈，离开后的事件被忽略', () => {
    const nav = useNavigationStore.getState()
    nav.navigateTo({ type: 'search', keyword: '晴天' })
    const view = useNavigationStore.getState().currentView
    nav.updateSearchPageState('晴天', { scrollTop: 420 })
    expect(useNavigationStore.getState().currentView).toBe(view)
    nav.navigateTo('library')
    nav.updateSearchPageState('晴天', { scrollTop: 0 })
    nav.goBack()
    expect(useNavigationStore.getState().searchPageState.scrollTop).toBe(420)
    nav.updateSearchPageState('晴天', { scrollTop: 200 })
    expect(useNavigationStore.getState().future).toHaveLength(1)
  })
})
