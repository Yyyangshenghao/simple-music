// 仅连接独立 userData 的 Electron dev；模拟账号/内容，不登录、不播放、不写平台。
// NODE_PATH 指向 Playwright；CDP_URL、OUTPUT_DIR 可覆盖默认值。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9478')
  const page = browser.contexts()[0].pages().find(item => item.url().endsWith('/index.html'))
  const output = process.env.OUTPUT_DIR || 'docs/reviews/assets/2026-11-06-platform-previews'
  fs.mkdirSync(output, { recursive: true })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(/\/api\/qishui\/listening-modes(?:\/tracks)?(?:\?|$)/, async route => {
    const tracks = new URL(route.request().url()).pathname.endsWith('/tracks')
    await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: tracks
      ? { songs: [{ id: '1', source: 'qishui', provider: 'qishui', name: '汽水听歌示例', artist: '模拟歌手', duration: 180000 }] }
      : { modes: [{ id: 'default', label: '默认模式' }] } })
  })
  const cdp = await page.context().newCDPSession(page)
  try {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    await page.evaluate(async () => {
      const { listProviders } = await import('/src/providers/registry.ts')
      const { serviceFor } = await import('/src/lib/service-registry.ts')
      const { appleMusicService } = await import('/src/providers/apple-music-provider.ts')
      const { clearProviderRequestCache } = await import('/src/lib/provider-request-cache.ts')
      const { clearToplistCaches } = await import('/src/lib/toplist-cache.ts')
      const { useProviderStore } = await import('/src/stores/providers.ts')
      const { useSettingsStore } = await import('/src/stores/settings.ts')
      const { useNavigationStore } = await import('/src/stores/navigation.ts')
      const { useRecentPlaysStore } = await import('/src/stores/recent.ts')
      const { useAppPlaylistsStore } = await import('/src/stores/app-playlists.ts')
      const track = source => ({ id: `${source}-demo`, source, provider: source, type: 'track', name: `${source} 示例歌曲`, artist: '模拟歌手', artists: [{ name: '模拟歌手', id: 1 }], album: '模拟专辑', duration: 180000, cover: '' })
      const playlist = (source, name, type = 'playlist') => ({ id: `${source}-${name}`, source, provider: source, type, name, creator: '模拟账号', cover: '', trackCount: 6, playCount: 100 })
      clearProviderRequestCache()
      clearToplistCaches()
      for (const provider of listProviders()) {
        const source = provider.descriptor.id
        if (provider.recommendations) provider.recommendations.load = async id => {
          const surface = provider.recommendations.listSurfaces().find(item => item.id === id)
          const content = surface.kind === 'playlist-feed' ? { type: 'playlists', playlists: [playlist(source, '推荐歌单示例')] }
            : surface.kind === 'radar' ? { type: 'radar', radar: { playlist: playlist(source, '雷达示例'), tracks: [track(source)] } }
              : { type: 'tracks', tracks: [track(source)] }
          return { content }
        }
        if (provider.library) {
          if (provider.library.getUserPlaylists) provider.library.getUserPlaylists = async () => [playlist(source, '我的歌单示例')]
          if (provider.library.getLikedPlaylist) provider.library.getLikedPlaylist = async () => playlist(source, '收藏歌曲示例')
          if (provider.library.getUserAlbums) provider.library.getUserAlbums = async () => [playlist(source, '收藏专辑示例', 'album')]
        }
        if (provider.history) {
          if (provider.history.getRecentTracks) provider.history.getRecentTracks = async () => [track(source)]
          if (provider.history.getRecentPlaylists) provider.history.getRecentPlaylists = async () => [playlist(source, '最近播放示例')]
        }
        if (source === 'qishui') provider.catalog.searchPlaylists = async keyword => [playlist(source, `${keyword}歌单示例`)]
        const service = serviceFor(source)
        if (service.getToplists) service.getToplists = async () => [{ name: '示例榜单分组', entries: [{ playlist: playlist(source, '排行榜示例'), updateFrequency: '每日更新', preview: [{ name: '示例榜单歌曲', artist: '模拟歌手', cover: '' }] }] }]
        useSettingsStore.getState().setExploreLayout(source, [])
      }
      appleMusicService.getRecommendationGroups = async () => [{ id: 'demo', title: '为你推荐示例', items: [playlist('apple', '个性化歌单示例')] }]
      appleMusicService.getChartPlaylistsPage = async () => ({ playlists: [playlist('apple', '热门歌单示例')] })
      appleMusicService.getStorefrontChartPlaylists = async () => [playlist('apple', '地区榜单示例')]
      useRecentPlaysStore.setState({ items: [{ track: track('qishui'), playedAt: Date.now() }] })
      useAppPlaylistsStore.setState({ items: [{ id: 'demo-saved', name: '已整理汽水示例歌单', tracks: [track('qishui')], createdAt: Date.now(), updatedAt: Date.now() }], error: '' })
      useProviderStore.setState(state => ({ byId: Object.fromEntries(Object.entries(state.byId).map(([source, runtime]) => [source, { ...runtime, enabled: true, auth: source === 'bilibili' ? 'anonymous' : 'authenticated', playbackAvailable: true, profile: { nickname: '模拟账号', avatar: '' } }])) }))
      useNavigationStore.getState().navigateTo('settings')
    })
    await page.waitForTimeout(650)
    const platforms = [
      { source: 'qq', name: 'QQ音乐', first: 'recommendations', toggle: '我的歌单', selector: '[aria-label="qq账号歌单"]' },
      { source: 'apple', name: 'Apple Music', first: 'apple-recommendations', toggle: '个人资料库精选', selector: '[aria-label="Apple Music 个人资料库精选"]' },
      { source: 'kugou', name: '酷狗音乐', first: 'recommendations', toggle: '我的歌单', selector: '[aria-label="kugou账号歌单"]' },
      { source: 'qishui', name: '汽水音乐', first: 'listening', toggle: '已整理的歌单', selector: 'section[aria-label="含汽水音乐的应用歌单"]' },
    ]
    const results = []
    for (const platform of platforms) {
      const gear = page.getByRole('button', { name: `${platform.name}设置`, exact: true })
      const panel = page.getByRole('dialog', { name: `${platform.name}设置`, exact: true })
      const preview = page.locator('[data-explore-preview]')
      for (const [width, height] of [[1536, 864], [960, 540]]) for (const theme of ['dark', 'light']) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        await page.evaluate(async theme => {
          const { useSettingsStore } = await import('/src/stores/settings.ts')
          useSettingsStore.getState().setThemeMode(theme)
        }, theme)
        // 后台真实账号状态可能覆盖模拟运行态；打开前恢复本场景投影。
        await page.evaluate(async source => {
          const { useProviderStore } = await import('/src/stores/providers.ts')
          useProviderStore.setState(state => ({ byId: { ...state.byId, [source]: { ...state.byId[source], enabled: true, auth: 'authenticated', playbackAvailable: true, profile: { nickname: '模拟账号', avatar: '' } } } }))
        }, platform.source)
        await gear.scrollIntoViewIfNeeded()
        await gear.click()
        await panel.waitFor()
        await preview.locator(platform.selector).waitFor({ state: 'attached' })
        await page.waitForTimeout(350)
        const box = await panel.boundingBox()
        const view = await preview.boundingBox()
        assert.ok(box.x >= 0 && box.y >= 60 && box.y + box.height <= height)
        assert.ok(view.x >= box.x && view.x + view.width <= box.x + box.width)
        assert.ok(view.y + view.height <= box.y + box.height)
        assert.equal(await preview.locator('[inert]').count(), 1)
        // 不只检查外框：内部横排内容也必须留在真实页面画布内。
        const overflow = await preview.locator('[inert]').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }))
        assert.ok(overflow.scrollWidth <= overflow.width + 1, `${platform.source} 预览内部横向溢出：${JSON.stringify(overflow)}`)
        if (platform.source === 'qq') {
          const infoWidth = await preview.locator('[inert]').evaluate(el => {
            const title = Array.from(el.querySelectorAll('p')).find(item => item.textContent === '推荐歌单示例')
            return title?.parentElement.clientWidth ?? 0
          })
          assert.ok(infoWidth >= 120, `QQ 推荐歌单说明被挤窄：${infoWidth}px`)
        }
        await page.screenshot({ path: `${output}/${platform.source}-${theme}-${width}x${height}.png` })
        if (width === 960 && theme === 'light') {
          // 真实鼠标切换平台专属模块，预览组件同步卸载/挂载。
          const toggle = panel.getByRole('switch', { name: `展示${platform.toggle}`, exact: true })
          await toggle.click()
          assert.equal(await preview.locator(platform.selector).count(), 0)
          await toggle.click()
          await preview.locator(platform.selector).waitFor({ state: 'attached' })
          // 首项移至第二位，预览实际DOM同时重排。
          await panel.locator('[data-provider-settings-scroll]').evaluate(el => { el.scrollTop = 0 })
          const rows = panel.locator('[data-reorder-row]')
          const from = await rows.nth(0).boundingBox()
          const to = await rows.nth(1).boundingBox()
          await page.mouse.move(from.x + 18, from.y + from.height / 2)
          await page.mouse.down()
          await page.mouse.move(to.x + 18, to.y + to.height - 8, { steps: 15 })
          await page.mouse.up()
          await page.waitForTimeout(600)
          const ids = await page.evaluate(async source => {
            const { useSettingsStore } = await import('/src/stores/settings.ts')
            return useSettingsStore.getState().exploreLayouts[source].map(item => item.id)
          }, platform.source)
          assert.equal(ids[1], platform.first)
          const toggledModule = await preview.locator(platform.selector).boundingBox()
          const firstModule = platform.source === 'apple' ? await preview.locator('[aria-label="Apple Music 内容发现"]').boundingBox()
            : platform.source === 'qishui' ? await preview.locator('[aria-label="汽水继续听"]').boundingBox()
              : await preview.locator('div[aria-label$="推荐"]').boundingBox()
          assert.ok(toggledModule.y < firstModule.y)
          await panel.getByRole('button', { name: '恢复默认', exact: true }).click()
        }
        await page.keyboard.press('Escape')
        await panel.waitFor({ state: 'detached' })
        results.push({ source: platform.source, width, height, theme, panel: box, preview: view })
      }
      // 停用后拒绝设置，重新启用保留配置。
      await page.evaluate(async source => {
        const { useProviderStore } = await import('/src/stores/providers.ts')
        useProviderStore.getState().setEnabled(source, false)
      }, platform.source)
      await page.waitForFunction(label => Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === label && button.disabled), `${platform.name}设置`)
      assert.equal(await gear.isDisabled(), true)
      await page.evaluate(async source => {
        const { useProviderStore } = await import('/src/stores/providers.ts')
        useProviderStore.getState().setEnabled(source, true)
      }, platform.source)
    }
    // B站没有探索栏目，保留平台专属封面设置。
    await page.evaluate(async () => {
      const { useProviderStore } = await import('/src/stores/providers.ts')
      useProviderStore.setState(state => ({ byId: { ...state.byId, bilibili: { ...state.byId.bilibili, enabled: true, auth: 'anonymous', playbackAvailable: true } } }))
    })
    const bili = page.getByRole('button', { name: '哔哩哔哩设置', exact: true })
    await bili.scrollIntoViewIfNeeded()
    await bili.click()
    const biliPanel = page.getByRole('dialog', { name: '哔哩哔哩设置', exact: true })
    await biliPanel.waitFor()
    assert.equal(await biliPanel.getByRole('switch', { name: '哔哩哔哩显示专辑封面' }).count(), 1)
    assert.equal(await page.locator('[data-explore-preview]').count(), 0)
    await page.keyboard.press('Escape')
    assert.deepEqual(errors, [])
    const result = { environment: 'macOS隔离Electron dev，全部账号与内容为模拟，不执行登录/播放/平台写入', results, checks: ['四平台×深浅主题×两种尺寸', '平台专属模块开关同步预览', '真实拖动同步预览顺序', '停用后禁用设置', 'B站保留专属设置，无虚构探索模块'], errors }
    fs.writeFileSync(`${output}/verification.json`, JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ states: results.length, checks: result.checks, errors }))
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
