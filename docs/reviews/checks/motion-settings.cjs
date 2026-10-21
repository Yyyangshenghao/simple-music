// 仅用于独立 userData 的 Electron dev，使用测试文字与歌词，不操作真实账号。
// NODE_PATH 指向 Playwright；CDP_URL 指向开发窗口。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9431')
  const page = browser.contexts()[0].pages().find(page => page.url().endsWith('/index.html'))
  const output = process.env.OUTPUT_DIR || 'docs/reviews/assets/2.4.1-motion-settings'
  fs.mkdirSync(output, { recursive: true })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const cdp = await page.context().newCDPSession(page)
  const result = { environment: 'macOS Electron dev，独立 userData，无播放、无 3D 场景', checks: [], samples: {} }
  const setting = (patch) => page.evaluate(async patch => {
    const { useSettingsStore } = await import('/src/stores/settings.ts')
    useSettingsStore.getState().setPerformance(patch)
  }, patch)
  const navigate = view => page.evaluate(async view => {
    const { useNavigationStore } = await import('/src/stores/navigation.ts')
    useNavigationStore.getState().navigateTo(view)
  }, view)
  const control = label => page.getByRole('switch', { name: label, exact: true })
  const ready = () => page.waitForFunction(() => document.querySelectorAll('[role=switch][aria-label="减少动态效果"]').length === 1)
  async function sample() {
    await cdp.send('HeapProfiler.collectGarbage')
    const start = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
    await page.waitForTimeout(3000)
    const end = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
    return {
      rendererTaskPercent: Number(((end.TaskDuration - start.TaskDuration) / (end.Timestamp - start.Timestamp) * 100).toFixed(2)),
      jsHeapMiB: Number((end.JSHeapUsedSize / 1024 / 1024).toFixed(2)),
      ...await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, animations: document.getAnimations().length }))
    }
  }
  try {
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/stores/settings.ts')
      useSettingsStore.getState().applyPerformancePreset('standard')
      useSettingsStore.getState().setThemeMode('dark')
    })
    await navigate('settings')
    await ready()
    await control('减少动态效果').scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0)
    await cdp.send('Performance.enable')
    result.samples.standard = await sample()
    await control('减少动态效果').click()
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-reduce-motion') && !document.querySelector('canvas'))
    assert.equal(await control('文字逐字显现').isDisabled(), true)
    result.samples.reduced = await sample()
    assert.equal(result.samples.reduced.animations, 0)
    result.checks.push('总开关卸载流体 WebGL，暂停装饰效果与动画，保留单项偏好')

    // 在减少动态期间重新挂载设置页，再关闭总开关；原有 Motion 实例必须恢复动画。
    await navigate('library')
    await navigate('settings')
    await ready()
    await control('减少动态效果').click()
    const button = page.getByRole('group', { name: '动效预设', exact: true }).getByRole('button', { name: '标准', exact: true })
    await button.scrollIntoViewIfNeeded()
    await button.hover()
    await button.evaluate(element => {
      window.motionPressSamples = []
      let frames = 0
      const tick = () => {
        window.motionPressSamples.push(getComputedStyle(element).transform)
        if (++frames < 24) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.mouse.down()
    await page.waitForFunction(() => window.motionPressSamples.length >= 20)
    await page.mouse.up()
    assert.ok(await page.evaluate(() => new Set(window.motionPressSamples).size > 3), '重新启用后已有按钮应恢复弹簧动画')
    result.checks.push('减少动态期间挂载的 Motion 控件在关闭总开关后恢复动画')

    // 使用真实组件验证文字节点与原生逐字动画的资源变化。
    await page.evaluate(async () => {
      const [{ default: React }, { default: ReactDOM }, { RevealText }, { KtvLine }] = await Promise.all([
        import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'),
        import('/src/components/ui/RevealText.tsx'), import('/src/components/Lyrics/KtvLine.tsx')
      ])
      const host = document.createElement('div')
      host.dataset.motionFixture = ''
      host.style.cssText = 'position:fixed;left:0;top:0;width:500px;pointer-events:none;opacity:0.01'
      document.body.append(host)
      const root = ReactDOM.createRoot(host)
      root.render(React.createElement('div', null,
        React.createElement('div', { 'data-reveal-fixture': '' }, React.createElement(RevealText, { text: '说明'.repeat(300) })),
        React.createElement('div', { 'data-lyric-fixture': '' }, React.createElement(KtvLine, {
          words: Array.from({ length: 24 }, (_, i) => ({ text: '词', startMs: i * 300, durationMs: 300 })), lineStartMs: 0, active: true,
        }))
      ))
      window.disposeMotionFixture = () => { root.unmount(); host.remove() }
    })
    await page.waitForFunction(() => document.querySelector('[data-lyric-fixture]')?.getAnimations({ subtree: true }).length === 24)
    result.samples.textNodesBefore = await page.locator('[data-reveal-fixture] span').count()
    await setting({ textRevealMotion: false, lyricsWordMotion: false })
    await page.waitForFunction(() => document.querySelectorAll('[data-reveal-fixture] span').length === 1)
    assert.equal(await page.locator('[data-lyric-fixture]').evaluate(el => el.getAnimations({ subtree: true }).length), 0)
    result.samples.textNodesAfter = await page.locator('[data-reveal-fixture] span').count()
    result.checks.push('文字显现与歌词高亮独立关闭：说明降为一个文本节点，24 个逐字动画全部清理')
    await page.evaluate(() => window.disposeMotionFixture())
    await setting({ textRevealMotion: true, lyricsWordMotion: true })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-reduce-motion'))
    await setting({ reduceMotion: false })
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-reduce-motion')), true)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-reduce-motion'))
    result.checks.push('系统偏好运行中生效，应用开关不能覆盖系统减少动态')

    await setting({ reduceMotion: true })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-reduce-motion'))
    await navigate('settings')
    await ready()
    assert.equal(await control('减少动态效果').getAttribute('aria-checked'), 'true')
    result.checks.push('重载后总开关与各单项选择保留')
    await page.evaluate(async () => {
      const [{ default: React }, { default: ReactDOM }, { ArtistToolbar }] = await Promise.all([
        import('/node_modules/.vite/deps/react.js'), import('/node_modules/.vite/deps/react-dom_client.js'),
        import('/src/components/Artist/ArtistToolbar.tsx')
      ])
      const host = document.createElement('div')
      document.body.append(host)
      const root = ReactDOM.createRoot(host)
      function ToolbarFixture() {
        const scrollRef = React.useRef(null)
        const anchorRef = React.useRef(null)
        return React.createElement('div', { 'data-app-root': '', 'data-toolbar-fixture': '', style: {
          position: 'fixed', top: 0, left: 0, width: 600, height: 400, timelineScope: '--artist-page', '--sm-topbar-height': '52px', opacity: 0.01,
        } }, React.createElement('div', { ref: scrollRef, 'data-toolbar-scroll': '', style: { height: 400, overflow: 'auto' } },
          React.createElement('div', { style: { height: 220 } }, '歌手资料'),
          React.createElement(ArtistToolbar, { scrollRef, anchorRef, active: true, onUserScroll() {}, className: '' },
            React.createElement('button', { style: { height: 40 } }, '吸顶定位测试')),
          React.createElement('div', { style: { height: 1600 } })
        ))
      }
      root.render(React.createElement(ToolbarFixture))
      window.disposeToolbarFixture = () => { root.unmount(); host.remove() }
    })
    await page.waitForFunction(() => document.querySelector('[data-toolbar-fixture] [data-artist-toolbar-scrollable="true"]'))
    await page.locator('[data-toolbar-scroll]').evaluate(el => { el.scrollTop = 600 })
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-toolbar-fixture] [data-artist-toolbar-scrollable]').getBoundingClientRect().top - 52) < 1)
    result.checks.push('减少动态时歌手工具栏的功能性滚动时间线仍正确吸顶')
    await page.evaluate(() => window.disposeToolbarFixture())
    for (const [theme, width, height] of [['dark', 1536, 864], ['light', 960, 720]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await page.evaluate(async theme => {
        const { useSettingsStore } = await import('/src/stores/settings.ts')
        useSettingsStore.getState().setThemeMode(theme)
      }, theme)
      await control('减少动态效果').evaluate(el => el.closest('section').scrollIntoView({ block: 'start' }))
      await page.screenshot({ path: path.join(output, `${theme}-${width}.png`) })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    result.checks.push('深色宽屏与浅色最小宽度设置可用，无横向溢出')
    assert.deepEqual(errors, [])
    result.errors = errors
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await page.evaluate(() => window.disposeMotionFixture?.()).catch(() => {})
    await page.evaluate(() => window.disposeToolbarFixture?.()).catch(() => {})
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
