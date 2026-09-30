/** Standalone browser surface: it receives only a narrowly scoped session secret. */
export const appleMusicPlayerPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Apple Music · Simple Music</title>
<style>body{font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;background:#151519;color:#f5f5f7}h1{font-size:28px}p{line-height:1.8;color:#bdbdc6}button{background:#fa3455;color:white;border:0;border-radius:10px;padding:12px 20px;margin:8px 8px 8px 0;font:inherit;cursor:pointer}button:disabled{opacity:.4}#status{white-space:pre-wrap}small{color:#999}</style></head>
<body><h1>Apple Music 播放窗口</h1><p>此窗口通过 Apple 官方 MusicKit 播放订阅音乐。请保持窗口打开，再回到 Simple Music 搜索和控制播放。</p>
<button id="authorize" disabled>登录 Apple Music</button><button id="play" disabled>开始播放</button><button id="logout" disabled>退出登录</button><p id="status">正在连接…</p><small>登录不代表已有订阅。没有有效订阅时不能完整播放歌曲，部分内容可能只有试听；不支持下载、音效处理和无损音质选择。</small>
<script>
(() => {
  const secret = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const status = document.getElementById('status')
  const auth = document.getElementById('authorize'), play = document.getElementById('play'), logout = document.getElementById('logout')
  let music, failureGeneration = 0, ack = 0, controlSequence = 0, playbackId = '', lastContact = Date.now(), active = true, currentStatus = 'idle', pendingSeek = null, expectedDuration = 0, currentError, subscription = 'unknown'
  const show = text => { status.textContent = text }
  async function api(path, body) {
    if (!active) throw new Error('播放会话已失效，请重新连接')
    const response = await fetch('/apple-music-bridge/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-apple-music-session': secret, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) { if (response.status === 401) disconnect(); throw new Error(data.error || '连接失败') }
    lastContact = Date.now()
    return data
  }
  function stopSafely() { return Promise.resolve().then(() => music?.stop()).catch(() => {}) }
  function disconnect() { active = false; auth.disabled = true; play.disabled = true; logout.disabled = true; void stopSafely() }
  async function operation(promise) {
    let timer
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { disconnect(); reject(new Error('Apple Music 响应超时，请重新连接')) }, 12000) })]) } finally { clearTimeout(timer) }
  }
  async function report(error) {
    if (!active) return
    await api('state', { playbackId, controlSequence, status: error ? 'error' : currentStatus, position: pendingSeek ?? (music?.currentPlaybackTime || 0), duration: music?.currentPlaybackDuration || 0, error: error ? String(error.message || error) : currentError, subscription })
  }
  async function fail(error) {
    failureGeneration++
    currentStatus = 'error'; currentError = String(error.message || error); show(currentError)
    void stopSafely()
    try { await report(error) } catch {}
  }
  async function refreshSubscription() {
    if (!music?.isAuthorized) { subscription = 'unknown'; return subscription }
    try { subscription = await music.hasMusicSubscription() ? 'active' : 'inactive' } catch { subscription = 'unknown' }
    return subscription
  }
  async function canPlay() {
    if (!active) throw new Error('播放会话已失效，请重新连接')
    if (!music.isAuthorized) throw new Error('请先登录 Apple Music')
    const state = await refreshSubscription()
    if (state === 'inactive') throw new Error('此 Apple 账号没有有效的 Apple Music 订阅，无法播放完整歌曲')
    if (state !== 'active') throw new Error('暂时无法确认 Apple Music 订阅状态，请检查网络后重试')
    music.previewOnly = false
  }
  async function start(sequence = ack, confirmedSequence) {
    const generation = failureGeneration
    await canPlay()
    // SDK加载可能耗时数秒；真正出声前重新核对期间收到的切歌/暂停/停止。
    // 此处只查看未确认指令，主循环仍负责按序执行和确认它们。
    const pending = await api('poll?ack=' + ack)
    if (pending.commands.some(c => c.sequence > sequence && (
      c.type === 'load' || (c.playbackId === playbackId && (c.type === 'pause' || c.type === 'stop'))
    ))) {
      currentStatus = 'paused'
      return
    }
    if (generation !== failureGeneration) return
    await operation(music.play())
    if (generation !== failureGeneration) { await stopSafely(); return }
    if (!active) { await music.stop(); throw new Error('播放会话已失效，请重新连接') }
    if (expectedDuration > 0 && music.currentPlaybackDuration > 0 && music.currentPlaybackDuration + 3 < expectedDuration) { await music.stop(); throw new Error('检测到试听片段，已停止播放；完整歌曲需要有效的 Apple Music 订阅') }
    if (pendingSeek !== null) { if (pendingSeek > 0) await operation(music.seekToTime(pendingSeek)); pendingSeek = null }
    if (generation !== failureGeneration) { await stopSafely(); return }
    currentError = undefined
    if (confirmedSequence !== undefined) controlSequence = confirmedSequence
    currentStatus = 'playing'; show('正在播放，可回到 Simple Music 控制'); await report()
  }
  async function command(c) {
    if (c.type !== 'load' && c.playbackId !== playbackId) return
    const generation = failureGeneration
    const confirmControl = () => { if (active && generation === failureGeneration && c.controlSequence !== undefined) controlSequence = c.controlSequence }
    if (c.type === 'load') {
      controlSequence = 0
      playbackId = c.playbackId; currentError = undefined; currentStatus = 'loading'; pendingSeek = c.startAt || 0
      await music.stop(); await canPlay()
      let songId = c.id
      if (c.library) {
        const result = await operation(music.api.music('v1/me/library/songs/' + encodeURIComponent(c.id) + '/catalog'))
        songId = result.data?.data?.[0]?.id
        if (!songId) throw new Error('此资料库歌曲没有 Apple Music 曲库版本，暂不支持播放上传的歌曲')
      }
      expectedDuration = !c.library && c.duration > 0 ? c.duration : 0
      if (!expectedDuration) {
        const details = await operation(music.api.music('v1/catalog/' + music.storefrontId + '/songs/' + encodeURIComponent(songId)))
        expectedDuration = (details.data?.data?.[0]?.attributes?.durationInMillis || 0) / 1000
      }
      await operation(music.setQueue({ song: songId, startPlaying: false }))
      if (!active || generation !== failureGeneration) return
      if (c.volume !== undefined) music.volume = c.volume
      play.disabled = false
      if (c.autoplay !== false) {
        try { await start(c.sequence) } catch (e) { if (e.name !== 'NotAllowedError' && !/autoplay|user gesture/i.test(e.message || '')) throw e; currentStatus = 'paused'; show('请点击“开始播放”以允许浏览器播放。'); await report() }
      } else { currentStatus = 'paused'; await report() }
    } else if (c.type === 'play') await start(c.sequence, c.controlSequence)
    else if (c.type === 'pause') { await music.pause(); if (active && generation === failureGeneration) { currentStatus = 'paused'; confirmControl() }; await report() }
    else if (c.type === 'stop') { await music.stop(); currentStatus = 'idle'; play.disabled = true; await report() }
    else if (c.type === 'seek') {
      if (pendingSeek !== null) pendingSeek = c.seconds || 0
      await operation(music.seekToTime(c.seconds || 0)); confirmControl(); await report()
    }
    else if (c.type === 'volume') music.volume = c.volume
  }
  async function syncAuth() {
    if (music.isAuthorized && music.musicUserToken) {
      await refreshSubscription()
      await api('auth', { token: music.musicUserToken, storefront: music.storefrontId || undefined })
      auth.textContent = '已登录'; logout.disabled = false; show('已连接，请在 Simple Music 选择歌曲')
      await report()
    }
  }
  async function loop() {
    while (active) {
      try {
        const data = await api('poll?ack=' + ack)
        for (const c of data.commands) {
          try { await command(c) } catch (e) { await fail(e) }
          ack = c.sequence
        }
        await report()
      } catch (e) { show(e.message || '连接中断'); if (!active) { try { await music.stop() } catch {} } }
      await new Promise(resolve => setTimeout(resolve, 700))
    }
  }
  // Independent watchdog also runs when a MusicKit operation is awaiting a response.
  setInterval(() => { if (active && Date.now() - lastContact > 14000) { disconnect(); currentStatus = 'error'; show('与 Simple Music 的连接已断开，请重新连接') } }, 2000)
  auth.onclick = async () => { if (!active) return; try { await music.authorize(); await syncAuth() } catch (e) { await fail(e) } }
  play.onclick = async () => { if (!active) return; try { await start() } catch (e) { await fail(e) } }
  logout.onclick = async () => { if (!active) return; try { await music.stop(); await music.unauthorize(); await api('logout', {}); disconnect(); currentStatus = 'idle'; play.disabled = true; logout.disabled = true; auth.textContent = '登录 Apple Music'; show('已退出登录'); await report() } catch (e) { await fail(e) } }
  async function ready() {
    try {
      if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('请从 Simple Music 设置页打开此窗口')
      const config = await api('config')
      music = await MusicKit.configure({ developerToken: config.developerToken, app: { name: 'Simple Music', build: '2.2.0' }, storefrontId: config.storefront })
      music.addEventListener(MusicKit.Events.playbackStateDidChange, () => {
        if (!active) { if (music.playbackState === MusicKit.PlaybackStates.playing) void stopSafely(); return }
        if (currentStatus === 'error') return
        const s = music.playbackState, p = MusicKit.PlaybackStates
        if (s === p.playing) {
          if (expectedDuration > 0 && music.currentPlaybackDuration > 0 && music.currentPlaybackDuration + 3 < expectedDuration) { music.stop(); currentStatus = 'error'; fail(new Error('检测到试听片段，已停止播放；完整歌曲需要有效的 Apple Music 订阅')); return }
          currentStatus = 'playing'
        }
        else if (s === p.paused) currentStatus = 'paused'
        else if (s === p.loading || s === p.waiting || s === p.stalled || s === p.seeking) currentStatus = 'loading'
        else if (s === p.completed || s === p.ended) currentStatus = 'ended'
      })
      music.addEventListener(MusicKit.Events.mediaPlaybackError, event => {
        if (!active || currentStatus === 'error') return
        void fail(new Error(event?.error?.message || event?.message || 'Apple Music 播放失败；请确认订阅有效，并检查网络与浏览器 DRM 支持'))
      })
      auth.disabled = false; show('播放窗口已连接，请登录 Apple Music'); await syncAuth(); loop()
    } catch (e) { show(e.message || String(e)) }
  }
  document.addEventListener('musickitloaded', ready, { once: true })
  const script = document.createElement('script'); script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'; script.onerror = () => show('Apple Music 播放组件加载失败，请检查网络后从应用重新连接'); document.head.appendChild(script)
})()
</script></body></html>`
