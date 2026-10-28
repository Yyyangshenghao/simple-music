import { app } from 'electron'
import { registerPlaybackHostIpc } from '../modules/playback-host'
import { registerWindowIpc } from './window'
import { registerLyricsIpc } from './lyrics'
import { registerWallpaperIpc } from './wallpaper'
import { registerMiniPlayerIpc } from './miniplayer'
import { registerLoginIpc } from './login'
import { registerMiscIpc } from './misc'
import { registerAppleAudioIpc } from './apple-audio'
import { registerGameModeIpc } from './game-mode'
import { registerBackgroundIpc } from './background'
import { registerDevMetricsIpc } from '../modules/dev-metrics'

export function registerIpc(): void {
  registerPlaybackHostIpc()
  registerWindowIpc()
  registerLyricsIpc()
  registerWallpaperIpc()
  registerMiniPlayerIpc()
  registerLoginIpc()
  registerMiscIpc()
  registerAppleAudioIpc()
  registerGameModeIpc()
  registerBackgroundIpc()
  // 资源监控只给开发模式用，打包版不暴露进程信息
  if (!app.isPackaged) registerDevMetricsIpc()
}
