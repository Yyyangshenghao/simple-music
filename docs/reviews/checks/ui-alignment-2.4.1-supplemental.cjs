// 2.4.1 非设置页 UI 对齐：补充验收证据（Codex 首轮复审后要求）。
// 与截图脚本共用 MOCK fixture，只连接独立 --user-data-dir 的 dev 实例；不出网、不播放、不执行真实创建/删除。
// 用法：NODE_PATH=<含 playwright 的 node_modules> node docs/reviews/checks/ui-alignment-2.4.1-supplemental.cjs
// 输出：docs/reviews/assets/2.4.1-ui-alignment/supplemental/（results.json 与新增截图）；断言失败或页面错误时退出码为 1。
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const { installRoutes, installFixture, navigate, setTheme, sectionsReady, reset } = require('./ui-alignment-2.4.1.cjs')

const root = path.resolve(__dirname, '../../..')
const output = process.env.OUTPUT_DIR || path.join(root, 'docs/reviews/assets/2.4.1-ui-alignment/supplemental')
const KEYWORD = '夜航星'
// fixture 中网易云第 12、25、38 首为 playable=false（暂无版权），QQ 曲目均可播。
const NETEASE_IDS = Array.from({ length: 40 }, (_, i) => `netease:netease-song-${i}`)
const NETEASE_PLAYABLE = NETEASE_IDS.filter((_, i) => i % 13 !== 12)
const QQ_IDS = Array.from({ length: 12 }, (_, i) => `qq:qq-song-${i + 3}`)

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9461')
  const context = browser.contexts()[0]
  const page = context.pages().find((p) => p.url().endsWith('/index.html'))
  page.setDefaultTimeout(10000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const blockedApi = new Set()
  await installRoutes(context, blockedApi)
  const cdp = await context.newCDPSession(page)
  const checks = []
  const shots = []
  const observations = []

  async function fresh({ width = 1536, height = 864, theme = 'dark' } = {}) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1200)
    await installFixture(page)
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
  async function shot(file, options = {}) {
    await page.screenshot({ path: path.join(output, file), scale: 'css', ...options })
    shots.push(file)
  }
  async function openSearch() {
    await navigate(page, { type: 'search', keyword: KEYWORD })
    await sectionsReady(page, '歌曲搜索结果')
    await sectionsReady(page, '歌单搜索结果')
    await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"]').length === 1)
  }
  const pressed = async (group, name) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true }).getAttribute('aria-pressed')
  const category = (name) => page.getByRole('group', { name: '筛选搜索类型' }).getByRole('button', { name, exact: true }).click()
  const source = (name) => page.getByRole('group', { name: '筛选搜索来源' }).getByRole('button', { name }).click()
  const countIn = (label, selector) => page.locator(`section[aria-label="${label}"] ${selector}`).count()
  const checkedCount = () => page.locator('[role="checkbox"][aria-checked="true"]').count()

  try {
    // ---------- 1. 查看全部与多选清空 ----------
    await fresh()
    await openSearch()

    await check('歌手「查看全部」（全部平台）：切到歌手分类，9 位全部可达，来源仍为全部平台', async () => {
      await page.getByRole('button', { name: '查看全部9位歌手' }).click()
      await page.waitForFunction(() => !document.querySelector('section[aria-label="歌曲搜索结果"]'))
      assert.equal(await pressed('筛选搜索类型', '歌手'), 'true')
      assert.equal(await pressed('筛选搜索来源', '全部平台'), 'true')
      assert.equal(await countIn('歌手搜索结果', 'button[class*="_artist_"]'), 9)
      assert.equal(await page.getByRole('button', { name: /^查看全部/ }).count(), 0)
      return { artists: 9 }
    })

    await check('歌手「查看全部」（网易云）：6 位全部可达，网易云筛选保持', async () => {
      await category('全部')
      await source(/网易云/)
      await page.getByRole('button', { name: '查看全部6位歌手' }).click()
      await page.waitForFunction(() => !document.querySelector('section[aria-label="歌曲搜索结果"]'))
      assert.equal(await pressed('筛选搜索类型', '歌手'), 'true')
      assert.equal(await page.getByRole('group', { name: '筛选搜索来源' }).getByRole('button', { name: /网易云/ }).getAttribute('aria-pressed'), 'true')
      assert.equal(await countIn('歌手搜索结果', 'button[class*="_artist_"]'), 6)
      return { artists: 6 }
    })

    await check('专辑「查看全部」（网易云）：切到专辑分类，8 张全部可达，网易云筛选保持', async () => {
      await category('全部')
      await page.getByRole('button', { name: '查看全部8张专辑' }).click()
      await page.waitForFunction(() => !document.querySelector('section[aria-label="歌曲搜索结果"]'))
      assert.equal(await pressed('筛选搜索类型', '专辑'), 'true')
      assert.equal(await page.getByRole('group', { name: '筛选搜索来源' }).getByRole('button', { name: /网易云/ }).getAttribute('aria-pressed'), 'true')
      assert.equal(await countIn('专辑搜索结果', '[data-selection-key]'), 8)
      return { albums: 8 }
    })

    await check('歌单「查看全部」（QQ 音乐）：切到歌单分类，8 个全部可达，QQ 筛选保持', async () => {
      await category('全部')
      await source(/QQ音乐/)
      await page.getByRole('button', { name: '查看全部8个歌单' }).click()
      await page.waitForFunction(() => !document.querySelector('section[aria-label="歌曲搜索结果"]'))
      assert.equal(await pressed('筛选搜索类型', '歌单'), 'true')
      assert.equal(await page.getByRole('group', { name: '筛选搜索来源' }).getByRole('button', { name: /QQ音乐/ }).getAttribute('aria-pressed'), 'true')
      assert.equal(await countIn('歌单搜索结果', '[data-selection-key]'), 8)
      return { playlists: 8 }
    })

    await check('专辑「查看全部」（全部平台）：16 张全部可达', async () => {
      await category('全部')
      await source('全部平台')
      await page.getByRole('button', { name: '查看全部16张专辑' }).click()
      await page.waitForFunction(() => !document.querySelector('section[aria-label="歌曲搜索结果"]'))
      assert.equal(await countIn('专辑搜索结果', '[data-selection-key]'), 16)
      return { albums: 16 }
    })

    async function selectAllVisible() {
      await page.getByRole('button', { name: '歌曲搜索结果更多操作' }).click()
      await page.getByRole('menuitem', { name: /多选/ }).click()
      await page.getByRole('region', { name: '多选操作' }).getByRole('button', { name: '全选' }).click()
      return checkedCount()
    }

    await check('多选后切换来源：选择清空并退出多选', async () => {
      await category('全部')
      const before = await selectAllVisible()
      assert.equal(before, 22)
      await source(/网易云/)
      await page.waitForTimeout(300)
      assert.equal(await checkedCount(), 0)
      assert.equal(await page.getByRole('region', { name: '多选操作' }).count(), 0)
      return { selectedBefore: before, selectedAfter: 0 }
    })

    await check('多选后切换分类：选择清空并退出多选', async () => {
      const before = await selectAllVisible()
      assert.ok(before > 0)
      await category('歌曲')
      await page.waitForTimeout(300)
      assert.equal(await checkedCount(), 0)
      assert.equal(await page.getByRole('region', { name: '多选操作' }).count(), 0)
      return { selectedBefore: before, selectedAfter: 0 }
    })

    // ---------- 2. 播放命令捕获（替换 store 动作，不进入播放引擎） ----------
    await fresh()
    await openSearch()
    await page.evaluate(async () => {
      const { usePlaylistStore } = await import('/src/stores/playlist.ts')
      const key = (track) => `${track.source}:${String(track.id)}`
      window.__queueCalls = []
      usePlaylistStore.setState({
        setQueue: (tracks, startIndex = 0) => { window.__queueCalls.push({ kind: 'setQueue', ids: tracks.map(key), startIndex }) },
        addManyToQueue: (tracks) => { window.__queueCalls.push({ kind: 'addManyToQueue', ids: tracks.map(key) }); return tracks.length },
      })
    })
    const lastCall = () => page.evaluate(() => window.__queueCalls.at(-1) ?? null)
    const playRow = (key) => page.locator(`section[aria-label="歌曲搜索结果"] [data-selection-key="track:${key}"] button`).first().click()

    await check('「全部」预览中点歌：队列为全部平台完整可播列表（49 首），起点为所点歌曲', async () => {
      await playRow('netease:netease-song-3')
      const call = await lastCall()
      assert.equal(call.kind, 'setQueue')
      assert.deepEqual(call.ids, [...NETEASE_PLAYABLE, ...QQ_IDS])
      assert.equal(call.ids[call.startIndex], 'netease:netease-song-3')
      return { length: call.ids.length, startIndex: call.startIndex, includesBeyondPreview: call.ids.includes('netease:netease-song-30') }
    })

    await check('网易云筛选下预览点歌：队列为网易云完整可播列表（37 首）', async () => {
      await source(/网易云/)
      await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"] [data-selection-key]').length === 10)
      await playRow('netease:netease-song-5')
      const call = await lastCall()
      assert.deepEqual(call.ids, NETEASE_PLAYABLE)
      assert.equal(call.ids[call.startIndex], 'netease:netease-song-5')
      return { length: call.ids.length, startIndex: call.startIndex }
    })

    await check('网易云筛选下「添加到播放队列」（搜索页的整组播放入口）：包含完整可播结果（37 首）而非 10 首预览', async () => {
      await page.getByRole('button', { name: '歌曲搜索结果更多操作' }).click()
      await page.getByRole('menuitem', { name: '添加到播放队列' }).click()
      await page.waitForFunction(() => window.__queueCalls.at(-1)?.kind === 'addManyToQueue')
      const call = await lastCall()
      // 暂无版权的 3 首由批量解析过滤，其余 37 首按原顺序全部进入。
      assert.deepEqual(call.ids, NETEASE_PLAYABLE)
      return { length: call.ids.length, previewRows: 10 }
    })

    await check('QQ 筛选下预览点歌：队列为 QQ 完整列表（12 首）', async () => {
      await source(/QQ音乐/)
      await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"] [data-selection-key]').length === 10)
      await playRow('qq:qq-song-3')
      const call = await lastCall()
      assert.deepEqual(call.ids, QQ_IDS)
      return { length: call.ids.length, startIndex: call.startIndex }
    })

    // ---------- 3. 960×540 TrackRow 悬停 ----------
    async function rowGeometry(selector) {
      return page.locator(selector).first().evaluate((row) => {
        const rect = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width } }
        const pick = (pattern) => [...row.querySelectorAll('*')].find((node) => [...node.classList].some((name) => pattern.test(name)))
        const parts = {
          info: pick(/^_info_/), name: pick(/^_name_/), album: pick(/^_album_/),
          meta: pick(/^_metaColumn_/) || pick(/^_duration_/) || pick(/^_status_/),
          add: row.querySelector('[aria-label="加入歌单"]'),
          offline: row.querySelector('[aria-label="保存到本地"], [aria-label="取消固定"]') || pick(/^_actionSlot_/),
          like: row.querySelector('[aria-label="红心"], [aria-label="取消红心"]'),
        }
        const style = (node) => node && getComputedStyle(node)
        return {
          row: rect(row),
          parts: Object.fromEntries(Object.entries(parts).map(([key, node]) => [key, node ? { ...rect(node), opacity: Number(style(node).opacity), display: style(node).display, text: node.textContent?.trim().slice(0, 40), truncated: node.scrollWidth > node.clientWidth + 1, ellipsis: style(node).textOverflow } : null])),
        }
      })
    }
    function assertRow(geometry, label, requireLike = true) {
      const { row, parts } = geometry
      for (const key of ['name', 'album', 'meta', 'add']) assert.ok(parts[key] && parts[key].width > 0 && parts[key].display !== 'none', `${label}: ${key} 不可见`)
      for (const key of ['add', 'offline', 'like']) {
        const part = parts[key]
        if (!part) continue
        assert.ok(part.left >= row.left - 0.5 && part.right <= row.right + 0.5, `${label}: ${key} 超出行`)
      }
      assert.ok(parts.add.opacity >= 0.8, `${label}: 加入按钮悬停未显形`)
      if (requireLike) assert.ok(parts.like && parts.like.opacity >= 0.8, `${label}: 红心缺失或悬停未显形`)
      const order = ['info', 'album', 'meta', 'add', 'offline', 'like'].map((key) => [key, parts[key]]).filter(([, part]) => part)
      for (let index = 1; index < order.length; index++) {
        assert.ok(order[index - 1][1].right <= order[index][1].left + 0.5, `${label}: ${order[index - 1][0]} 与 ${order[index][0]} 重叠`)
      }
      for (const key of ['name', 'album']) if (parts[key].truncated) assert.equal(parts[key].ellipsis, 'ellipsis', `${label}: ${key} 被裁切但无省略号`)
    }

    for (const theme of ['dark', 'light']) {
      await check(`960×540（${theme}）搜索歌曲行悬停：长标题/长专辑/暂无版权行各列不重叠、操作不被裁切`, async () => {
        await fresh({ width: 960, height: 540, theme })
        // 红心按钮需要设置层的网易云登录标记；仅本项补充检查打开，不影响前后对比截图的 fixture。
        await page.evaluate(async () => {
          const { useSettingsStore } = await import('/src/stores/settings.ts')
          useSettingsStore.getState().setNeteaseLoggedIn(true)
        })
        await navigate(page, { type: 'search', keyword: KEYWORD, pageState: { category: 'songs', sourceFilter: null, scrollTop: 0 } })
        await sectionsReady(page, '歌曲搜索结果')
        await page.waitForFunction(() => document.querySelectorAll('section[aria-label="歌曲搜索结果"]').length === 1)
        const result = {}
        for (const [key, label] of [['netease:netease-song-8', '长标题'], ['netease:netease-song-3', '长专辑'], ['netease:netease-song-12', '暂无版权']]) {
          const selector = `section[aria-label="歌曲搜索结果"] [data-selection-key="track:${key}"]`
          await page.locator(selector).first().scrollIntoViewIfNeeded()
          await page.evaluate((selector) => document.querySelector(selector).scrollIntoView({ block: 'center' }), selector)
          await page.locator(selector).first().hover({ position: { x: 200, y: 20 } })
          await page.waitForTimeout(350)
          const geometry = await rowGeometry(selector)
          // 暂无版权行按设计不显示离线与红心，只保留同宽空位。
          assertRow(geometry, label, label !== '暂无版权')
          if (label !== '暂无版权') assert.ok(geometry.parts.name.truncated || label !== '长标题', '长标题应省略显示')
          result[label] = { nameTruncated: geometry.parts.name.truncated, albumTruncated: geometry.parts.album.truncated, meta: geometry.parts.meta.text, actions: ['add', 'offline', 'like'].filter((key) => geometry.parts[key]?.width) }
          const box = geometry.row
          await shot(`trackrow-hover-search-${label}--${theme}-960x540.png`)
          await shot(`trackrow-hover-search-${label}-row--${theme}-960x540.png`, { clip: { x: 0, y: Math.max(0, box.top - 12), width: 960, height: box.bottom - box.top + 24 } })
        }
        return result
      })

      await check(`960×540（${theme}）歌单详情行悬停：长专辑行各列不重叠、时长与操作完整`, async () => {
        await navigate(page, { type: 'playlist', from: 'explore', playlist: { provider: 'netease', source: 'netease', type: 'playlist', id: 'netease-pl-1', name: '深夜写代码', cover: '', trackCount: 40, playCount: 1, creator: '测试用户' } })
        await page.locator('[class*="_row_"]:visible', { hasText: '城市的第七个夏天' }).first().waitFor()
        await page.waitForTimeout(800)
        const row = page.locator('[class*="_row_"]:visible', { hasText: '城市的第七个夏天' }).first()
        await row.evaluate((node) => { node.setAttribute('data-hover-probe', ''); node.scrollIntoView({ block: 'center' }) })
        await row.hover({ position: { x: 200, y: 20 } })
        await page.waitForTimeout(350)
        const parts = await rowGeometry('[data-hover-probe]')
        assertRow(parts, '歌单详情')
        await page.evaluate(() => document.querySelector('[data-hover-probe]')?.removeAttribute('data-hover-probe'))
        await shot(`trackrow-hover-playlist--${theme}-960x540.png`)
        return { albumTruncated: parts.parts.album.truncated, meta: parts.parts.meta.text }
      })
    }

    // ---------- 4. AppPlaylistModal ----------
    await fresh()
    const appPlaylistId = await page.evaluate(async () => {
      const [{ useAppPlaylistsStore }, { neteaseService }] = await Promise.all([import('/src/stores/app-playlists.ts'), import('/src/lib/service-registry.ts')])
      const tracks = (await neteaseService.searchTracks('夜航星')).slice(0, 3)
      return useAppPlaylistsStore.getState().create('补充验收歌单（模拟）', tracks)
    })
    const appPlaylistExists = () => page.evaluate(async (id) => {
      const { useAppPlaylistsStore } = await import('/src/stores/app-playlists.ts')
      const item = useAppPlaylistsStore.getState().items.find((entry) => entry.id === id)
      return item ? item.name : null
    }, appPlaylistId)
    async function openMenuItem(label) {
      // 转场期间可能残留离场页，取当前（最后挂载）的页面菜单。
      await page.getByRole('button', { name: '歌单更多操作' }).last().click()
      await page.getByRole('menuitem', { name: label }).click()
    }

    await check('应用歌单删除弹窗：右上关闭按钮关闭，歌单未被删除', async () => {
      await navigate(page, { type: 'app-playlist', id: appPlaylistId })
      await page.getByRole('button', { name: '歌单更多操作' }).last().waitFor()
      await openMenuItem('删除歌单')
      const dialog = page.getByRole('dialog', { name: '删除应用歌单' })
      await dialog.waitFor()
      await page.waitForTimeout(300)
      await shot('app-playlist-delete-modal--dark-1536x864.png')
      const close = dialog.getByRole('button', { name: '关闭对话框' })
      const box = await close.boundingBox()
      assert.equal(await close.locator('svg').count(), 1)
      await close.click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await appPlaylistExists(), '补充验收歌单（模拟）')
      return { closeSize: box && [Math.round(box.width), Math.round(box.height)] }
    })

    await check('应用歌单删除弹窗：「取消」关闭，歌单未被删除', async () => {
      await openMenuItem('删除歌单')
      const dialog = page.getByRole('dialog', { name: '删除应用歌单' })
      await dialog.waitFor()
      await dialog.getByRole('button', { name: '取消' }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await appPlaylistExists(), '补充验收歌单（模拟）')
    })

    // Esc 只做观察记录：该弹窗的键盘行为本分支未改动（仅把 × 文字换成关闭图标），不作为本次断言。
    {
      await openMenuItem('删除歌单')
      const dialog = page.getByRole('dialog', { name: '删除应用歌单' })
      await dialog.waitFor()
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      const stillOpen = await page.evaluate(() => [...document.querySelectorAll('dialog')].some((node) => node.open && node.textContent.includes('删除应用歌单')))
      observations.push({ name: '应用歌单删除弹窗按 Esc', result: stillOpen ? '未关闭（本分支对该弹窗只替换关闭图标，未改键盘处理；未在基准提交上复测）' : '已关闭' })
      if (stillOpen) await dialog.getByRole('button', { name: '关闭对话框' }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await appPlaylistExists(), '补充验收歌单（模拟）')
    }

    await check('重命名弹窗：清空名称时「保存」禁用，「取消」关闭且名称不变', async () => {
      await openMenuItem('重命名歌单')
      const dialog = page.getByRole('dialog').filter({ hasText: '重命名应用歌单' })
      await dialog.waitFor()
      const input = dialog.getByRole('textbox', { name: '歌单名称' })
      assert.equal(await dialog.getByRole('button', { name: '保存' }).isDisabled(), false)
      await input.fill('')
      assert.equal(await dialog.getByRole('button', { name: '保存' }).isDisabled(), true)
      await input.fill('   ')
      assert.equal(await dialog.getByRole('button', { name: '保存' }).isDisabled(), true)
      await page.waitForTimeout(250)
      await shot('app-playlist-rename-empty--dark-1536x864.png')
      await dialog.getByRole('button', { name: '取消' }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await appPlaylistExists(), '补充验收歌单（模拟）')
    })

    await check('浅色 960×540 删除弹窗：标题、关闭图标与按钮在小窗口内完整显示', async () => {
      await fresh({ width: 960, height: 540, theme: 'light' })
      await navigate(page, { type: 'app-playlist', id: appPlaylistId })
      await page.getByRole('button', { name: '歌单更多操作' }).last().waitFor()
      await openMenuItem('删除歌单')
      const dialog = page.getByRole('dialog', { name: '删除应用歌单' })
      await dialog.waitFor()
      await page.waitForTimeout(300)
      const inside = await dialog.evaluate((node) => {
        const box = node.getBoundingClientRect()
        return [...node.querySelectorAll('h2, button')].every((child) => { const r = child.getBoundingClientRect(); return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom })
          && box.right <= window.innerWidth && box.bottom <= window.innerHeight
      })
      assert.ok(inside)
      await shot('app-playlist-delete-modal--light-960x540.png')
      await dialog.getByRole('button', { name: '关闭对话框' }).click()
      await dialog.waitFor({ state: 'detached' })
    })

    // 清理 fixture 歌单（仅独立 profile 的本地存储）。
    await page.evaluate(async (id) => {
      const { useAppPlaylistsStore } = await import('/src/stores/app-playlists.ts')
      useAppPlaylistsStore.getState().remove(id)
    }, appPlaylistId)
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
    const result = {
      generatedAt: new Date().toISOString(),
      commit: execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
      worktreeState: execSync('git status --porcelain -- src', { cwd: root }).toString().trim() || 'clean',
      environment: 'macOS Electron dev（electron-vite dev），独立 --user-data-dir；MOCK fixture；CDP 固定视口；播放命令通过替换 playlist store 的 setQueue/addManyToQueue 记录，不进入播放引擎',
      checks, observations, shots, pageErrors, blockedApi: [...blockedApi].sort(),
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n')
    await browser.close().catch(() => {})
    if (checks.some((item) => !item.ok) || pageErrors.length) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
