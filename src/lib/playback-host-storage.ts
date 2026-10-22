// 迁移只复制后台使用的存档；应用歌单、页面缓存等仍保留在原 UI 分区。
export const PLAYBACK_HOST_STORAGE_KEYS = [
  'simplemusic-settings', 'simplemusic-settings-v1-backup',
  'simplemusic-lyrics-source-v1',
  'simplemusic-provider-settings', 'simplemusic-content-provider', 'simplemusic-explore-provider',
  'simplemusic-playback', 'simplemusic-recent-plays', 'simplemusic-download-queue',
  'simplemusic-desktop-lyrics', 'simplemusic-shuange-profile-v1', 'simplemusic-shuange-candidate-cache-v1',
] as const
export const PLAYBACK_HOST_MIGRATION_KEY = 'simplemusic-playback-host-migrated-v1'
export const PLAYBACK_HOST_BACKUP_KEY = 'simplemusic-playback-host-backup-v1'

export function collectPlaybackStorage(storage: Pick<Storage, 'getItem'>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of PLAYBACK_HOST_STORAGE_KEYS) {
    const value = storage.getItem(key)
    if (value !== null) result[key] = value
  }
  return result
}

/** 原分区不删除、不回写；所有目标写入读回确认后才提交迁移标记。 */
export function migratePlaybackStorage(storage: Storage, source: Record<string, string>): void {
  if (storage.getItem(PLAYBACK_HOST_MIGRATION_KEY) === '1') return
  const entries = Object.entries(source)
  if (entries.some(([key, value]) => !(PLAYBACK_HOST_STORAGE_KEYS as readonly string[]).includes(key) || typeof value !== 'string')) {
    throw new Error('播放存档包含无效字段')
  }
  const keys = [...PLAYBACK_HOST_STORAGE_KEYS, PLAYBACK_HOST_BACKUP_KEY, PLAYBACK_HOST_MIGRATION_KEY]
  const previous = new Map(keys.map(key => [key, storage.getItem(key)]))
  try {
    // 原 UI 分区保留完整备份；这里只记来源，避免在同等配额的目标中双存整份队列。
    const backup = JSON.stringify({ schema: 1, source: 'original-ui-partition', keys: entries.map(([key]) => key) })
    storage.setItem(PLAYBACK_HOST_BACKUP_KEY, backup)
    if (storage.getItem(PLAYBACK_HOST_BACKUP_KEY) !== backup) throw new Error('播放存档备份失败')
    for (const key of PLAYBACK_HOST_STORAGE_KEYS) {
      if (source[key] === undefined) storage.removeItem(key)
      else storage.setItem(key, source[key])
      if (storage.getItem(key) !== (source[key] ?? null)) throw new Error('播放存档写入失败')
    }
    storage.setItem(PLAYBACK_HOST_MIGRATION_KEY, '1')
    if (storage.getItem(PLAYBACK_HOST_MIGRATION_KEY) !== '1') throw new Error('播放存档确认失败')
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key)
        else storage.setItem(key, value)
      } catch { /* 原 UI 分区始终保留，失败时不允许启动播放核心。 */ }
    }
    throw error
  }
}
