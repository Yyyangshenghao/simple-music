// 歌手页截图错位取证：旧 settle 对滚动时间线动画 finish()，把工具栏推到吸顶终态盖住歌手信息。
// 记录 scrollTop=0 时 settle 前后的 header/toolbar 位置与时间线类型，并用真实滚轮验证吸顶仍正常。
// 源码中只有 ArtistToolbar 使用 animation-timeline，故不扫描其他页面。只连接独立 profile 的 dev 实例，MOCK fixture。
// 用法：CDP_URLS=feature=http://127.0.0.1:9461,baseline=http://127.0.0.1:9462 NODE_PATH=<playwright> node 本脚本
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')
const H = require('./ui-alignment-2.4.1.cjs')

const root = path.resolve(__dirname, '../../..')
const output = process.env.OUTPUT_FILE || path.join(root, 'docs/reviews/assets/2.4.1-ui-alignment/artist-toolbar-settle-evidence.json')
const targets = (process.env.CDP_URLS || 'feature=http://127.0.0.1:9461').split(',').map((item) => item.split('='))
const ARTIST = { type: 'artist', id: 'netease-artist-0', source: 'netease' }

const measure = (page) => page.evaluate(() => {
  const name = [...document.querySelectorAll('h1')].find((node) => node.textContent.includes('林间乐队') && node.offsetParent)
  const header = name?.closest('[class*="_header_"]')
  const viewport = header?.closest('[class*="_viewport_"]')
  // 转场期间可能残留离场页的工具栏；取不在隐藏页内的最后一个，并记录数量。
  const layers = [...document.querySelectorAll('[data-artist-toolbar-scrollable]')]
  const layer = layers.filter((node) => !node.closest('[aria-hidden="true"]')).at(-1)
  const box = (node) => node && { top: Math.round(node.getBoundingClientRect().top * 10) / 10, bottom: Math.round(node.getBoundingClientRect().bottom * 10) / 10 }
  return {
    scrollTop: viewport && Math.round(viewport.scrollTop), toolbarLayers: layers.length, header: box(header), toolbar: box(layer),
    toolbarTransform: layer && getComputedStyle(layer).transform, pinned: layer?.dataset.artistToolbarPinned,
    nonDocumentTimelineAnimations: document.getAnimations().filter((a) => !(a.timeline instanceof DocumentTimeline)).map((a) => ({
      timeline: a.timeline?.constructor?.name ?? 'null', animation: a.animationName ?? a.constructor.name, playState: a.playState, progress: String(a.currentTime),
    })),
  }
})

// 旧 helper：对全部动画 finish()；新 helper：跳过非 DocumentTimeline 动画。
const oldSettle = (page) => page.evaluate(() => {
  for (const a of document.getAnimations()) { try { if (a.effect?.getComputedTiming().iterations === Infinity) { a.currentTime = 0; a.pause() } else a.finish() } catch {} }
})

async function run(label, url) {
  const browser = await chromium.connectOverCDP(url)
  const context = browser.contexts()[0]
  const page = context.pages().find((p) => p.url().endsWith('/index.html'))
  page.setDefaultTimeout(10000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await H.installRoutes(context, new Set())
  const cdp = await context.newCDPSession(page)
  try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 864, deviceScaleFactor: 1, mobile: false })
  const fresh = async () => {
    await page.reload(); await page.waitForTimeout(1200)
    await H.installFixture(page); await H.setTheme(page, 'dark'); await H.reset(page)
  }
  const openArtist = async () => {
    await H.navigate(page, ARTIST)
    await page.getByRole('button', { name: /播放/ }).first().waitFor()
    await page.waitForTimeout(2300)
  }
  const result = { label, url, source: await page.evaluate(async () => (await (await fetch('/src/pages/SearchPage.tsx')).text()).includes('searchPreview') ? 'feature 工作树（含 searchPreview）' : 'bd10077 clean（无 searchPreview）') }

  await fresh(); await openArtist()
  const oldBefore = await measure(page)
  await oldSettle(page); await page.waitForTimeout(150)
  result.oldSettle = { beforeSettle: oldBefore, afterSettle: await measure(page) }

  await fresh(); await openArtist()
  const newBefore = await measure(page)
  const settled = await H.settle(page)
  result.newSettle = { beforeSettle: newBefore, afterSettle: await measure(page), ...settled, assertion: await H.assertArtistLayout(page).then(() => 'pass', (error) => error.message) }
  result.causeConfirmed = result.oldSettle.afterSettle.toolbar.top < result.oldSettle.afterSettle.header.bottom - 1
    && result.oldSettle.afterSettle.scrollTop === 0
    && result.newSettle.afterSettle.toolbar.top >= result.newSettle.afterSettle.header.bottom - 1

  // 真实滚轮：向下滚过歌手信息后工具栏吸顶，回到顶部后复位到歌手信息下方。
  // 首次滚轮偶有未被视口接收（实例刚重载），最多重试 3 次并记录次数。
  let scrolled
  let wheelAttempts = 0
  do {
    wheelAttempts++
    await page.mouse.move(700, 600)
    await page.mouse.wheel(0, 900); await page.waitForTimeout(700)
    scrolled = await measure(page)
  } while (scrolled.scrollTop === 0 && wheelAttempts < 3)
  await page.mouse.wheel(0, -2000); await page.waitForTimeout(700)
  const back = await measure(page)
  const topbar = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-app-root]')).getPropertyValue('--sm-topbar-height')) || 52)
  result.stickyByWheel = {
    topbarHeight: topbar, wheelAttempts, afterScrollDown: scrolled, afterScrollUp: back,
    pass: scrolled.scrollTop > 0 && Math.abs(scrolled.toolbar.top - topbar) <= 1 && scrolled.pinned === 'true'
      && back.scrollTop === 0 && back.toolbar.top >= back.header.bottom - 1 && back.pinned === 'false',
  }

  result.pageErrors = pageErrors
  return result
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
    await cdp.detach().catch(() => {})
    await browser.close().catch(() => {})
  }
}

;(async () => {
  const results = []
  const save = () => fs.writeFileSync(output, JSON.stringify({ ...evidence, generatedAt: new Date().toISOString(), results }, null, 2) + '\n')
  const evidence = {
    generatedAt: new Date().toISOString(),
    finding: '旧 settle 对 document.getAnimations() 全部 finish()；歌手工具栏 follow-scroll 动画挂在 ScrollTimeline（--artist-page）上，finish() 把它推到吸顶终态（translateY=顶栏高度），scrollTop=0 时工具栏盖到歌手信息上方。产品 JSX 顺序与正常滚动吸顶均无问题。',
    fix: 'settle 跳过 timeline 非 DocumentTimeline 的动画；歌手场景截图后断言 scrollTop=0 时工具栏位于歌手信息之下、列表不与工具栏重叠。',
    reshot: '仅重拍 artist、artist-description-open 两个场景的 before/after 各 4 张；before 在独立临时 clean 工作区（detached bd10077）拍摄，未暂存或改动 feature 源码；其他场景原图未改。',
  }
  // 每个实例完成即增量保存；单个实例失败也保留已有结果。
  for (const [label, url] of targets) {
    try { results.push(await run(label, url)) } catch (error) { results.push({ label, url, error: error.message.split('\n')[0] }) }
    save()
  }
  const ok = results.every((r) => !r.error && r.causeConfirmed && r.newSettle.assertion === 'pass' && r.stickyByWheel.pass && !r.pageErrors.length)
  console.log(results.map((r) => `${r.label}: cause=${r.causeConfirmed} assertion=${r.newSettle.assertion} sticky=${r.stickyByWheel.pass} errors=${r.pageErrors?.length ?? r.error}`).join('\n'))
  if (!ok) process.exitCode = 1
})().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => setTimeout(() => process.exit(), 100))
