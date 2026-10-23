// 回归验证：真实 App 的页面布局设置应同时控制音乐库和应用歌单货架。
// 模拟服务、独立无头浏览器上下文，不读真实账号，不启动音频。
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const H = require('./ui-alignment-2.4.1.cjs')
const root = path.resolve(__dirname, '../../..')
const output = process.env.OUTPUT_DIR || path.join(root, 'docs/reviews/assets/2.4.1-library-layout-preference')

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const server = await createServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: 5190, strictPort: true } })
  let browser
  const results = []
  try {
    await server.listen()
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    for (const [theme, width, height] of [['light', 1536, 864], ['dark', 1536, 864], ['light', 960, 540], ['dark', 960, 540]]) {
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      page.setDefaultTimeout(7000)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await H.installRoutes(context, new Set())
        await page.goto('http://127.0.0.1:5190/docs/reviews/checks/artist-header-space.html')
        await page.waitForFunction(() => typeof window.mountReviewApp === 'function')
        await H.installFixture(page)
        await page.evaluate(async theme => {
          const { useSettingsStore } = await import('/src/stores/settings.ts')
          useSettingsStore.setState({ themeMode: theme, contentLayout: 'framed' })
          const { useNavigationStore } = await import('/src/stores/navigation.ts')
          useNavigationStore.setState({ currentView: 'library', history: [], future: [] })
          localStorage.setItem('simplemusic-library-tab', 'playlists')
          window.mountReviewApp()
        }, theme)
        await page.getByRole('button', { name: /雨天的独处时光/ }).first().waitFor()
        const shelf = () => page.locator('section[aria-label="网易云音乐库"]').last()
        const inspect = () => shelf().evaluate(node => {
          const style = getComputedStyle(node)
          return { border: style.borderTopWidth, radius: style.borderTopLeftRadius, background: style.backgroundColor, padding: style.paddingLeft }
        })
        async function verify(layout) {
          await page.waitForFunction(layout => document.documentElement.dataset.contentLayout === layout, layout)
          const style = await inspect()
          await page.screenshot({ path: path.join(output, `${layout}--${theme}-${width}x${height}.png`) })
          assert.equal(style.border, layout === 'framed' ? '1px' : '0px')
          assert.equal(style.radius, layout === 'framed' ? '18px' : '0px')
          assert.equal(style.padding, layout === 'framed' ? '16px' : '0px')
          if (layout === 'full') assert.equal(style.background, 'rgba(0, 0, 0, 0)')
          else assert.notEqual(style.background, 'rgba(0, 0, 0, 0)')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
          results.push({ theme, width, height, layout, style, ok: true })
        }
        await verify('framed')
        for (const [layout, label] of [['full', '内容延展'], ['framed', '保留边框']]) {
          await H.navigate(page, 'settings')
          // 等待转场，取最新设置页；离场页会短暂保留同名控件。
          await page.waitForTimeout(600)
          await page.getByRole('button', { name: '界面与窗口', exact: true }).last().click()
          const group = page.getByRole('group', { name: '页面布局', exact: true }).last()
          await group.getByRole('button', { name: label, exact: true }).click()
          assert.equal(await group.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'true')
          await H.navigate(page, 'library')
          await shelf().waitFor()
          await page.waitForTimeout(600)
          await verify(layout)
        }
        // 同一货架也被应用歌单复用，切换库标签后继续服从当前设置。
        await H.openLibraryTab(page, 'app-playlists', false)
        const appShelf = page.getByRole('region', { name: '应用歌单', exact: true })
        await appShelf.waitFor()
        assert.equal(await appShelf.evaluate(node => getComputedStyle(node).borderTopWidth), '1px')
        assert.deepEqual(errors, [])
        console.log(`PASS ${theme} ${width}x${height}: framed → full → framed, app shelf`)
      } finally { await context.close() }
    }
  } finally {
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(), environment: 'Headless Chrome, actual App/settings controls, mocked platform data', results }, null, 2) + '\n')
    await browser?.close()
    await server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
