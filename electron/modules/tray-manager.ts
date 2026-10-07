import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { returnFromMiniPlayer, triggerMiniPlayerControl } from './overlay-manager'
import { getGameMode, setGameMode, onGameModeChange } from './game-mode'
import type { OkResult, TrayPlaybackState } from '../../src/types/ipc'

let tray: Tray | null = null
let stopGameModeSync: (() => void) | undefined
let playback: TrayPlaybackState = {
  title: '', artist: '', playing: false, hasTrack: false, canSkip: false, volume: 1, desktopLyrics: false
}
let previousVolume = 1

function showPlayer(): void {
  const mode = getGameMode()
  if (mode.enabled) setGameMode({ ...mode, enabled: false }, false)
  returnFromMiniPlayer()
}

function control(action: string, value?: number): void {
  // macOS 不支持顶层菜单项禁用，点击时也检查是否可播放。
  if (!playback.hasTrack || ((action === 'prev' || action === 'next') && !playback.canSkip)) return
  triggerMiniPlayerControl(action, value)
}

function refreshMenu(): void {
  if (!tray || tray.isDestroyed()) return
  const mode = getGameMode()
  const track = playback.hasTrack ? [playback.title, playback.artist].filter(Boolean).join(' · ') : '暂无播放歌曲'
  tray.setToolTip(`Simple Music${mode.enabled ? ' · 游戏模式' : ''}\n${track}`)
  const menu = Menu.buildFromTemplate([
    { label: track.replace(/&/g, '&&'), enabled: false },
    { type: 'separator' },
    { label: playback.playing ? '暂停' : '播放', enabled: playback.hasTrack, click: () => control('play-pause') },
    { label: '上一首', enabled: playback.canSkip, click: () => control('prev') },
    { label: '下一首', enabled: playback.canSkip, click: () => control('next') },
    { label: '音量', submenu: [
      { label: playback.volume === 0 ? '取消静音' : '静音', enabled: playback.hasTrack,
        click: () => control('volume', playback.volume === 0 ? previousVolume : 0) },
      { label: '增大音量', enabled: playback.hasTrack, click: () => control('volume-up') },
      { label: '减小音量', enabled: playback.hasTrack, click: () => control('volume-down') }
    ] },
    { type: 'separator' },
    { label: '游戏模式', type: 'checkbox', checked: mode.enabled,
      click: () => setGameMode({ ...getGameMode(), enabled: !getGameMode().enabled }) },
    { label: '桌面歌词', type: 'checkbox', checked: playback.desktopLyrics,
      click: () => triggerMiniPlayerControl('desktop-lyrics') },
    { label: '显示主窗口', click: showPlayer },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

/** 只在曲目、播放状态或控制设置变化时更新，不订阅高频进度。 */
export function updateTrayPlayback(value: TrayPlaybackState): OkResult {
  const next: TrayPlaybackState = {
    title: typeof value?.title === 'string' ? value.title.slice(0, 160) : '',
    artist: typeof value?.artist === 'string' ? value.artist.slice(0, 160) : '',
    playing: !!value?.playing, hasTrack: !!value?.hasTrack, canSkip: !!value?.canSkip,
    volume: Number.isFinite(value?.volume) ? Math.max(0, Math.min(1, value.volume)) : 1,
    desktopLyrics: !!value?.desktopLyrics
  }
  if (Object.keys(next).every(key => next[key as keyof TrayPlaybackState] === playback[key as keyof TrayPlaybackState])) return { ok: true }
  playback = next
  if (next.volume > 0) previousVolume = next.volume
  refreshMenu()
  return { ok: true }
}

/**
 * 托盘图标。build/icon.png 经 package.json build.files 打进 asar 根，
 * dev 下相对 out/main 回到仓库根，两种环境同一相对路径可用。
 */
function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromPath(join(import.meta.dirname, '../../build/icon.png'))
  if (img.isEmpty()) return img
  const size = process.platform === 'darwin' ? 18 : 16
  return img.resize({ width: size, height: size })
}

export function createTray(): void {
  if (tray && !tray.isDestroyed()) return
  tray = new Tray(trayImage())
  refreshMenu()
  stopGameModeSync = onGameModeChange(refreshMenu)
  // macOS 单击用于打开菜单，避免操作播放菜单时唤醒主窗口。
  if (process.platform !== 'darwin') tray.on('click', showPlayer)
  tray.on('double-click', showPlayer)
}

export function destroyTray(): void {
  stopGameModeSync?.()
  stopGameModeSync = undefined
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
