// 仅在独立 userData 的 Electron dev 中运行，脚本会替换测试实例的账号、API、封面资料。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9347')
  try {
    const context = browser.contexts()[0]
    const page = context.pages().find(p => p.url().endsWith('/index.html'))
    page.setDefaultTimeout(5000)
    await page.reload()
    await context.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ playlists: [], tracks: [], songs: [], liked: {}, loggedIn: true, loginMode: 'web', configured: true, ready: true, managed: false, connected: true, subscription: 'active', storefront: 'cn' }) }))
    await context.route('https://covers.invalid/**', route => route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.resolve(__dirname, '../../../build/icon.png')) }))
    for (const host of context.pages().filter(p => p.url().includes('playback-host.html'))) {
      await host.evaluate(async () => {
        const [{ useProviderStore }, { useSettingsStore }] = await Promise.all([import('/src/stores/providers.ts'), import('/src/stores/settings.ts')])
        useSettingsStore.getState().setNeteaseLoggedIn(true)
        useProviderStore.setState({ byId: Object.fromEntries(['netease', 'qq', 'apple'].map(id => [id, { enabled: true, auth: 'authenticated' }])), contentSource: 'netease' })
      })
    }
    await page.evaluate(async () => {
      const [{ useProviderStore: providers }, { useSettingsStore: settings }, { useNavigationStore: navigation }, cache] = await Promise.all([
        import('/src/stores/providers.ts'), import('/src/stores/settings.ts'), import('/src/stores/navigation.ts'), import('/src/lib/provider-request-cache.ts'),
      ])
      navigation.getState().navigateTo('explore')
      providers.setState({ byId: Object.fromEntries(['netease', 'qq', 'apple'].map(id => [id, { enabled: false, auth: 'anonymous' }])), contentSource: null })
      await new Promise(resolve => setTimeout(resolve, 300))
      cache.clearProviderRequestCache()
      const seed = (source, scope, data) => cache.requestProviderData(source, scope, async () => data, { maxAgeMs: 300000 })
      for (const source of ['netease', 'qq', 'apple']) {
        const items = (type, label) => Array.from({ length: 24 }, (_, i) => ({ source, provider: source, type, id: `${type}-${i}`, name: `${source}-${label}${i + 1}`, cover: `https://covers.invalid/${source}-${type}-${i}.png`, trackCount: 36, playCount: 0, creator: '测试账号' }))
        await seed(source, `library:user-playlists${source === 'qq' ? ':0' : ''}`, items('playlist', '歌单'))
        await seed(source, 'library:user-albums', items('album', '专辑'))
        await seed(source, `library:liked-playlist${source === 'qq' ? ':0' : ''}`, items('playlist', '收藏').slice(0, 1))
      }
      settings.getState().setNeteaseLoggedIn(true)
      settings.getState().setPerformance({ cardTiltEffect: true, cardSpotlightEffect: true })
      settings.getState().setThemeMode('dark')
      providers.setState({ byId: Object.fromEntries(['netease', 'qq', 'apple'].map(id => [id, { enabled: true, auth: 'authenticated' }])), contentSource: 'netease' })
      window.libraryScrollQA = { providers, settings, navigation }
      navigation.getState().navigateTo('library')
    })
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false })
    await page.bringToFront()
    const tabs = page.getByRole('group', { name: '我的库分类' })
    const viewport = page.getByRole('heading', { name: '我的库', exact: true }).locator('../../..')
    if (process.env.PERFORMANCE) {
    await tabs.getByRole('button', { name: '歌单', exact: true }).click()
    await viewport.locator('.border-glow-card').first().waitFor()
    await viewport.evaluate(el => { el.scrollTop = 0 })
    await page.mouse.move(160,350);await page.waitForTimeout(700)
    await viewport.evaluate(el => {
      const q=window.libraryScrollQA
      q.measure={events:{},travel:0,last:el.scrollTop}
      q.capture=e=>{const m=q.measure;m.events[e.type]=(m.events[e.type]||0)+1;if(e.type==='scroll'&&e.target===el){m.travel+=Math.abs(el.scrollTop-m.last);m.last=el.scrollTop}}
      for(const name of ['scroll','wheel','pointerover','pointerout','pointermove'])el.addEventListener(name,q.capture,true)
    })
    const done=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve))
    await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReturnAsStream'})
    for(let i=0;i<96;i++){await page.mouse.wheel(0,Math.floor(i/24)%2===0?25:-25);await new Promise(r=>setTimeout(r,16))}
    await cdp.send('Tracing.end')
    const {stream}=await done;let data=''
    while(true){const part=await cdp.send('IO.read',{handle:stream});data+=part.data;if(part.eof)break}
    await cdp.send('IO.close',{handle:stream})
    const sums={}
    for(const event of JSON.parse(data).traceEvents)if(event.ph==='X'&&event.dur&&['UpdateLayoutTree','Layout','Paint'].includes(event.name)){const sum=sums[event.name]||={ms:0,count:0};sum.ms+=event.dur/1000;sum.count++}
    const measure=await viewport.evaluate(el=>{const q=window.libraryScrollQA;for(const name of ['scroll','wheel','pointerover','pointerout','pointermove'])el.removeEventListener(name,q.capture,true);return q.measure})
    console.log(JSON.stringify({measure,sums}))
      return
    }
    const results = []
    for (const source of ['netease', 'qq', 'apple']) {
      await page.evaluate(source => window.libraryScrollQA.providers.setState({ contentSource: source }), source)
      const modes = ['歌单', ...(await tabs.getByRole('button', { name: '专辑', exact: true }).count() ? ['专辑'] : []), '收藏']
      for (const mode of modes) {
        await tabs.getByRole('button', { name: mode, exact: true }).click()
        const card = viewport.getByRole('button', { name: new RegExp(`^(歌单|专辑)：${source}-${mode}1，`) })
        await card.waitFor()
        await viewport.evaluate(el => { el.scrollTop = 0 })
        await page.waitForTimeout(300)
        await card.hover({ position: { x: 20, y: 20 } })
        await page.waitForTimeout(400)
        const tilt = card.locator('../../..')
        assert.notEqual(await tilt.evaluate(el => getComputedStyle(el).transform), 'none')
        await page.mouse.wheel(0, 5)
        await page.waitForFunction(() => document.querySelector('[class*="viewport_"][data-scrolling]'))
        await page.waitForFunction(() => [...document.querySelectorAll('[class*="tilt_"][data-scrolling]')].every(el => getComputedStyle(el).transform === 'none'))
        assert.equal(await viewport.locator('[class*="spotlight_"]').count(), 0)
        assert.equal(await viewport.locator('.edge-light').first().evaluate(el => getComputedStyle(el).display), 'none')
        await page.waitForTimeout(250)
        assert.equal(await viewport.getAttribute('data-scrolling') !== null, true, '滚轮停顿保持暂停')
        await card.hover({ position: { x: 25, y: 25 } })
        await page.waitForFunction(() => !document.querySelector('[class*="viewport_"][data-scrolling]'))
        assert.ok(await viewport.locator('[class*="spotlight_"]').count() > 0)
        // 原生坐标点击不等待卡片动画稳定，验证暂停中的点击仍可进入详情。
        const box = await card.boundingBox()
        await page.mouse.move(box.x + 30, box.y + 30)
        await page.mouse.wheel(0, 1)
        await page.waitForFunction(() => document.querySelector('[class*="viewport_"][data-scrolling]'))
        await page.mouse.click(box.x + 30, box.y + 28)
        await page.waitForFunction(() => window.libraryScrollQA.navigation.getState().currentView?.type === 'playlist')
        await page.evaluate(() => window.libraryScrollQA.navigation.getState().goBack())
        await tabs.waitFor()
        results.push({ source, mode, paused: true, resumed: true, clickWhileScrolling: true, back: true })
      }
    }
    await tabs.getByRole('button', { name: '应用歌单', exact: true }).click()
    assert.equal(await viewport.locator('.border-glow-card').count(), 0)
    assert.equal(await page.evaluate(() => window.libraryScrollQA.settings.getState().performance.cardTiltEffect), true)
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true })
      await tabs.getByRole('button', { name: '歌单', exact: true }).click()
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => window.libraryScrollQA.settings.getState().setThemeMode(theme), theme)
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: theme === 'dark' ? 1280 : 960, height: 800, deviceScaleFactor: 2, mobile: false })
        await page.mouse.move(10, 350)
        await page.waitForTimeout(500)
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR, `${theme}.png`), Buffer.from(data, 'base64'))
      }
    }
    console.log(JSON.stringify({ results, appPlaylistsWithoutGlow: true, preferencesPreserved: true }))
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
