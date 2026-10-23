// 真实 App + 模拟平台，无头 Chrome；每个场景使用独立上下文，不接触用户账号或音频。
// NODE_PATH=<含 playwright 的 node_modules> node docs/reviews/checks/artist-header-space.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const H = require('./ui-alignment-2.4.1.cjs')

const root = path.resolve(__dirname, '../../..')
const output = path.join(root, 'docs/reviews/assets/2.4.1-artist-header-balance')
const longName = 'Florence + The Machine 与她的朋友们现场特别企划'
const cases = [
  ['before', 'light', 1536, 864, 'normal'],
  ['after', 'light', 1536, 864, 'normal'],
  ['after', 'dark', 1536, 864, 'normal'],
  ['before', 'light', 1536, 864, 'long'],
  ['after', 'light', 1536, 864, 'long'],
  ['after', 'light', 960, 540, 'normal'],
  ['after', 'light', 960, 540, 'long'],
  ['after', 'dark', 960, 540, 'long'],
  ['after', 'light', 1025, 768, 'long'],
  ['after', 'light', 1024, 768, 'long'],
  ['after', 'light', 1536, 864, 'no-description'],
]

async function main() {
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const server = await createServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: 5189, strictPort: true } })
  let browser
  const results = []
  try {
    await server.listen()
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    for (const [phase, theme, width, height, variant] of cases) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await H.installRoutes(context, new Set())
        await page.goto('http://127.0.0.1:5189/docs/reviews/checks/artist-header-space.html')
        await page.waitForFunction(() => typeof window.mountReviewApp === 'function')
        await H.installFixture(page)
        await page.evaluate(async ({ variant, longName, theme }) => {
          const { neteaseService } = await import('/src/lib/service-registry.ts')
          const original = neteaseService.getArtistDetail
          neteaseService.getArtistDetail = async id => {
            const artist = await original(id)
            return { ...artist, name: variant === 'long' ? longName : artist.name, description: variant === 'no-description' ? '' : artist.description }
          }
          const { useSettingsStore } = await import('/src/stores/settings.ts')
          useSettingsStore.getState().setThemeMode(theme)
          const { useNavigationStore } = await import('/src/stores/navigation.ts')
          useNavigationStore.setState({ currentView: { type: 'artist', id: 'netease-artist-0', source: 'netease' }, history: [], future: [] })
          const { usePlaylistStore } = await import('/src/stores/playlist.ts')
          window.reviewQueue = []
          usePlaylistStore.setState({ setQueue: tracks => { window.reviewQueue = tracks.map(track => `${track.source}:${String(track.id)}`) } })
          window.mountReviewApp()
        }, { variant, longName, theme })
        await page.getByRole('heading', { level: 1 }).waitFor()
        await page.waitForTimeout(350)
        if (phase === 'before') {
          const css = fs.readFileSync(path.join(output, 'before.module.css'), 'utf8')
          const mapping = await page.evaluate(async () => (await import('/src/components/Artist/ArtistHeader.module.css')).default)
          const scoped = text => text.replace(/\.([a-zA-Z][\w-]*)\b/g, (match, name) => mapping[name] ? `.${mapping[name]}` : match)
          await page.addStyleTag({ content: scoped('.description { width: auto; max-width: none; justify-self: stretch; }\n' + css) })
        }
        await H.settle(page, 700)
        const geometry = await page.evaluate(() => {
          const heading = document.querySelector('h1')
          const info = heading.parentElement
          const identity = info.parentElement
          const content = identity.parentElement
          const header = content.parentElement
          const description = content.querySelector('section')
          const rect = node => node && Object.fromEntries(['x', 'y', 'width', 'height', 'right', 'bottom'].map(key => [key, Math.round(node.getBoundingClientRect()[key] * 10) / 10]))
          const toolbar = document.querySelector('[data-artist-toolbar-scrollable]')
          return {
            heading: rect(heading), info: rect(info), identity: rect(identity), content: rect(content), header: rect(header), description: rect(description), toolbar: rect(toolbar),
            overflow: document.documentElement.scrollWidth > innerWidth,
            headingOverflow: heading.scrollWidth > heading.clientWidth + 1,
            fontSize: getComputedStyle(heading).fontSize,
            pinned: toolbar?.dataset.artistToolbarPinned,
          }
        })
        assert.equal(geometry.overflow, false)
        assert.equal(geometry.headingOverflow, false)
        assert.equal(geometry.fontSize, '32px')
        assert.ok(geometry.heading.bottom <= geometry.header.bottom)
        assert.ok(geometry.toolbar.y >= geometry.header.bottom - 1)
        assert.equal(geometry.pinned, 'false')
        if (phase === 'after' && variant !== 'no-description') {
          const { identity, description, content } = geometry
          if (width > 1024) {
            assert.ok(identity.right < description.x)
            assert.ok(description.width <= 641)
            assert.ok(identity.width >= 540)
            assert.ok(description.x - content.x < 720, '简介被推得过右')
          } else {
            assert.ok(description.y >= identity.bottom + 20)
          }
        }
        if (variant === 'no-description') {
          assert.equal(geometry.description, null)
          assert.ok(geometry.identity.width > 1300)
        }
        const file = `${phase}-${variant}--${theme}-${width}x${height}.png`
        await page.screenshot({ path: path.join(output, file) })
        let scrolledDescription = null
        if (phase === 'after' && variant === 'long' && width === 960 && theme === 'light') {
          scrolledDescription = await page.getByRole('heading', { level: 1 }).evaluate(node => {
            const viewport = node.closest('[class*="_viewport_"]')
            viewport.scrollTop = 180
            return viewport.scrollTop
          })
          assert.ok(scrolledDescription > 0)
          await page.waitForTimeout(150)
          const bounds = await page.getByRole('button', { name: '歌手简介', exact: true }).evaluate(node => {
            const section = node.closest('section').getBoundingClientRect()
            return { top: section.top, bottom: section.bottom }
          })
          assert.ok(bounds.top >= 52 && bounds.bottom < height - 110)
          await page.screenshot({ path: path.join(output, 'after-long-scrolled--light-960x540.png') })
        }
        let expandedScroll = null
        if (variant === 'normal' && phase === 'after' && width === 1536) {
          const trigger = page.getByRole('button', { name: '歌手简介', exact: true })
          await trigger.click()
          await page.waitForTimeout(350)
          assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
          const full = page.getByLabel('完整歌手简介', { exact: true })
          expandedScroll = await full.evaluate(node => { node.scrollTop = 60; return { top: node.scrollTop, total: node.scrollHeight, height: node.clientHeight } })
          assert.ok(expandedScroll.top > 0)
          await trigger.click()
          assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
          await page.getByRole('button', { name: '▶ 播放全部', exact: true }).click()
          assert.ok(await page.evaluate(() => window.reviewQueue.length > 10))
        }
        assert.deepEqual(errors, [])
        results.push({ phase, theme, width, height, variant, file, geometry, expandedScroll, scrolledDescription, errors, ok: true })
        console.log(`PASS ${file}`)
      } finally { await context.close() }
    }
    for (const variant of ['normal', 'long']) {
      const before = results.find(item => item.phase === 'before' && item.variant === variant)
      const after = results.find(item => item.phase === 'after' && item.variant === variant && item.width === 1536 && item.theme === 'light')
      // 保留长名字宽度，同时让简介相对上版向中间收回。
      if (variant === 'long') assert.ok(after.geometry.info.width >= 380)
      assert.ok(after.geometry.description.x < before.geometry.description.x - 150)
    }
  } finally {
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(), environment: 'Headless installed Chrome, real React App + CSS, mocked services, no Electron preload or audio runtime', results }, null, 2) + '\n')
    await browser?.close()
    await server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
