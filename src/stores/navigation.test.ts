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
