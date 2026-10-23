// 2.4.1 非设置页 UI 对齐：修改前后同一套 fixture 的截图脚本。
// 仅连接用独立 --user-data-dir 启动的 `electron-vite dev` 实例，不操作真实账号，不播放音频。
// 所有平台数据为模拟数据（MOCK）：网易/QQ service 实例方法被替换为固定返回，未列出的方法一律拒绝，避免请求真实上游。
//
// 用法（示例）：
//   npx electron-vite dev --remoteDebuggingPort 9461 -- --user-data-dir=<空目录>
//   NODE_PATH=<含 playwright 的 node_modules> node docs/reviews/checks/ui-alignment-2.4.1.cjs before
// 第一个参数为输出子目录名（before / after），可选第二个参数只跑名称包含该字符串的场景。
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { execSync } = require('node:child_process')

const phase = process.argv[2] || 'before'
const only = process.argv[3] || ''
const root = path.resolve(__dirname, '../../..')
const output = process.env.OUTPUT_DIR || path.join(root, 'docs/reviews/assets/2.4.1-ui-alignment', phase)
const FIXTURE_HOST = 'fixture.sm.invalid'

// ---------- 封面：确定性渐变 PNG（无依赖编码） ----------
function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const PALETTE = [[214, 84, 72], [62, 118, 214], [236, 170, 64], [74, 168, 132], [150, 92, 210], [222, 110, 168], [56, 160, 196], [120, 132, 70]]
const coverCache = new Map()
function coverPng(seed) {
  if (coverCache.has(seed)) return coverCache.get(seed)
  const size = 160
  const a = PALETTE[seed % PALETTE.length]
  const b = PALETTE[(seed * 3 + 2) % PALETTE.length]
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size)
      const ring = ((x - size * 0.7) ** 2 + (y - size * 0.3) ** 2) < (size * 0.22) ** 2 ? 0.18 : 0
      for (let c = 0; c < 3; c++) {
        const v = a[c] * (1 - t) + b[c] * t
        raw[y * (size * 3 + 1) + 1 + x * 3 + c] = Math.min(255, Math.round(v + ring * 255))
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
  coverCache.set(seed, png)
  return png
}

// ---------- 页内 fixture（在渲染进程执行） ----------
async function installFixture(page, mode = 'normal') {
  await page.evaluate(async ({ host, mode }) => {
    const cover = (n) => `https://${host}/cover/${n}.png`
    const titles = ['夜航星', '晚风吹过旧车站', '海上灯塔', '城市的第七个夏天', '慢慢来', 'Starlight Avenue', '屋顶花园', '雨后的柏油路',
      '一首特别特别长的歌名用来测试单行省略与列宽在窄窗口下是否仍然稳定（Live 版）', '回声', '远行', '无人知晓的清晨', '北纬三十度', '纸飞机', 'Blue Hour', '漂流',
      '橘色日落', '凌晨四点的便利店', '告白气球', '云边', '萤火', '旧唱片', '岛屿', '风停了', '月光海', '温柔', '倒数', '白昼之夜', '霓虹', '南方',
      '若有所思', '蓝调时刻', '走马灯', '秋分', '山海', '小幸运', '春日信笺', '慢车', '星群', '归途']
    const artists = ['林间乐队', '许若川', '陈叙', 'The Lanterns', '苏小禾', '北岛电台']
    const albums = ['夜航星', '城市边缘', '海与灯塔', '漫长的季节 Original Soundtrack Deluxe Edition', '春日来信', '无题']
    const track = (source, i, extra = {}) => ({
      provider: source, source, type: 'song', id: `${source}-song-${i}`, name: titles[i % titles.length],
      artist: artists[i % artists.length], artists: [{ id: `${source}-artist-${i % artists.length}`, name: artists[i % artists.length] }],
      artistId: `${source}-artist-${i % artists.length}`, album: albums[i % albums.length],
      cover: i % 11 === 7 ? '' : cover(i % 16), duration: 150000 + (i * 37 % 120) * 1000, fee: 0, playable: i % 13 === 12 ? false : true,
      ...(source === 'qq' ? { mid: `qqmid${i}` } : {}), ...extra,
    })
    const playlist = (source, i, extra = {}) => ({
      provider: source, source, type: 'playlist', id: `${source}-pl-${i}`,
      name: ['通勤路上', '深夜写代码', '雨天的独处时光', '华语经典回顾 1990-2010 年度精选合集（持续更新）', '轻快早晨', '安静阅读', '公路旅行', '周末慵懒'][i % 8],
      cover: i % 9 === 5 ? '' : cover((i + 4) % 16), trackCount: 20 + i * 7, playCount: 12000 * (i + 1), creator: '测试用户', ...extra,
    })
    const album = (source, i) => ({ ...playlist(source, i), type: 'album', id: `${source}-al-${i}`, name: albums[i % albums.length], creator: artists[i % artists.length], trackCount: 10 + i })
    const artistInfo = (source, i) => ({
      id: `${source}-artist-${i}`, name: artists[i % artists.length] + (i >= artists.length ? ` ${i}` : ''), avatar: i === 4 ? '' : cover(i + 2), source,
      cover: cover(i + 6), musicSize: 120 + i, songNum: 120 + i,
      description: '（模拟数据）' + '林间乐队成立于一座沿海城市，成员在大学的排练室里相识。早期作品以城市夜景与旅行为主题，旋律克制而温暖，常用木吉他、合成器与弦乐交织出开阔的空间感。'.repeat(3)
        + '\n\n代表作品包括《夜航星》《海上灯塔》《城市的第七个夏天》等。乐队曾多次参加音乐节演出，也为多部电影与剧集创作配乐。'.repeat(2),
    })
    const delay = (v, ms = 60) => new Promise((resolve) => setTimeout(() => resolve(typeof v === 'function' ? v() : v), ms))
    const fail = (name) => () => Promise.reject(new Error(`FIXTURE_UNAVAILABLE:${name}`))
    const empty = mode === 'empty'
    const errorQQ = mode === 'error'

    const data = (source) => {
      const songCount = source === 'netease' ? 40 : 12
      const songs = Array.from({ length: songCount }, (_, i) => track(source, source === 'qq' ? i + 3 : i))
      return {
        searchTracks: () => delay(empty ? [] : songs),
        searchArtists: () => delay(empty ? [] : Array.from({ length: source === 'netease' ? 6 : 3 }, (_, i) => artistInfo(source, i))),
        searchAlbums: () => delay(empty ? [] : Array.from({ length: 8 }, (_, i) => album(source, i))),
        searchPlaylists: () => delay(empty ? [] : Array.from({ length: 8 }, (_, i) => playlist(source, i))),
        getSearchHotkeys: () => delay(['夜航星', '海上灯塔', '云边']),
        getArtistDetail: (id) => delay({ ...artistInfo(source, Number(String(id).split('-').pop()) || 0) }),
        getArtistSongs: () => delay(songs),
        getArtistSongsPage: (_id, offset, limit) => delay({ songs: songs.slice(offset, offset + limit), nextOffset: offset + limit, hasMore: offset + limit < songs.length }),
        getArtistAlbums: () => delay(Array.from({ length: 8 }, (_, i) => album(source, i))),
        getSimilarArtists: () => delay(Array.from({ length: 6 }, (_, i) => artistInfo(source, i + 1))),
        getAlbumDetail: (id) => delay(album(source, Number(String(id).split('-').pop()) || 0)),
        getAlbumTracks: () => delay(songs.slice(0, 12)),
        getPlaylistSkeleton: (id) => delay({ trackIds: songs.map((s) => s.id), tracks: songs, updatedAt: 1, meta: { description: '（模拟数据）适合通勤与夜晚的安静歌单，收录城市民谣与独立流行。', creator: '测试用户', playCount: 52000 } }),
        getPlaylistPage: (_id, offset, limit) => delay({ tracks: songs.slice(offset, offset + limit), total: songs.length, nextOffset: offset + limit, hasMore: offset + limit < songs.length }),
        getPlaylistRevision: () => delay({ trackIds: songs.map((s) => s.id), updatedAt: 1 }),
        getTracksByIds: (ids) => delay(ids.map((id) => songs.find((s) => String(s.id) === String(id))).filter(Boolean)),
        getRecommendPlaylists: () => delay(Array.from({ length: 12 }, (_, i) => playlist(source, i))),
        getDailySongs: () => delay(songs.slice(0, 20)),
        getRadarPlaylist: () => delay({ playlist: playlist(source, 30, { name: '私人雷达', id: '3136952023' }), tracks: songs.slice(5, 25) }),
        getRecentPlaylists: () => delay(Array.from({ length: 4 }, (_, i) => playlist(source, i + 2))),
        getRecentTracks: () => delay(songs.slice(0, 10)),
        getListeningRanking: () => delay(songs.slice(0, 20)),
        getUserPlaylists: () => delay(Array.from({ length: 10 }, (_, i) => playlist(source, i, i > 6 ? { subscribed: true } : {}))),
        getUserAlbums: () => delay(Array.from({ length: 5 }, (_, i) => album(source, i))),
        getLikedPlaylist: () => delay(playlist(source, 40, { name: '我喜欢的音乐', specialType: 5 })),
        checkLiked: (ids) => delay(Object.fromEntries(ids.map((id, i) => [String(id), i % 6 === 0]))),
        findUserPlaylistsByName: () => delay([]),
        getToplists: () => delay([{ title: '官方榜', entries: Array.from({ length: 4 }, (_, i) => ({ playlist: playlist(source, i + 20, { name: ['飙升榜', '新歌榜', '原创榜', '热歌榜'][i] }), updateFrequency: '每天更新', preview: songs.slice(i, i + 3).map((s) => ({ name: s.name, artist: s.artist })) })) }]),
        getToplistPreview: () => delay(songs.slice(0, 3).map((s) => ({ name: s.name, artist: s.artist }))),
        getPlaybackAccountToken: () => delay(null),
        reportPlayback: () => delay(undefined),
      }
    }

    const { neteaseService, qqService } = await import('/src/lib/service-registry.ts')
    const patched = {}
    for (const [source, service] of [['netease', neteaseService], ['qq', qqService]]) {
      const fixture = data(source)
      const proto = Object.getPrototypeOf(service)
      patched[source] = []
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor' || typeof proto[name] !== 'function') continue
        if (errorQQ && source === 'qq' && name.startsWith('search')) service[name] = fail(name)
        else service[name] = fixture[name] ?? fail(name)
        if (fixture[name]) patched[source].push(name)
      }
    }
    const { clearProviderRequestCache } = await import('/src/lib/provider-request-cache.ts')
    clearProviderRequestCache()
    const { useProviderStore } = await import('/src/stores/providers.ts')
    const providers = useProviderStore.getState()
    providers.setAccountState('netease', 'authenticated', { avatar: cover(1), nickname: '测试用户' }, { preserveEnabled: true })
    providers.setAccountState('qq', 'authenticated', { avatar: cover(3), nickname: '测试用户' }, { preserveEnabled: true })
    useProviderStore.getState().setEnabled('netease', true)
    useProviderStore.getState().setEnabled('qq', true)
    useProviderStore.getState().setEnabled('apple', false)
    providers.setContentSource('netease')
    // 堆叠卡片的"杂乱角"等使用 Math.random；换成固定种子，前后截图角度一致。
    let seed = 20261023
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    // 探索页问候语按小时变化；固定为下午，前后截图文字一致。
    Date.prototype.getHours = function () { return 15 }
    window.__smFixture = { mode, patched }
  }, { host: FIXTURE_HOST, mode })
}

async function navigate(page, view) {
  await page.evaluate(async (view) => {
    const { useNavigationStore } = await import('/src/stores/navigation.ts')
    useNavigationStore.getState().navigateTo(view)
  }, view)
}

async function setTheme(page, theme) {
  await page.evaluate(async (theme) => {
    const { useSettingsStore } = await import('/src/stores/settings.ts')
    useSettingsStore.getState().setThemeMode(theme)
  }, theme)
  await page.waitForFunction((theme) => document.documentElement.getAttribute('data-theme') === theme, theme)
}

// 返回按钮进入 1.4s 后自动躲藏；等过这段时间，所有截图都取静止态。指针停到左侧中下部，不触发悬停效果。
async function settle(page, ms = 2300) {
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  await page.mouse.move(2, Math.round(viewport.height * 0.6))
  await page.waitForTimeout(ms)
  await page.evaluate(() => document.fonts.ready)
  // 有限动画直接跳到终态（入场、转场不因加载时机停在半途），无限循环动画冻结到起点，保证前后截图可比较。
  // 滚动/视图时间线动画（如歌手工具栏的 follow-scroll）由滚动位置驱动，不能 finish()，否则会被推到吸顶终态。
  return page.evaluate(() => {
    let scrollDriven = 0
    for (const animation of document.getAnimations()) {
      if (!(animation.timeline instanceof DocumentTimeline)) { scrollDriven++; continue }
      try {
        const iterations = animation.effect?.getComputedTiming().iterations
        if (iterations === Infinity) { animation.currentTime = 0; animation.pause() } else animation.finish()
      } catch { /* 已结束或无法结束的动画忽略 */ }
    }
    return scrollDriven
  }).then(async (scrollDriven) => { await page.waitForTimeout(120); return { scrollDrivenAnimationsSkipped: scrollDriven } })
}

// 歌手页在 scrollTop=0 时，工具栏必须位于歌手信息下方（未吸顶）。
async function assertArtistLayout(page) {
  const layout = await page.evaluate(() => {
    const name = [...document.querySelectorAll('h1')].find((node) => node.textContent.includes('林间乐队') && node.offsetParent)
    const header = name?.closest('[class*="_header_"]')
    const viewport = header?.closest('[class*="_viewport_"]')
    const layer = document.querySelector('[data-artist-toolbar-scrollable]')
    const row = document.querySelector('[class*="trackList"] [class*="_row_"]')
    const box = (node) => node && { top: Math.round(node.getBoundingClientRect().top * 10) / 10, bottom: Math.round(node.getBoundingClientRect().bottom * 10) / 10 }
    return { scrollTop: viewport?.scrollTop, header: box(header), toolbar: box(layer), firstRow: box(row), pinned: layer?.dataset.artistToolbarPinned }
  })
  if (!layout.header || !layout.toolbar) throw new Error(`歌手页布局元素缺失：${JSON.stringify(layout)}`)
  if (layout.scrollTop === 0 && (layout.toolbar.top < layout.header.bottom - 1 || layout.pinned === 'true')) {
    throw new Error(`工具栏在 scrollTop=0 时位于歌手信息之上：${JSON.stringify(layout)}`)
  }
  if (layout.firstRow && layout.firstRow.top < layout.toolbar.bottom - 1) throw new Error(`歌曲列表与工具栏重叠：${JSON.stringify(layout)}`)
  return layout
}

async function overflowX(page) {
  return page.evaluate(() => {
    const offenders = []
    for (const el of document.querySelectorAll('main *, [data-app-root] *')) {
      const style = getComputedStyle(el)
      if (el.scrollWidth > el.clientWidth + 1 && (style.overflowX === 'auto' || style.overflowX === 'scroll') && !el.matches('[class*="rail"], [class*="Rail"], [class*="subTabs"], [class*="track"]')) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`)
      }
    }
    return { documentOverflow: document.documentElement.scrollWidth > window.innerWidth, scrollers: offenders.slice(0, 8) }
  })
}

const sectionsReady = (page, label) => page.waitForFunction((label) => {
  const sections = [...document.querySelectorAll(`section[aria-label="${label}"]`)]
  return sections.length > 0 && sections.every((section) => section.getAttribute('aria-busy') === 'false')
}, label)

const reset = async (page) => {
  await navigate(page, 'library')
  await page.evaluate(async () => {
    const { useNavigationStore } = await import('/src/stores/navigation.ts')
    useNavigationStore.setState({ history: [], future: [] })
  })
}

// 我的库标签存于 localStorage，会跨重载保留；每个场景显式指定，避免截图依赖运行顺序。
async function openLibraryTab(page, tab, waitForPlaylists = true) {
  await page.evaluate((tab) => localStorage.setItem('simplemusic-library-tab', tab), tab)
  await navigate(page, 'roam'); await navigate(page, 'library')
  if (waitForPlaylists) await page.getByRole('button', { name: /雨天的独处时光/ }).first().waitFor()
}

// 场景：name、执行步骤、可选滚动；同一步骤在每个主题/尺寸组合下重放。
const KEYWORD = '夜航星'
const scenarios = [
  { name: 'explore', run: async (page) => { await navigate(page, 'explore'); await page.getByText('私人雷达').first().waitFor() } },
  { name: 'library-playlists', run: async (page) => { await openLibraryTab(page, 'playlists') } },
  { name: 'library-favorites', run: async (page) => {
    await openLibraryTab(page, 'favorites', false)
    await page.getByRole('button', { name: /周末慵懒/ }).first().waitFor()
  } },
  { name: 'search-all', run: async (page) => {
    await navigate(page, { type: 'search', keyword: KEYWORD })
    await sectionsReady(page, '歌曲搜索结果')
    await sectionsReady(page, '歌单搜索结果')
  } },
  { name: 'search-songs-qq', run: async (page) => {
    await navigate(page, { type: 'search', keyword: KEYWORD, pageState: { category: 'songs', sourceFilter: 'qq', scrollTop: 0 } })
    await sectionsReady(page, '歌曲搜索结果')
  } },
  { name: 'artist', verify: assertArtistLayout, run: async (page) => {
    await navigate(page, { type: 'artist', id: 'netease-artist-0', source: 'netease' })
    await page.getByRole('button', { name: /播放/ }).first().waitFor()
    await page.waitForTimeout(500)
  } },
  { name: 'artist-description-open', verify: assertArtistLayout, run: async (page) => {
    await navigate(page, { type: 'artist', id: 'netease-artist-0', source: 'netease' })
    await page.getByRole('button', { name: /播放/ }).first().waitFor()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: '歌手简介' }).last().click({ force: true })
    await page.waitForTimeout(500)
  } },
  { name: 'playlist-detail', run: async (page) => {
    // 与用户路径一致：从我的库点击长标题歌单卡片进入详情（封面经共享转场）。
    await openLibraryTab(page, 'playlists')
    await page.getByRole('button', { name: /华语经典回顾/ }).first().click({ force: true })
    await page.getByText('城市的第七个夏天').first().waitFor()
  } },
  { name: 'roam', run: async (page) => { await navigate(page, 'roam'); await page.waitForTimeout(800) } },
  { name: 'dialog-window-close-error', run: async (page) => {
    await openLibraryTab(page, 'favorites', false)
    await page.evaluate(async () => {
      const { useWindowCloseStore } = await import('/src/stores/window-close.ts')
      useWindowCloseStore.setState({ promptId: 1, pending: false, error: '关闭方式设置失败，请重试。（模拟错误）' })
    })
    await page.locator('dialog[data-window-close]').waitFor()
  }, cleanup: async (page) => {
    await page.evaluate(async () => {
      const { useWindowCloseStore } = await import('/src/stores/window-close.ts')
      useWindowCloseStore.setState({ promptId: null, pending: false, error: '' })
    })
  } },
  { name: 'dialog-create-playlist', run: async (page) => {
    await openLibraryTab(page, 'playlists')
    await page.getByRole('button', { name: /新建/ }).first().click()
    await page.getByRole('dialog').first().waitFor()
  }, cleanup: async (page) => { await page.keyboard.press('Escape') } },
  { name: 'dialog-playlist-preview', run: async (page) => {
    await navigate(page, 'explore'); await page.getByText('私人雷达').first().waitFor()
    await page.waitForTimeout(400)
    await page.locator('button[aria-label^="查看歌单："]:not([disabled])').first().click({ timeout: 4000, force: true })
    await page.getByRole('button', { name: '进入歌单' }).waitFor({ timeout: 4000 })
  }, cleanup: async (page) => { await page.keyboard.press('Escape') } },
]
const stateScenarios = [
  { name: 'search-empty', mode: 'empty', run: async (page) => {
    await navigate(page, { type: 'search', keyword: '无结果关键词' })
    await sectionsReady(page, '歌曲搜索结果')
  } },
  { name: 'search-error', mode: 'error', run: async (page) => {
    await navigate(page, { type: 'search', keyword: KEYWORD })
    await sectionsReady(page, '歌曲搜索结果')
    await page.getByRole('button', { name: '重新搜索' }).last().waitFor()
  } },
]

const COMBOS = [
  { theme: 'dark', width: 1536, height: 864 },
  { theme: 'light', width: 1536, height: 864 },
  { theme: 'dark', width: 960, height: 540 },
  { theme: 'light', width: 960, height: 540 },
]
const STATE_COMBOS = [COMBOS[0], COMBOS[3]]

// 平台接口一律由 fixture 或拦截返回；封面走确定性 PNG。
async function installRoutes(context, unexpectedApi) {
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.includes(FIXTURE_HOST)) {
      const seed = Number((decodeURIComponent(url).match(/cover\/(\d+)\.png/) || [])[1] || 0)
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: coverPng(seed) })
    }
    const parsed = new URL(url)
    if (parsed.hostname === '127.0.0.1' && parsed.pathname.startsWith('/api/')) {
      if (parsed.pathname === '/api/login/status' || parsed.pathname === '/api/qq/login/status') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ loggedIn: true, nickname: '测试用户', avatar: '' }) })
      }
      if (parsed.pathname.startsWith('/api/apple-music/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ loggedIn: false }) })
      }
      if (!parsed.pathname.startsWith('/api/audio-cache/') && !parsed.pathname.startsWith('/api/local/')) {
        // 平台与外网相关端点一律拦截：未被 fixture 替换的调用不能带入真实数据。
        unexpectedApi.add(parsed.pathname)
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'FIXTURE_BLOCKED' }) })
      }
    }
    return route.continue()
  })
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9461')
  const context = browser.contexts()[0]
  const page = context.pages().find((p) => p.url().endsWith('/index.html'))
  if (!page) throw new Error('未找到主窗口 index.html')
  page.setDefaultTimeout(10000)
  const errors = []
  const unexpectedApi = new Set()
  page.on('pageerror', (error) => errors.push(error.message))

  await installRoutes(context, unexpectedApi)

  const cdp = await context.newCDPSession(page)
  // 截图源码可来自另一工作区（如临时 clean 基准），元数据按 SOURCE_ROOT 记录。
  const sourceRoot = process.env.SOURCE_ROOT || root
  const head = execSync('git rev-parse HEAD', { cwd: sourceRoot }).toString().trim()
  const dirty = execSync('git status --porcelain -- src overlays', { cwd: sourceRoot }).toString().trim()
  const manifest = {
    phase, generatedAt: new Date().toISOString(), commit: head,
    worktreeState: dirty ? `源码有未提交修改：\n${dirty}` : '源码与提交一致（src/overlays 无未提交修改）',
    environment: 'macOS Electron dev（electron-vite dev），独立 --user-data-dir；CDP Emulation 固定视口、deviceScaleFactor=1；平台数据为模拟 fixture；截图前有限文档时间线动画跳到终态、循环动画冻结到起点，滚动/视图时间线动画保持随滚动位置',
    fixture: 'docs/reviews/checks/ui-alignment-2.4.1.cjs（MOCK 数据，网易+QQ 已登录且启用，Apple 关闭）',
    shots: [], errors, unexpectedApi: [],
  }

  async function capture(list, combos) {
    for (const scenario of list) {
      if (only && !only.split(',').includes(scenario.name)) continue
      for (const combo of combos) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: combo.width, height: combo.height, deviceScaleFactor: 1, mobile: false })
        await page.reload()
        await page.waitForLoadState('domcontentloaded')
        await page.waitForTimeout(1200)
        await installFixture(page, scenario.mode || 'normal')
        await setTheme(page, combo.theme)
        await reset(page)
        let status = 'ok'
        let settled = {}
        let layout
        try {
          await scenario.run(page)
          settled = await settle(page)
          if (scenario.verify) layout = await scenario.verify(page)
        } catch (error) {
          status = `failed: ${error.message.split('\n')[0]}`
        }
        const file = `${scenario.name}--${combo.theme}-${combo.width}x${combo.height}.png`
        await page.screenshot({ path: path.join(output, file), scale: 'css' })
        const overflow = await overflowX(page)
        manifest.shots.push({ file, scenario: scenario.name, ...combo, mode: scenario.mode || 'normal', status, overflow, ...settled, ...(layout ? { layout } : {}), ...(only ? { capturedAt: new Date().toISOString(), sourceCommit: head, sourceState: dirty ? 'dirty' : 'clean' } : {}) })
        console.log(`${status === 'ok' ? '✓' : '✗'} ${file}${status === 'ok' ? '' : ` (${status})`}`)
        if (scenario.cleanup) await scenario.cleanup(page).catch(() => {})
      }
    }
  }

  try {
    await capture(scenarios, COMBOS)
    await capture(stateScenarios, STATE_COMBOS)
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
    manifest.unexpectedApi = [...unexpectedApi].sort()
    // 局部重跑时合并进同一份 manifest：同名截图条目以本次结果替换。
    const manifestPath = path.join(output, 'manifest.json')
    if (only && fs.existsSync(manifestPath)) {
      const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const replaced = new Set(manifest.shots.map((shot) => shot.file))
      manifest.shots = [...previous.shots.filter((shot) => !replaced.has(shot.file)), ...manifest.shots]
      manifest.unexpectedApi = [...new Set([...(previous.unexpectedApi || []), ...manifest.unexpectedApi])].sort()
      manifest.reruns = [...(previous.reruns || []), { at: manifest.generatedAt, scenarios: only, sourceRoot, commit: manifest.commit, worktreeState: manifest.worktreeState, reason: process.env.RERUN_REASON || '' }]
      // 顶层仍描述首次整套拍摄；局部重拍的源码状态记在 reruns 与对应截图条目里。
      manifest.generatedAt = previous.generatedAt
      manifest.commit = previous.commit
      manifest.worktreeState = previous.worktreeState
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    await browser.close().catch(() => {})
  }
}

module.exports = { assertArtistLayout, installRoutes, FIXTURE_HOST, coverPng, installFixture, navigate, setTheme, settle, openLibraryTab, sectionsReady, reset }

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
