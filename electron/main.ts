import { app } from 'electron'
import { isKaraokeHelperProcess, runKaraokeHelper } from './karaoke-helper'

const APP_NAME = 'Simple Music'
const APP_USER_MODEL_ID = 'com.simplemusic.desktop'

// Chromium 性能开关（ANGLE 后端按平台选择）。
// 不再全局禁用后台节流(disable-*-backgrounding 系列):窗口隐藏/被遮挡后接受 Chromium
// 默认的定时器节流与进程降权,降低后台内存与 CPU;音频走独立 media 管线不受影响。
// 播放宿主单独关闭后台节流，保证切歌与定时停止；游戏模式销毁主 UI。
// 壁纸窗口同设(overlay-manager,贴桌面底层被遮挡是常态)。
const performanceSwitches: Array<[string, string?]> = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-zero-copy'],
  // Chromium 磁盘缓存上限 50MB(主要缓存封面图;音频响应已 no-store)
  ['disk-cache-size', String(50 * 1024 * 1024)]
]
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : null
if (angle) performanceSwitches.push(['use-angle', angle])
for (const [name, value] of performanceSwitches) {
  if (value == null) app.commandLine.appendSwitch(name)
  else app.commandLine.appendSwitch(name, value)
}

app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)

// 分离实例只加载计算入口，避免同时初始化播放器、平台接口和内嵌服务的依赖。
if (isKaraokeHelperProcess()) runKaraokeHelper()
else void import('./application').catch(error => {
  console.error('Application startup failed:', error)
  app.exit(1)
})
