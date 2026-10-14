import { migratePlaybackStorage, PLAYBACK_HOST_MIGRATION_KEY } from './lib/playback-host-storage'
import type { PlaybackRequest } from './types/ipc'

const desktop = window.desktop!
let runtime: Promise<typeof import('./lib/playback-host-runtime')> | undefined

function ensureRuntime(storage?: Record<string, string>) {
  if (!runtime) {
    if (localStorage.getItem(PLAYBACK_HOST_MIGRATION_KEY) !== '1') {
      if (!storage) throw new Error('等待播放存档迁移')
      try { migratePlaybackStorage(localStorage, storage) }
      catch { throw new Error('播放存档迁移失败，原数据已保留，请检查可用空间后重试') }
    }
    // 有些 store 在模块装配时读取存档；必须在迁移确认后才加载。
    runtime = import('./lib/playback-host-runtime').then(module => {
      module.startPlaybackHost()
      return module
    })
  }
  return runtime
}

desktop.onPlaybackCommand(({ id, request }) => {
  void (async () => {
    const command = request as PlaybackRequest
    const host = await ensureRuntime(command.type === 'connect' ? command.storage : undefined)
    return host.handlePlaybackRequest(command)
  })().then(value => desktop.playbackReply(id, { value }), error => {
    desktop.playbackReply(id, { error: error instanceof Error ? error.message : '播放命令执行失败' })
  })
})

if (localStorage.getItem(PLAYBACK_HOST_MIGRATION_KEY) === '1') {
  void ensureRuntime().catch(error => desktop.publishPlayback({ type: 'host-error', error: String(error) }))
}
