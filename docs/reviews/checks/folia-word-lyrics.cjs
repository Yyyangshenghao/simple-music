// 仅连接隔离 userData 的 Electron dev；注入自制歌词，不用于真实账号或正在播放的窗口。
// NODE_PATH 指向 Playwright，CDP_URL 默认 9436；不会创建或启动应用。
const { chromium } = require('playwright')
const fs = require('node:fs')
const assert = require('node:assert/strict')
const output = process.env.OUTPUT_DIR || 'docs/reviews/assets/2.4.1-folia-word-lyrics'

async function main() {
  const browser = await chromium.connectOverCDP(process.env.CDP_URL || 'http://127.0.0.1:9436')
  const page = browser.contexts()[0].pages().find(page => page.url().endsWith('/index.html'))
  fs.mkdirSync(output, { recursive: true })
  await page.waitForLoadState('networkidle')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.evaluate(async () => {
    const [{ usePlayerStore: player }, { useLyricsStore: lyrics }, { useSettingsStore: settings }, { useVisualStore: visual }, { useAmbientStore: ambient }] = await Promise.all([
      import('/src/stores/player.ts'), import('/src/stores/lyrics.ts'), import('/src/stores/settings.ts'), import('/src/stores/visual.ts'), import('/src/stores/ambient.ts'),
    ])
    window.folia = { player, lyrics, settings, visual, ambient, clock: 8.3 }
    settings.getState().applyPerformancePreset('standard')
    settings.getState().setLyricsPanelMode('pop')
    settings.getState().setThemeMode('dark')
    settings.getState().setLyricsFontScale(1)
    visual.getState().updateFx({ backgroundFluid: false })
    const track = { id: 'folia-fixture', source: 'local', provider: 'local', type: 'song', name: '光落在声音里', artist: '逐字效果预览', artists: [], duration: 120000 }
    player.setState({ currentTrack: track, resolvedTrack: null, status: 'paused', position: 8.3, duration: 120, playbackTransport: null, _engine: () => ({ get position() { return window.folia.clock } }) })
    ambient.getState().setPalette(['#ba855c', '#9071b2', '#c5a98c'])
    const text = '让每个音符都有自己的形状'
    const words = Array.from(text).map((text, i) => ({ text, startMs: i * 320, durationMs: i === 6 ? 600 : 320 }))
    lyrics.setState({ trackKey: 'local:folia-fixture', source: 'local', loading: false, offsetSec: 0, lines: [{ time: 5, text }, { time: 11, text: '下一句，在旋律里慢慢展开' }], wordLines: [{ time: 5, durationMs: 5000, words }], translation: [{ time: 5, text: 'Let every note find its own shape.' }], currentIndex: 0 })
  })
  if (!await page.locator('[data-pop-lyrics]').count()) await page.getByRole('button', { name: '查看歌词', exact: true }).click()
  await page.waitForSelector('[data-pop-lyrics]')
  await page.waitForTimeout(650)
  const checks = []
  const capture = async (name, width, height, theme) => {
    await page.setViewportSize({ width, height })
    await page.evaluate(theme => window.folia.settings.getState().setThemeMode(theme), theme)
    await page.waitForTimeout(260)
    await page.screenshot({ path: `${output}/${name}.png` })
    return page.locator('[data-pop-lyrics]').evaluate(root => {
      const box = root.getBoundingClientRect()
      const visible = [...root.querySelectorAll('span')].filter(el => el.textContent.trim() && !el.getAttribute('aria-hidden'))
      return { viewport: [innerWidth, innerHeight], root: { x: box.x, y: box.y, width: box.width, height: box.height }, overflow: document.documentElement.scrollWidth > innerWidth, animations: root.getAnimations({ subtree: true }).length, spansOutsideViewport: visible.filter(el => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 48 || r.bottom > innerHeight - 110 }).length }
    })
  }
  checks.push({ scenario: 'dark-1536', ...await capture('dark-1536', 1536, 960, 'dark') })
  checks.push({ scenario: 'light-960', ...await capture('light-960', 960, 720, 'light') })
  const times = () => page.locator('[data-pop-lyrics]').evaluate(root => root.getAnimations({ subtree: true }).map(a => a.currentTime))
  const paused = await times()
  await page.waitForTimeout(150)
  assert.deepEqual(await times(), paused)
  await page.evaluate(() => { window.folia.clock = 5.3; window.folia.player.setState({ position: 5.3 }) })
  await page.waitForTimeout(30)
  const back = await times()
  assert.ok(back.some((time, i) => time < paused[i]))
  checks.push({ scenario: 'paused-and-seek', pausedClockStable: true, rewound: true })
  const sustained = await page.evaluate(async () => {
    const { createPopLyricTimeline } = await import(`/src/lib/pop-lyric-motion.ts?verify=${Date.now()}`)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:0;top:0;opacity:.01;pointer-events:none'
    const pop = document.createElement('span')
    const glow = document.createElement('span')
    pop.textContent = glow.textContent = '长音'
    pop.style.display = 'inline-block'
    host.append(pop, glow)
    document.body.append(host)
    const timeline = createPopLyricTimeline([pop], [glow], [{ text: '长音', startMs: 0, durationMs: 2000, scale: 1, popMs: 380 }], 1000)
    timeline.seek(1900)
    await new Promise(requestAnimationFrame)
    const matrix = new DOMMatrixReadOnly(getComputedStyle(pop).transform)
    const activeScale = Math.hypot(matrix.a, matrix.b)
    const activeGlow = Number(getComputedStyle(glow).opacity)
    timeline.seek(2800)
    await new Promise(requestAnimationFrame)
    const end = new DOMMatrixReadOnly(getComputedStyle(pop).transform)
    const settledScale = Math.hypot(end.a, end.b)
    timeline.dispose()
    host.remove()
    return { activeScale, activeGlow, settledScale }
  })
  assert.ok(sustained.activeScale >= 1.09, '长音在演唱结束前不能提前回落')
  assert.equal(sustained.activeGlow, 1)
  assert.ok(Math.abs(sustained.settledScale - 1) < 0.001)
  checks.push({ scenario: 'sustained-word-clock', ...sustained })
  await page.evaluate(() => window.folia.settings.getState().setPerformance({ lyricsWordMotion: false }))
  await page.waitForTimeout(100)
  assert.equal(await page.locator('[data-pop-lyrics]').evaluate(root => root.getAnimations({ subtree: true }).length), 0)
  checks.push({ scenario: 'word-motion-disabled', remainingAnimations: 0 })
  await page.evaluate(() => {
    const { lyrics, settings } = window.folia
    settings.getState().setPerformance({ lyricsWordMotion: true })
    settings.getState().setLyricsFontScale(1.5)
    const text = '把很长很长的故事留在风里，再让每个字随着旋律找到属于自己的位置。'
    window.folia.clock = 9
    lyrics.setState({ lines: [{ time: 5, text }, { time: 25, text: 'A new line follows the music.' }], wordLines: [], currentIndex: 0, translation: [{ time: 5, text: 'A longer line stays readable as the rhythm opens up.' }] })
  })
  checks.push({ scenario: 'long-estimated-960', ...await capture('long-estimated-960', 960, 720, 'dark') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(100)
  assert.equal(await page.locator('[data-pop-lyrics]').evaluate(root => root.getAnimations({ subtree: true }).length), 0)
  checks.push({ scenario: 'system-reduced-motion', remainingAnimations: 0 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    const { lyrics, settings } = window.folia
    settings.getState().setLyricsFontScale(1)
    const text = 'Supercalifragilisticexpialidocious — let the melody carry us home'
    window.folia.clock = 20
    lyrics.setState({ lines: [{ time: 5, text }, { time: 25, text: '下一句，在旋律里慢慢展开' }], wordLines: [], currentIndex: 0, translation: [] })
  })
  checks.push({ scenario: 'long-english-960', ...await capture('long-english-960', 960, 720, 'light') })
  await page.evaluate(() => {
    const { lyrics, player } = window.folia
    window.folia.clock = 5.6
    player.setState({ position: 5.6 })
    lyrics.setState({ lines: [{ time: 5, text: '此刻' }, { time: 10, text: '让每个音符都有自己的形状' }], wordLines: [{ time: 5, durationMs: 2400, words: [{ text: '此', startMs: 0, durationMs: 650 }, { text: '刻', startMs: 650, durationMs: 1750 }] }], translation: [{ time: 5, text: 'Here. Now.' }], currentIndex: 0 })
  })
  checks.push({ scenario: 'short-impact-960', ...await capture('short-impact-960', 960, 720, 'dark') })
  assert.equal(await page.locator('[data-composition]').getAttribute('data-composition'), 'impact')
  await page.evaluate(() => {
    const { lyrics, player, settings } = window.folia
    settings.getState().setLyricsFontScale(1.8)
    settings.getState().setLyricsShowTranslation(false)
    window.folia.clock = 18
    player.setState({ position: 18 })
    lyrics.setState({ lines: [{ time: 5, text: '把很长很长的故事留在风里，再让每个字随着旋律找到属于自己的位置。' }, { time: 25, text: '下一句也会随着音乐变化' }], wordLines: [], translation: [{ time: 5, text: 'Keep the long story in the wind, and let every word find a place in the melody as it unfolds.' }], currentIndex: 0 })
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => window.folia.settings.getState().setLyricsShowTranslation(true))
  checks.push({ scenario: 'translation-toggle-max-font', ...await capture('translation-toggle-max-font', 960, 720, 'light') })
  assert.equal(await page.locator('[data-composition]').getAttribute('data-composition'), 'verse')
  checks.push({ scenario: 'compositions-and-order', ...await page.locator('[data-pop-lyrics]').evaluate(root => ({ phrases: root.querySelectorAll('[data-pop-phrase]').length, fitted: Number(root.querySelector('[data-composition]').style.getPropertyValue('--pop-fit')) })) })
  fs.writeFileSync(`${output}/verification.json`, JSON.stringify({ environment: 'macOS Electron dev, isolated userData, synthetic lyric fixture', checks, errors }, null, 2))
  console.log(JSON.stringify({ checks, errors }))
  await browser.close()
}
main().catch(error => { console.error(error); process.exit(1) })
