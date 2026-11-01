import * as electron from 'electron'
import { BrowserWindow, session } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppleMusicWebSession } from '../../server/lib/apple-music-web-types'
import type { AppleMusicCommand } from '../../server/lib/apple-music-bridge'
import { appleMusicWebPage, type WebPageTask } from '../../server/lib/apple-music-web-page'
import { AppleMusicChromePage } from './apple-music-chrome-page'

const PLAYBACK_PARTITION = 'persist:simplemusic-apple-music'
const AUTH_PRELOAD_ID = 'simplemusic-apple-music-auth'
const APPLE_MUSIC_URL = 'https://music.apple.com/'
const OPEN_TIMEOUT_MS = 30000
const RESTORE_CONFIRM_TIMEOUT_MS = 30000
/** 授权后探测页面 MusicKit 是否过期的间隔；轮询本身是 1 秒，探针不跟着每次轮询打。 */
const AUTH_PROBE_INTERVAL_MS = 3000
/**
 * 上次登录确认过的账号地区。登录页打开不带地区前缀的根路径时，官网按出口 IP 决定地区，
 * 代理节点和账号地区不一致就会在登录后整页跳到账号地区（Apple 风控最敏感的时刻）。
 * 记住账号地区后直接打开对应地区页，代理只影响能否连通，不再影响登录页地区。
 */
const STOREFRONT_FILE = 'apple-music-storefront'
const STOREFRONT_PATTERN = /^[a-z]{2}$/
// 官网首页挂着十几个动态封面视频，隐藏后仍独占数百 MB；后台播放只需要 MusicKit，
// 在页面内点到搜索页（单页路由，不重载）即可释放，MusicKit 实例与授权保持不变。
const LIGHT_PAGE_SCRIPT = `(() => {
  if (location.pathname.endsWith('/search')) return false
  const link = document.querySelector('a[href$="/search"]')
  if (!link) return false
  link.click()
  return true
})()`
const emptyState = () => ({ connected: false, loggedIn: false, subscription: 'unknown' as const, storefront: 'cn', playbackId: '', status: 'idle' as const, position: 0, duration: 0 })

type ProtectedElectron = typeof electron & {
  components?: { whenReady(): Promise<unknown> }
}

/**
 * 在应用自己的隐藏 BrowserWindow 中运行 Apple 官网 MusicKit。
 * 窗口只在授权时显示；授权成功后自动隐藏，播放不再依赖外部浏览器。
 */
export class OfficialAppleMusicSession implements AppleMusicWebSession {
  private window?: BrowserWindow
  private chrome?: AppleMusicChromePage
  private timer?: ReturnType<typeof setTimeout>
  private opening?: Promise<void>
  private openingCancel?: () => void
  private openingChrome?: Promise<AppleMusicChromePage>
  private openingController?: AbortController
  private closing: Promise<void> = Promise.resolve()
  private generation = 0
  private lifecycle = 0
  private loginPrompted = false
  private redirectedStorefront = ''
  private interactive = false
  private backgrounded = false
  private authorizationShown = false
  private restoreSaved = false
  /** 上次登录确认过的账号地区，只用于让登录页直接落在同区。 */
  private storedStorefront = ''
  /** 平台被关闭：后台页面已销毁，登录 Cookie 保留，重新启用时静默重连。 */
  private suspended = false
  private restoring = false
  private restoreTimer?: ReturnType<typeof setTimeout>
  private loggingOut = false
  private pollFailures = 0
  private pageReadyDeadline = 0
  /** 授权后页面里的 MusicKit 可能仍是未授权的旧实例，见 recoverStaleAuthorization。 */
  private authProbeAt = 0
  private authReloaded = false
  private queue: Promise<unknown> = Promise.resolve()
  private queuedControls = new Map<string, symbol>()
  private snapshot: ReturnType<AppleMusicWebSession['state']> = emptyState()

  constructor(
    private readonly userDataDir: string,
    private readonly useChromeForDrm = false,
    private readonly returnToApp: () => void = () => {},
  ) {}
  state() {
    if (this.suspended) return { ...emptyState(), loggedIn: true, storefront: this.snapshot.storefront, restoring: false, suspended: true }
    return { ...this.snapshot, restoring: this.restoring }
  }

  /** 仅应用内 MusicKit 窗口可供主渲染层捕获音频；开发态 Chrome 不属于本进程。 */
  captureFrame(): Electron.WebFrameMain | null {
    const win = this.window
    return win && !win.isDestroyed() && win.webContents.getURL().startsWith(APPLE_MUSIC_URL)
      ? win.webContents.mainFrame
      : null
  }

  async open(): Promise<void> {
    this.finishRestore()
    this.suspended = false
    this.interactive = true
    // 每次显式登录都是一次新的授权尝试，允许再做一次过期实例恢复。
    this.authProbeAt = 0
    this.authReloaded = false
    if (this.window && !this.snapshot.loggedIn) {
      this.backgrounded = false
      this.authorizationShown = false
      this.showAuthorization(this.window)
    }
    return this.beginOpen()
  }

  async restore(): Promise<void> {
    // 开发用 Chrome 仍有独立窗口；只对发布版的应用内会话自动恢复。
    if (this.useChromeForDrm || this.opening || this.window) return
    let saved = ''
    try { saved = readFileSync(join(this.userDataDir, 'apple-music-restore'), 'utf8') } catch { return }
    if (saved === 'suspended') { this.suspended = true; return }
    if (saved !== 'true') return
    await this.silentOpen()
  }

  /** 关闭 Apple 平台时销毁后台页面（开发态即退出专用 Chrome），省下整套官网页面的内存。 */
  async suspend(): Promise<void> {
    if (this.suspended || this.loggingOut || (!this.snapshot.loggedIn && !this.restoring)) return
    const storefront = this.snapshot.storefront
    this.suspended = true
    // 开发态 Chrome 不做静默恢复；与发布版共用 userData，不改写发布版的恢复标记。
    if (!this.useChromeForDrm) this.writeRestore('suspended')
    await this.close()
    this.snapshot = { ...this.snapshot, storefront }
  }

  /** 重新启用平台：沿用保留的登录 Cookie 在后台重连，不弹授权窗口。 */
  async resume(): Promise<void> {
    if (!this.suspended) return
    this.suspended = false
    if (!this.useChromeForDrm) this.writeRestore('true')
    await this.silentOpen()
  }

  private async silentOpen(): Promise<void> {
    this.interactive = false
    this.restoring = true
    try { await this.beginOpen() }
    catch { this.finishRestore(); return }
    if (this.restoring && !this.snapshot.loggedIn && !this.interactive) {
      this.restoreTimer = setTimeout(() => this.finishRestore(), RESTORE_CONFIRM_TIMEOUT_MS)
    }
  }

  private finishRestore(): void {
    this.restoring = false
    clearTimeout(this.restoreTimer)
    this.restoreTimer = undefined
  }

  private saveRestore(enabled: boolean): void {
    if (enabled && (this.restoreSaved || this.loggingOut)) return
    this.writeRestore(enabled ? 'true' : 'false')
  }

  private writeRestore(value: 'true' | 'false' | 'suspended'): void {
    try {
      writeFileSync(join(this.userDataDir, 'apple-music-restore'), value, { mode: 0o600 })
      this.restoreSaved = value === 'true'
    } catch { /* 恢复偏好写入失败不影响当前播放。 */ }
  }

  /** 登录页地址：有账号地区记录就直接开对应地区，否则交给官网按出口 IP 决定。 */
  private loginUrl(): string {
    const storefront = this.readStorefront()
    return storefront ? `https://music.apple.com/${storefront}/` : APPLE_MUSIC_URL
  }

  private readStorefront(): string {
    if (this.storedStorefront) return this.storedStorefront
    try {
      const value = readFileSync(join(this.userDataDir, STOREFRONT_FILE), 'utf8').trim()
      if (STOREFRONT_PATTERN.test(value)) this.storedStorefront = value
    } catch { /* 没有历史地区时退回官网默认地区 */ }
    return this.storedStorefront
  }

  /** 登录页将使用的地区；空字符串表示由官网按出口 IP 决定。 */
  loginStorefront(): string {
    return this.readStorefront()
  }

  /**
   * 未登录时由用户指定登录页地区，免得按出口 IP 落到别的地区再跳转。
   * 已登录时地区以账号为准（登录后会写回账号地区），这里拒绝修改。
   */
  setLoginStorefront(value: string): boolean {
    if (this.snapshot.loggedIn || this.suspended || (value && !STOREFRONT_PATTERN.test(value))) return false
    this.writeStorefront(value)
    return true
  }

  private writeStorefront(value: string): void {
    if (value && !STOREFRONT_PATTERN.test(value)) return
    if (value === this.storedStorefront) return
    this.storedStorefront = value
    try { writeFileSync(join(this.userDataDir, STOREFRONT_FILE), value, { mode: 0o600 }) } catch { /* 写入失败只影响下次登录的地区猜测 */ }
  }

  private async beginOpen(): Promise<void> {
    if (this.opening) return this.opening
    const controller = new AbortController()
    this.openingController = controller
    let cancel!: () => void
    const cancellation = new Promise<never>((_, reject) => { cancel = () => reject(new Error('连接已取消')) })
    const opening = this.openWindow(cancellation, controller.signal)
    this.opening = opening
    this.openingCancel = cancel
    void opening.then(
      () => this.finishOpening(opening),
      () => this.finishOpening(opening),
    )
    return opening
  }

  private finishOpening(opening: Promise<void>) {
    if (this.opening !== opening) return
    this.opening = undefined
    this.openingCancel = undefined
  }

  private async openWindow(cancellation: Promise<never>, signal: AbortSignal) {
    if (this.useChromeForDrm) return this.openChromeWindow(cancellation, signal)
    const existing = this.window
    if (existing && !existing.isDestroyed()) {
      if (!this.snapshot.loggedIn && this.interactive) {
        this.backgrounded = false
        this.showAuthorization(existing)
      }
      if (!existing.webContents.getURL().startsWith(APPLE_MUSIC_URL)) {
        await withTimeout(Promise.race([existing.loadURL(this.loginUrl()), cancellation]), OPEN_TIMEOUT_MS, 'Apple Music 官网加载超时，请检查网络后重试')
      }
      return
    }

    const lifecycle = this.lifecycle
    const appleSession = session.fromPartition(PLAYBACK_PARTITION)
    appleSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => isAllowedApplePermission(permission, requestingOrigin))
    appleSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      callback(isAllowedApplePermission(permission, details.requestingUrl))
    })
    // 设在会话上，MusicKit 授权弹窗（window.open）也用 Chrome UA，不暴露 Electron 标识。
    appleSession.setUserAgent(chromeUserAgent())
    const disablePasskeys = process.platform !== 'darwin'
    if (disablePasskeys && !appleSession.getPreloadScripts().some(script => script.id === AUTH_PRELOAD_ID)) {
      appleSession.registerPreloadScript({ id: AUTH_PRELOAD_ID, type: 'frame', filePath: join(import.meta.dirname, '../preload/apple-music-auth.cjs') })
    }
    const win = new BrowserWindow({
      title: '登录 Apple Music',
      width: 1120,
      height: 760,
      minWidth: 760,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0d0d0f',
      webPreferences: {
        partition: PLAYBACK_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        // Apple ID 登录表单在跨域 iframe 内，屏蔽通行密钥的 preload 需要进子框架。
        nodeIntegrationInSubFrames: disablePasskeys,
      },
    })
    if (lifecycle !== this.lifecycle) { win.destroy(); throw new Error('连接已取消') }
    this.window = win
    this.snapshot = emptyState()
    this.pageReadyDeadline = Date.now() + OPEN_TIMEOUT_MS
    this.backgrounded = false
    this.authorizationShown = false
    this.loginPrompted = false
    this.redirectedStorefront = ''
    this.pollFailures = 0
    win.webContents.setWindowOpenHandler(({ url }) => isAppleUrl(url) ? { action: 'allow' } : { action: 'deny' })
    win.webContents.on('render-process-gone', () => this.invalidateWindow(win))
    win.webContents.on('will-prevent-unload', event => event.preventDefault())
    win.on('unresponsive', () => this.invalidateWindow(win))
    win.on('closed', () => {
      if (this.window !== win) return
      this.window = undefined
      clearTimeout(this.timer)
      this.snapshot = { ...this.snapshot, connected: false, loggedIn: false }
      ++this.generation
      this.openingCancel?.()
    })
    if (this.interactive) this.showAuthorization(win)
    try {
      const components = (electron as ProtectedElectron).components
      if (components) {
        try {
          await withTimeout(Promise.race([components.whenReady(), cancellation]), OPEN_TIMEOUT_MS, 'Apple Music 受保护媒体组件加载超时，请检查网络后重试')
        } catch (error) {
          if (error instanceof Error && error.message === '连接已取消') throw error
          if (error instanceof Error && error.message.includes('超时')) throw error
          throw new Error('Apple Music 受保护媒体组件加载失败，请检查网络后重试')
        }
      }
      if (lifecycle !== this.lifecycle || win.isDestroyed()) throw new Error('连接已取消')
      this.pageReadyDeadline = Date.now() + OPEN_TIMEOUT_MS
      await withTimeout(Promise.race([win.loadURL(this.loginUrl()), cancellation]), OPEN_TIMEOUT_MS, 'Apple Music 官网加载超时，请检查网络后重试')
      if (lifecycle !== this.lifecycle) { win.destroy(); throw new Error('连接已取消') }
      await Promise.race([this.poll(win), cancellation])
    } catch (error) {
      if (!win.isDestroyed()) win.destroy()
      if (error instanceof Error && error.message === '连接已取消') throw error
      if (error instanceof Error && error.message.includes('超时')) throw error
      if (error instanceof Error && error.message.includes('受保护媒体组件')) throw error
      throw new Error('Apple Music 官网加载失败，请检查网络后重试')
    }
  }

  private async openChromeWindow(cancellation: Promise<never>, signal: AbortSignal): Promise<void> {
    const existing = this.chrome
    if (existing?.isAlive()) {
      if (!this.snapshot.loggedIn) { this.backgrounded = false; await existing.show() }
      return
    }
    const lifecycle = this.lifecycle
    let created: AppleMusicChromePage | undefined
    const opening = AppleMusicChromePage.open(this.userDataDir, () => {
      if (created && this.chrome === created) this.invalidateChrome(created)
    }, signal, this.loginUrl())
    this.openingChrome = opening
    let chrome: AppleMusicChromePage
    try {
      chrome = await withTimeout(Promise.race([opening, cancellation]), OPEN_TIMEOUT_MS, 'Chrome Apple Music 启动超时，请检查 Chrome 后重试')
      created = chrome
    } catch (error) {
      if (this.openingChrome === opening) this.openingController?.abort()
      await opening.then(page => page.close(), () => {})
      throw error
    } finally {
      if (this.openingChrome === opening) this.openingChrome = undefined
    }
    if (lifecycle !== this.lifecycle) { await chrome.close(); throw new Error('连接已取消') }
    this.chrome = chrome
    this.snapshot = emptyState()
    this.pageReadyDeadline = Date.now() + OPEN_TIMEOUT_MS
    this.backgrounded = false
    this.loginPrompted = false
    this.pollFailures = 0
    await chrome.show()
    void this.pollChrome(chrome)
  }

  private async evaluate(task: WebPageTask) {
    if (this.chrome?.isAlive()) {
      const script = `(${appleMusicWebPage.toString()})(${JSON.stringify(task)})`
      const timeoutMs = task.type === 'command' ? 60_000 : task.type === 'catalog' ? 30_000 : undefined
      return this.chrome.evaluate(script, timeoutMs)
    }
    const win = this.window
    if (!win || win.isDestroyed() || new URL(win.webContents.getURL()).origin !== 'https://music.apple.com') throw new Error('请在 Apple Music 授权窗口完成登录或重新连接')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const script = `(${appleMusicWebPage.toString()})(${JSON.stringify(task)})`
      return await Promise.race([
        win.webContents.executeJavaScript(script, true),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Apple Music 应用内播放操作超时，请重新连接')), 15000) }),
      ])
    } finally { clearTimeout(timer) }
  }

  private async evaluateScript(script: string): Promise<unknown> {
    if (this.chrome?.isAlive()) return this.chrome.evaluate(script)
    const win = this.window
    if (!win || win.isDestroyed()) throw new Error('Apple Music 播放页面未连接')
    return withTimeout(win.webContents.executeJavaScript(script, true), 15000, 'Apple Music 登录操作超时，请重新连接')
  }

  private async poll(win: BrowserWindow) {
    const generation = this.generation
    let nextPollMs: number | undefined
    try {
      const value = await this.evaluate({ type: 'state' }) as ReturnType<AppleMusicWebSession['state']> & { redirectUrl?: string }
      const { redirectUrl, ...state } = value
      if (this.window === win && generation === this.generation) {
        // 账号地区是登录后才知道的权威值，记下来供下次登录页直接落在同区。
        if (state.loggedIn && STOREFRONT_PATTERN.test(state.storefront)) this.writeStorefront(state.storefront)
        const currentRegion = new URL(win.webContents.getURL()).pathname.split('/')[1]
        if (state.loggedIn && redirectUrl && /^[a-z]{2}$/.test(state.storefront)) {
          this.snapshot = { ...emptyState(), connected: state.connected, storefront: state.storefront }
          if (currentRegion !== state.storefront && this.redirectedStorefront !== state.storefront) {
            this.pageReadyDeadline = Date.now() + OPEN_TIMEOUT_MS
            this.redirectedStorefront = state.storefront
            await withTimeout(win.loadURL(`https://music.apple.com/${state.storefront}/new`), OPEN_TIMEOUT_MS, 'Apple Music 账号地区页面加载超时')
            nextPollMs = 4000
          } else {
            this.snapshot.error = 'Apple Music 网页地区与账号地区不一致，无法播放；请重新连接后重试'
          }
        } else {
          this.pageReadyDeadline = 0
          this.pollFailures = 0
          if (this.snapshot.status === 'loading' && state.playbackId !== this.snapshot.playbackId) {
            this.snapshot = { ...this.snapshot, connected: state.connected, loggedIn: state.loggedIn, subscription: state.subscription, storefront: state.storefront }
          } else this.snapshot = state
          if (state.loggedIn && !win.isDestroyed()) {
            this.finishRestore()
            this.interactive = false
            this.saveRestore(true)
            if (!this.backgrounded) { win.hide(); win.setSkipTaskbar(true); this.backgrounded = true; this.authorizationShown = false; this.leaveHeavyPage() }
          } else if (this.interactive && !this.loginPrompted) {
            this.backgrounded = false
            this.showAuthorization(win)
            this.loginPrompted = await this.promptLogin()
          } else if (!state.loggedIn) {
            await this.recoverStaleAuthorization(() => withTimeout(win.loadURL(this.loginUrl()), OPEN_TIMEOUT_MS, 'Apple Music 官网重新加载超时'))
          }
        }
      }
    } catch {
      if (this.window === win) {
        // 官网登录页未就绪时仍允许显式登录，静默恢复始终不弹窗。
        if (this.interactive && !this.loginPrompted && !this.backgrounded) {
          this.showAuthorization(win)
        }
        if (++this.pollFailures >= 3 && Date.now() >= this.pageReadyDeadline) this.invalidateWindow(win)
      }
    }
    if (this.window === win && !win.isDestroyed()) this.timer = setTimeout(() => void this.poll(win), nextPollMs ?? this.playbackPollInterval())
  }

  private leaveHeavyPage(): void {
    void this.evaluateScript(LIGHT_PAGE_SCRIPT).catch(() => { /* 留在原页面只是多占内存 */ })
  }

  private playbackPollInterval(): number {
    if (this.pollFailures) return 1000
    return this.snapshot.playbackId && ['playing', 'loading', 'paused'].includes(this.snapshot.status) ? 250 : 1000
  }

  private showAuthorization(win: BrowserWindow): void {
    if (this.authorizationShown || win.isDestroyed()) return
    this.authorizationShown = true
    win.setSkipTaskbar(false); win.show(); win.focus()
  }

  private async promptLogin(): Promise<boolean> {
    try {
      return !!await this.evaluateScript(`(() => {
        const buttons = [...document.querySelectorAll('button')]
        const login = buttons.find(button => /^(Sign In|登录|登入)$/.test((button.textContent || '').trim()))
        if (!(login instanceof HTMLElement)) return false
        login.click()
        return true
      })()`)
    } catch { return false }
  }

  /**
   * 登录可能完成在 window.open 弹窗里，或官网在当前页内登录后没有整页重载；这时后台页面里的
   * MusicKit 仍是未授权的旧实例，全靠 isAuthorized 的状态轮询会一直报告未登录，资料库查询也
   * 全部失败，只有重启应用（冷加载官网）才会恢复。这里用一次账号接口探针区分「真的没登录」和
   * 「实例已过期」，后者重新加载官网一次，让 MusicKit 带着会话重新初始化。
   */
  private async recoverStaleAuthorization(reload: () => Promise<void>): Promise<void> {
    if (!this.interactive || this.authReloaded || Date.now() < this.authProbeAt) return
    this.authProbeAt = Date.now() + AUTH_PROBE_INTERVAL_MS
    let sessionValid = false
    try {
      const probe = await this.evaluate({ type: 'auth' }) as { authorized?: boolean; sessionValid?: boolean } | undefined
      sessionValid = !!probe?.sessionValid && !probe.authorized
    } catch { return }
    if (!sessionValid || this.authReloaded || !this.interactive) return
    this.authReloaded = true
    // 重载期间页面还没就绪，先放宽轮询失败上限，避免被当成死页面销毁。
    this.pageReadyDeadline = Date.now() + OPEN_TIMEOUT_MS
    this.loginPrompted = false
    try { await reload() } catch { /* 下一轮轮询继续观察，失败时仍会按原超时规则回收页面 */ }
  }

  private async pollChrome(chrome: AppleMusicChromePage): Promise<void> {
    const generation = this.generation
    let nextPollMs: number | undefined
    try {
      const value = await this.evaluate({ type: 'state' }) as ReturnType<AppleMusicWebSession['state']> & { redirectUrl?: string }
      const { redirectUrl, ...state } = value
      if (this.chrome === chrome && generation === this.generation) {
        this.pageReadyDeadline = 0
        this.pollFailures = 0
        // 账号地区是登录后才知道的权威值，记下来供下次启动直接落在同区。
        if (state.loggedIn && STOREFRONT_PATTERN.test(state.storefront)) this.writeStorefront(state.storefront)
        if (this.snapshot.status === 'loading' && state.playbackId !== this.snapshot.playbackId) {
          this.snapshot = { ...this.snapshot, connected: state.connected, loggedIn: state.loggedIn, subscription: state.subscription, storefront: state.storefront }
        } else this.snapshot = state
        if (redirectUrl) {
          this.pageReadyDeadline = Date.now() + OPEN_TIMEOUT_MS
          await chrome.navigate(redirectUrl)
          nextPollMs = 4000
        } else if (state.loggedIn) {
          this.finishRestore()
          this.interactive = false
          // macOS 最小化 Chrome 会使官网播放停滞；保留窗口，仅将焦点交回主应用。
          if (!this.backgrounded) { this.backgrounded = true; this.returnToApp(); this.leaveHeavyPage() }
        } else if (this.interactive && !this.loginPrompted) this.loginPrompted = await this.promptLogin()
        else await this.recoverStaleAuthorization(() => chrome.navigate(this.loginUrl()))
      }
    } catch {
      if (this.chrome === chrome) {
        if (++this.pollFailures >= 3 && Date.now() >= this.pageReadyDeadline) this.invalidateChrome(chrome)
      }
    }
    if (this.chrome === chrome && chrome.isAlive()) this.timer = setTimeout(() => void this.pollChrome(chrome), nextPollMs ?? this.playbackPollInterval())
  }

  async catalog(path: string) {
    if (!this.snapshot.loggedIn) throw new Error('请先在 Apple Music 授权窗口完成登录')
    return this.evaluate({ type: 'catalog', path })
  }

  command(command: AppleMusicCommand) {
    if (!command || !['load', 'play', 'pause', 'stop', 'seek', 'volume'].includes(command.type) || typeof command.playbackId !== 'string' || command.playbackId.length > 256) throw new Error('无效播放指令')
    if (command.type === 'load' && (typeof command.id !== 'string' || !/^[\w.-]{1,256}$/.test(command.id))) throw new Error('无效歌曲编号')
    for (const key of ['startAt', 'seconds', 'volume', 'duration'] as const) {
      if (command[key] !== undefined && (!Number.isFinite(command[key]) || command[key]! < 0 || (key === 'volume' && command[key]! > 1))) throw new Error('无效播放参数')
    }
    if (command.controlSequence !== undefined && (!Number.isSafeInteger(command.controlSequence) || command.controlSequence < 0)) throw new Error('无效播放参数')
    const backendAlive = this.chrome?.isAlive() || (this.window && !this.window.isDestroyed())
    if (!backendAlive || !this.snapshot.loggedIn) throw new Error('请先在 Apple Music 授权窗口完成登录')
    if (command.type === 'load' || command.type === 'play') {
      if (this.snapshot.subscription === 'inactive') throw new Error('此 Apple 账号没有有效的 Apple Music 订阅，无法播放完整歌曲')
      if (this.snapshot.subscription !== 'active') throw new Error('暂时无法确认 Apple Music 订阅状态，请检查网络后重试')
    }
    if (command.type !== 'load' && command.playbackId !== this.snapshot.playbackId) return
    const cancels = ['load', 'stop'].includes(command.type)
    if (cancels) ++this.generation
    const generation = this.generation
    const backend = this.chrome ?? this.window
    const replaceable = command.type === 'volume' || command.type === 'seek'
    const queued = Symbol()
    if (replaceable) this.queuedControls.set(command.type, queued)
    if (command.type === 'load') this.snapshot = { ...this.snapshot, playbackId: command.playbackId, status: 'loading', position: command.startAt || 0, controlSequence: 0, error: undefined }
    const invalidated = cancels ? this.evaluate({ type: 'invalidate', generation }) : command.type === 'pause' ? this.evaluate({ type: 'suspend', playbackId: command.playbackId, controlSequence: command.controlSequence }) : Promise.resolve()
    void invalidated.catch(() => {})
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (generation !== this.generation || backend !== (this.chrome ?? this.window)) return
      if (replaceable) {
        if (this.queuedControls.get(command.type) !== queued) return
        this.queuedControls.delete(command.type)
      }
      await invalidated
      await this.evaluate({ type: 'command', command, generation })
    }).catch(async error => {
      if (generation !== this.generation || backend !== (this.chrome ?? this.window)) return
      const playbackId = this.snapshot.playbackId
      const operation = { load: '加载歌曲', play: '开始播放', pause: '暂停', stop: '停止播放', seek: '调整进度', volume: '调整音量' }[command.type]
      const reason = error instanceof Error ? error.message : '播放页面执行失败'
      const closing = this.close()
      this.snapshot = { ...this.snapshot, playbackId, status: 'error', error: `Apple Music ${operation}失败：${reason}；请重新连接后重试` }
      await closing
    })
  }

  private async closeWindow() {
    this.finishRestore()
    ++this.lifecycle
    ++this.generation
    clearTimeout(this.timer)
    const win = this.window
    const chrome = this.chrome
    const openingChrome = this.openingChrome
    this.window = undefined
    this.chrome = undefined
    this.snapshot = emptyState()
    if (win && !win.isDestroyed()) win.destroy()
    await Promise.all([chrome?.close(), openingChrome?.then(page => page.close(), () => {})])
  }

  private invalidateWindow(win: BrowserWindow) {
    if (this.window !== win) return
    this.finishRestore()
    this.openingCancel?.()
    this.window = undefined
    clearTimeout(this.timer)
    ++this.generation
    this.snapshot = { ...emptyState(), error: 'Apple Music 应用内播放连接已断开，请重新连接' }
    if (!win.isDestroyed()) win.destroy()
  }

  private invalidateChrome(chrome: AppleMusicChromePage) {
    if (this.chrome !== chrome) return
    this.chrome = undefined
    clearTimeout(this.timer)
    ++this.generation
    this.snapshot = { ...emptyState(), error: 'Chrome Apple Music 播放连接已断开，请重新连接' }
    this.closing = Promise.all([this.closing, chrome.close()]).then(() => {})
  }

  async close() {
    const opening = this.opening
    this.opening = undefined
    const cancel = this.openingCancel
    this.openingCancel = undefined
    this.openingController?.abort()
    this.openingController = undefined
    cancel?.()
    this.closing = Promise.all([this.closing, this.closeWindow()]).then(() => {})
    await this.closing
    void opening?.catch(() => {})
  }

  async logout() {
    this.loggingOut = true
    this.suspended = false
    if (this.chrome?.isAlive()) {
      try { await this.chrome.unauthorize() } catch {}
    }
    await this.close()
    this.saveRestore(false)
    this.loggingOut = false
    if (!this.useChromeForDrm) await session.fromPartition(PLAYBACK_PARTITION).clearStorageData()
    // 退出登录可能换账号，地区提示跟着作废，下次登录仍由官网按出口 IP 决定。
    this.writeStorefront('')
  }
}

function isAppleUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname
    return hostname === 'apple.com' || hostname.endsWith('.apple.com')
  } catch { return false }
}

function isAllowedApplePermission(permission: string, requestingUrl: string): boolean {
  return ['mediaKeySystem', 'storage-access', 'top-level-storage-access'].includes(permission)
    && isAppleUrl(requestingUrl)
}

function chromeUserAgent(): string {
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}
