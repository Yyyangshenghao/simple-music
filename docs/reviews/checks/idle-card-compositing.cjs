// 使用独立 userData 启动 Electron dev，再提供现有 Playwright 环境执行本脚本。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9343')
  try {
    const page = browser.contexts()[0].pages().find(page => page.url().endsWith('/index.html'))
    assert.ok(page, '需要已启动的 Electron 开发主窗口')
    await page.evaluate(async () => {
      const [{ default: React }, { default: { createRoot } }, { TiltCard }, { BorderGlow }, { useSettingsStore }] = await Promise.all([
        import('/node_modules/.vite/deps/react.js'),
        import('/node_modules/.vite/deps/react-dom_client.js'),
        import('/src/components/ui/TiltCard.tsx'),
        import('/src/components/BorderGlow/BorderGlow.tsx'),
        import('/src/stores/settings.ts'),
      ])
      const performance = useSettingsStore.getState().performance
      useSettingsStore.setState({ performance: { ...performance, cardTiltEffect: true, cardSpotlightEffect: true } })
      const host = document.createElement('div')
      host.dataset.cardCompositingCheck = ''
      host.style.cssText = 'position:fixed;left:240px;top:200px;width:240px;z-index:99999'
      document.body.append(host)
      const root = createRoot(host)
      const h = React.createElement
      window.cardCheck = { host, root, settings: useSettingsStore, performance, clicks: 0 }
      root.render(h(TiltCard, {}, h(BorderGlow, {}, h('button', {
        style: { width: 240, height: 240, border: 0, background: 'var(--glass-bg-card)', color: 'var(--sm-text-primary)' },
        onClick: () => { window.cardCheck.clicks++ },
      }, '卡片交互回归'))))
    })
    try {
      const card = page.locator('[data-card-compositing-check] [class*="tilt_"]')
      const idle = () => card.evaluate(node => ({
        transform: getComputedStyle(node).transform,
        style: getComputedStyle(node).transformStyle,
        glowTransform: getComputedStyle(node.querySelector('.border-glow-card')).transform,
      }))
      await card.waitFor()
      await page.mouse.move(20, 20)
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-card-compositing-check] [class*="tilt_"]')).transform === 'none')
      assert.deepEqual(await idle(), { transform: 'none', style: 'flat', glowTransform: 'none' })
      await page.mouse.move(460, 220)
      await page.waitForFunction(() => document.querySelector('[data-card-compositing-check] [class*="tilt_"]').style.transform.includes('perspective(800px)'))
      assert.ok((await card.getAttribute('style')).includes('rotate'))
      await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('[data-card-compositing-check] .edge-light')).opacity) > 0)
      await page.getByRole('button', { name: '卡片交互回归', exact: true }).click()
      assert.equal(await page.evaluate(() => window.cardCheck.clicks), 1)
      await page.mouse.move(20, 20)
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-card-compositing-check] [class*="tilt_"]')).transform === 'none')
      assert.deepEqual(await idle(), { transform: 'none', style: 'flat', glowTransform: 'none' })
      await page.evaluate(() => {
        const q = window.cardCheck
        q.settings.setState({ performance: { ...q.performance, cardTiltEffect: false, cardSpotlightEffect: true } })
      })
      await page.mouse.move(460, 220)
      await page.waitForTimeout(250)
      assert.equal((await card.getAttribute('style')).includes('perspective('), false)
      assert.equal(await page.locator('[data-card-compositing-check] [class*="spotlight_"]').count(), 1)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForFunction(() => document.querySelector('[data-card-compositing-check] [class*="spotlight_"]') === null)
      console.log('PASS: 闲置无3D、悬停透视与辉光、回弹释放、点击、独立开关和减少动态')
    } finally {
      await page.emulateMedia({ reducedMotion: null })
      await page.evaluate(() => {
        const q = window.cardCheck
        q.root.unmount()
        q.host.remove()
        q.settings.setState({ performance: q.performance })
        delete window.cardCheck
      })
    }
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
