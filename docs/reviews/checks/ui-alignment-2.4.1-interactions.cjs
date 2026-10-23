// 2.4.1 非设置页 UI 对齐：交互验收（与截图脚本共用 MOCK fixture 与独立 profile 的 dev 实例）。
// 用法：NODE_PATH=<含 playwright 的 node_modules> node docs/reviews/checks/ui-alignment-2.4.1-interactions.cjs
// 结果写入 docs/reviews/assets/2.4.1-ui-alignment/interactions.json；任一检查失败时进程退出码为 1。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const { installRoutes, installFixture, navigate, setTheme, openLibraryTab, sectionsReady, reset } = require('./ui-alignment-2.4.1.cjs')

const root = path.resolve(__dirname, '../../..')
const output = process.env.OUTPUT_FILE || path.join(root, 'docs/reviews/assets/2.4.1-ui-alignment/interactions.json')
const KEYWORD = '夜航星'

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9461')
  const context = browser.contexts()[0]
  const page = context.pages().find((p) => p.url().endsWith('/index.html'))
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installRoutes(context, new Set())
  const cdp = await context.newCDPSession(page)
  const checks = []

  async function fresh({ width = 1536, height = 864, theme = 'dark', mode = 'normal' } = {}) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1200)
    await installFixture(page, mode)
    await setTheme(page, theme)
    await reset(page)
  }
  async function check(name, fn) {
    try {
      const detail = await fn()
      checks.push({ name, ok: true, ...(detail ? { detail } : {}) })
      console.log(`✓ ${name}`)
    } catch (error) {
      checks.push({ name, ok: false, error: error.message.split('\n')[0] })
      console.log(`✗ ${name}: ${error.message.split('\n')[0]}`)
    }
  }
  const trackRows = () => page.locator('section[aria-label="歌曲搜索结果"] [data-selection-key^="track:"]').count()

  try {
    await fresh()
    await navigate(page, { type: 'search', keyword: KEYWORD })
    await sectionsReady(page, '歌曲搜索结果')
    await sectionsReady(page, '歌单搜索结果')
    // 等上一页的离场转场结束，只剩一个搜索页再操作。
    await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"]').length === 1)

    await check('搜索「全部」只预览前 10 首，并提供查看全部歌曲入口', async () => {
      assert.equal(await trackRows(), 10)
      const button = page.getByRole('button', { name: '查看全部52首歌曲' })
      assert.equal(await button.count(), 1)
      for (const label of ['查看全部9位歌手', '查看全部16张专辑', '查看全部16个歌单']) {
        assert.equal(await page.getByRole('button', { name: label }).count(), 1, label)
      }
      return { rows: 10 }
    })

    await check('查看全部切到歌曲分类：完整 52 首、回到顶部、类型按钮同步选中', async () => {
      await page.locator('[class*="page"]').first().evaluate((node) => { node.scrollTop = 240 })
      await page.getByRole('button', { name: '查看全部52首歌曲' }).click()
      await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"] [data-selection-key^="track:"]').length === 52)
      assert.equal(await page.getByRole('group', { name: '筛选搜索类型' }).getByRole('button', { name: '歌曲' }).getAttribute('aria-pressed'), 'true')
      assert.equal(await page.locator('section[aria-label="歌手搜索结果"]').count(), 0)
      const top = await page.evaluate(() => [...document.querySelectorAll('div')].find((node) => node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== 'visible' && node.querySelector('section[aria-label="歌曲搜索结果"]'))?.scrollTop)
      assert.equal(top, 0)
      return { rows: 52, scrollTop: top }
    })

    await check('来源筛选：QQ 音乐只显示 12 首，返回全部平台恢复 52 首', async () => {
      await page.getByRole('group', { name: '筛选搜索来源' }).getByRole('button', { name: /QQ音乐/ }).click()
      await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"] [data-selection-key^="track:"]').length === 12)
      await page.getByRole('group', { name: '筛选搜索来源' }).getByRole('button', { name: '全部平台' }).click()
      await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"] [data-selection-key^="track:"]').length === 52)
    })

    await check('类型切回「全部」重新进入预览，结果顺序不变（首项仍为第 1 首）', async () => {
      await page.getByRole('group', { name: '筛选搜索类型' }).getByRole('button', { name: '全部' }).click()
      await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"] [data-selection-key^="track:"]').length === 10)
      const first = await page.locator('section[aria-label="歌曲搜索结果"] [data-selection-key^="track:"]').first().getAttribute('data-selection-key')
      assert.equal(first, 'track:netease:netease-song-0')
    })

    await check('搜索结果多选只覆盖可见预览条目', async () => {
      await page.getByRole('button', { name: '歌曲搜索结果更多操作' }).click()
      await page.getByRole('menuitem', { name: /多选/ }).click()
      const selectAll = page.getByRole('button', { name: /全选/ }).first()
      await selectAll.click()
      const checked = await page.locator('[role="checkbox"][aria-checked="true"]').count()
      await page.keyboard.press('Escape')
      // 10 首歌曲 + 6 张专辑 + 6 个歌单可见预览
      assert.equal(checked, 22)
      return { checked }
    })

    await check('顶栏搜索空闲显示用途提示，点击后输入框带占位文字', async () => {
      const prompt = page.locator('[role="search"] span[aria-hidden="true"]', { hasText: '搜索歌曲、歌手' })
      assert.equal(await prompt.isVisible(), true)
      await page.locator('[role="search"]').click()
      const input = page.locator('[role="search"] input')
      await input.waitFor()
      assert.equal(await input.getAttribute('placeholder'), '搜索歌曲、歌手')
      await page.keyboard.press('Escape')
    })

    await check('歌手简介：默认限宽截断，可展开并收起', async () => {
      await navigate(page, { type: 'artist', id: 'netease-artist-0', source: 'netease' })
      const trigger = page.getByRole('button', { name: '歌手简介' }).last()
      await trigger.waitFor()
      const width = await page.locator('[class*="descriptionPreview"]').last().evaluate((node) => node.getBoundingClientRect().width)
      assert.ok(width <= 640.5, `简介宽度 ${width}`)
      await trigger.click({ force: true })
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
      await trigger.click({ force: true })
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
      return { previewWidth: Math.round(width) }
    })

    await check('歌手页返回按钮、标签栏、歌曲列表与库页共享内容起线（±1px）', async () => {
      const contentLeft = (selector) => page.locator(selector).first().evaluate((node) => node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingLeft))
      const artist = {
        back: await page.getByRole('button', { name: '返回上一页' }).first().evaluate((node) => node.parentElement.getBoundingClientRect().left),
        tabs: await contentLeft('[class*="subTabs"]'),
        list: await contentLeft('[class*="trackList"]'),
      }
      await openLibraryTab(page, 'playlists')
      await page.waitForTimeout(600)
      const library = await page.locator('h1', { hasText: '我的库' }).evaluate((node) => node.parentElement.getBoundingClientRect().left)
      for (const [name, value] of Object.entries(artist)) assert.ok(Math.abs(value - library) <= 1, `${name}=${value} library=${library}`)
      return { ...Object.fromEntries(Object.entries(artist).map(([k, v]) => [k, Math.round(v * 10) / 10])), library: Math.round(library * 10) / 10 }
    })

    await check('从库进入歌单详情再返回：封面可见，返回库并保留歌单标签', async () => {
      await page.getByRole('button', { name: /华语经典回顾/ }).first().click({ force: true })
      await page.locator('[class*="detailCover"]').first().waitFor()
      await page.waitForTimeout(800)
      assert.equal(await page.locator('[class*="detailCover"]').first().evaluate((node) => getComputedStyle(node).visibility), 'visible')
      await page.mouse.move(40, 95)
      await page.getByRole('button', { name: '返回上一页' }).first().click()
      await page.locator('h1', { hasText: '我的库' }).waitFor()
      await page.getByRole('button', { name: /雨天的独处时光/ }).first().waitFor()
    })

    await check('新建歌单对话框：取消关闭', async () => {
      await page.getByRole('button', { name: /新建/ }).first().click()
      const dialog = page.getByRole('dialog').first()
      await dialog.waitFor()
      const title = await dialog.locator('h2').first().evaluate((node) => getComputedStyle(node).fontSize)
      await dialog.getByRole('button', { name: '取消' }).click()
      await page.waitForFunction(() => !document.querySelector('dialog[open]'))
      return { titleFontSize: title }
    })

    await check('关闭窗口对话框错误文字使用危险色（R03）', async () => {
      await page.evaluate(async () => {
        const { useWindowCloseStore } = await import('/src/stores/window-close.ts')
        useWindowCloseStore.setState({ promptId: 1, pending: false, error: '模拟错误' })
      })
      // 在同一对话框内放一个取 var(--sm-color-danger) 的探针，比较解析后的颜色值。
      const colors = await page.locator('dialog[data-window-close] [role="alert"]').evaluate((node) => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--sm-color-danger)'
        node.closest('dialog').append(probe)
        const danger = getComputedStyle(probe).color
        probe.remove()
        return { color: getComputedStyle(node).color, danger, text: getComputedStyle(node.closest('dialog')).color }
      })
      await page.evaluate(async () => {
        const { useWindowCloseStore } = await import('/src/stores/window-close.ts')
        useWindowCloseStore.setState({ promptId: null, pending: false, error: '' })
      })
      assert.equal(colors.color, colors.danger, '错误文字应解析为 --sm-color-danger')
      assert.notEqual(colors.color, colors.text, '错误文字不能回退为正文色')
      return colors
    })

    await check('歌单预览弹层：右上关闭按钮可关闭', async () => {
      await navigate(page, 'explore')
      await page.getByText('私人雷达').first().waitFor()
      await page.waitForTimeout(400)
      await page.locator('button[aria-label^="查看歌单："]:not([disabled])').first().click({ force: true })
      await page.getByRole('button', { name: '进入歌单' }).waitFor()
      const close = page.getByRole('button', { name: '关闭', exact: true })
      const box = await close.boundingBox()
      await close.click()
      await page.getByRole('button', { name: '进入歌单' }).waitFor({ state: 'detached' })
      return { closeSize: box && [Math.round(box.width), Math.round(box.height)] }
    })

    await check('搜索空结果与失败状态保留提示和重试入口', async () => {
      await fresh({ mode: 'empty' })
      await navigate(page, { type: 'search', keyword: '无结果关键词' })
      await sectionsReady(page, '歌曲搜索结果')
      await page.getByText('没有找到相关歌曲，试试歌曲名或歌手名。').waitFor()
      assert.equal(await page.getByRole('button', { name: /查看全部/ }).count(), 0)
      await fresh({ mode: 'error' })
      await navigate(page, { type: 'search', keyword: KEYWORD })
      await sectionsReady(page, '歌曲搜索结果')
      await page.getByRole('button', { name: '重新搜索' }).last().waitFor()
      await page.getByText(/QQ音乐 · 歌曲/).first().waitFor()
    })

    for (const theme of ['dark', 'light']) {
      await check(`最小窗口 960×540（${theme}）各页面无横向溢出`, async () => {
        await fresh({ width: 960, height: 540, theme })
        const views = [
          ['explore', 'explore'], ['library', 'library'], ['roam', 'roam'],
          ['search', { type: 'search', keyword: KEYWORD }],
          ['artist', { type: 'artist', id: 'netease-artist-0', source: 'netease' }],
        ]
        const result = {}
        for (const [name, view] of views) {
          await navigate(page, view)
          await page.waitForTimeout(1500)
          result[name] = await page.evaluate(() => {
            const scrollers = [...document.querySelectorAll('div, section, main')]
              .filter((node) => node.clientWidth > 400 && node.scrollWidth > node.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX))
              .filter((node) => !node.closest('[class*="rail"], [class*="Rail"], [class*="subTabs"], [class*="row"]'))
            return { document: document.documentElement.scrollWidth - window.innerWidth, scrollers: scrollers.map((node) => String(node.className).slice(0, 50)) }
          })
          assert.ok(result[name].document <= 0 && result[name].scrollers.length === 0, `${name}: ${JSON.stringify(result[name])}`)
        }
        return result
      })
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
    const settingsDiff = execSync('git diff --name-only bd10077 -- src/pages/SettingsPage.tsx src/pages/SettingsPage.module.css src/pages/SettingsPage.test.tsx src/components/Settings', { cwd: root }).toString().trim()
    const result = {
      generatedAt: new Date().toISOString(),
      commit: execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
      worktreeState: execSync('git status --porcelain -- src', { cwd: root }).toString().trim() || 'clean',
      environment: 'macOS Electron dev（electron-vite dev），独立 --user-data-dir；MOCK fixture；CDP 固定视口',
      settingsSourceDiff: settingsDiff || '无改动（SettingsPage 与 components/Settings 相对 bd10077 无差异）',
      checks, pageErrors: errors,
    }
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
    await browser.close().catch(() => {})
    if (checks.some((item) => !item.ok) || errors.length) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
