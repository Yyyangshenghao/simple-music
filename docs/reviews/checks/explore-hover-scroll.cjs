// 在独立 userData 的 Electron dev 上运行，避免影响用户会话。
// NODE_PATH 指向已有 Playwright 环境，CDP_URL 指向该开发窗口。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9347')
  const page = browser.contexts()[0].pages().find(page => page.url().endsWith('/index.html'))
  try {
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    page.setDefaultTimeout(5000)
    await page.evaluate(async () => {
      // 使用 Vite 当前依赖 URL，避免热更新后的 Context 模块出现双实例。
      const tiltModule = await (await fetch('/src/components/ui/TiltCard.tsx')).text()
      const activityUrl = tiltModule.match(/from "([^" ]*list-scroll-activity[^" ]*)"/)[1]
      const [{ default: React }, { default: { createRoot } }, { TiltCard }, { BorderGlow }, { ToplistCard }, activity, { useSettingsStore }] = await Promise.all([
        import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'),
        import('/src/components/ui/TiltCard.tsx'), import('/src/components/BorderGlow/BorderGlow.tsx'),
        import('/src/components/Explore/ToplistCard.tsx'), import(activityUrl),
        import('/src/stores/settings.ts'),
      ])
      document.querySelector('[data-hover-scroll-check]')?.remove()
      const host = document.createElement('div')
      host.dataset.hoverScrollCheck = ''
      host.style.cssText = 'position:fixed;left:180px;top:150px;width:700px;z-index:999999'
      document.body.append(host)
      const root = createRoot(host)
      const preferences = useSettingsStore.getState().performance
      useSettingsStore.getState().setPerformance({ cardTiltEffect: true, cardSpotlightEffect: true })
      const q = window.hoverScrollCheck = { root, host, clicks: 0, opens: 0, useSettingsStore, preferences }
      const h = React.createElement
      function Harness() {
        const [paused, setPaused] = React.useState(false)
        const viewport = React.useRef(null)
        q.pause = setPaused
        React.useEffect(() => activity.observeListScrollActivity(viewport.current, setPaused, { wheel: true }), [])
        return h('div', { ref: viewport, 'data-explore-scrolling': paused || undefined, style: { display: 'flex', gap: 16, padding: 16, background: 'var(--sm-bg-primary)' } },
          h(activity.ListScrollActivity.Provider, { value: paused },
            ...['A', 'B'].map(name => h(TiltCard, { key: name }, h(BorderGlow, {}, h('button', {
              'data-check-card': name,
              style: { width: 160, height: 180, border: 0, background: 'var(--glass-bg-card)', color: 'var(--sm-text-primary)' },
              onClick: () => q.clicks++,
            }, name)))),
            h(ToplistCard, { entry: { playlist: { id: 'qa', source: 'netease', name: '回归榜单', trackCount: 1 }, preview: [{ name: '测试歌曲', artist: '测试艺人' }] }, onOpen: () => q.opens++ }),
            h('div', { 'data-inner-scroll': '', style: { width: 20, height: 100, overflow: 'auto' } }, h('div', { style: { height: 1000 } })),
          ))
      }
      root.render(h(Harness))
    })
    const host = page.locator('[data-hover-scroll-check]')
    const a = host.locator('[data-check-card="A"]')
    const b = host.locator('[data-check-card="B"]')
    const aTilt = a.locator('../../..')
    const bTilt = b.locator('../../..')
    const top = host.getByRole('button', { name: '回归榜单,共 1 首', exact: true })
    await a.waitFor()
    await a.hover({ position: { x: 140, y: 20 } })
    await page.waitForFunction(() => document.querySelector('[data-check-card="A"]').parentElement.parentElement.parentElement.style.transform.includes('perspective('))
    await page.evaluate(() => window.hoverScrollCheck.pause(true))
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-check-card="A"]').parentElement.parentElement.parentElement).transform === 'none')
    assert.equal(await host.locator('[class*="spotlight_"]').count(), 0)
    assert.equal(await host.locator('.edge-light').first().evaluate(el => getComputedStyle(el).display), 'none')
    // 暂停时从 A 移向 B，恢复后旧卡 A 不得重新上浮。
    await b.hover()
    await b.click()
    assert.equal(await page.evaluate(() => window.hoverScrollCheck.clicks), 1)
    await page.evaluate(() => window.hoverScrollCheck.pause(false))
    await page.waitForTimeout(600)
    assert.equal(await aTilt.evaluate(el => getComputedStyle(el).transform), 'none')
    assert.notEqual(await bTilt.evaluate(el => getComputedStyle(el).transform), 'none')
    assert.equal(await host.locator('[class*="spotlight_"]').count(), 2)
    // 榜单同样暂停、保持点击、恢复悬停。
    await top.hover()
    await page.waitForTimeout(500)
    await page.evaluate(() => window.hoverScrollCheck.pause(true))
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-hover-scroll-check] article')).transform === 'none')
    await top.click({ position: { x: 20, y: 20 } })
    assert.equal(await page.evaluate(() => window.hoverScrollCheck.opens), 1)
    await page.mouse.move(20, 20)
    await page.evaluate(() => window.hoverScrollCheck.pause(false))
    await page.waitForTimeout(400)
    assert.equal(await top.evaluate(el => getComputedStyle(el).transform), 'none')
    await top.hover()
    await page.waitForTimeout(500)
    assert.notEqual(await top.evaluate(el => getComputedStyle(el).transform), 'none')
    // 边界滚轮没有位移也会按时恢复；内部 scroll 不冒泡，必须由 capture 接收。
    await page.mouse.wheel(0, 1)
    await host.locator('[data-explore-scrolling]').waitFor()
    await host.locator('[data-explore-scrolling]').waitFor({ state: 'detached' })
    await host.locator('[data-inner-scroll]').evaluate(el => { el.scrollTop = 20 })
    await host.locator('[data-explore-scrolling]').waitFor()
    await host.locator('[data-explore-scrolling]').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.hoverScrollCheck.useSettingsStore.getState().performance.cardTiltEffect), true)
    console.log(JSON.stringify({ tiltPauseAndResume: true, noStaleHover: true, toplistPauseAndResume: true, clickWhilePaused: true, wheelBoundaryRecovery: true, nestedScrollCapture: true }))
  } finally {
    await page.evaluate(() => {
      const q = window.hoverScrollCheck
      if (!q) return
      q.root.unmount(); q.host.remove()
      q.useSettingsStore.setState({ performance: q.preferences })
      delete window.hoverScrollCheck
    })
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
