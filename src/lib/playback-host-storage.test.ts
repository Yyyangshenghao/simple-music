import { describe, expect, it } from 'vitest'
import { collectPlaybackStorage, migratePlaybackStorage, PLAYBACK_HOST_BACKUP_KEY, PLAYBACK_HOST_MIGRATION_KEY } from './playback-host-storage'

function memoryStorage() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
  } as Storage
}

describe('后台存档迁移', () => {
  it('仅复制运行时存档，原分区始终保留', () => {
    const source = memoryStorage()
    source.setItem('simplemusic-playback', '{"position":12}')
    source.setItem('simplemusic-app-playlists', '用户收藏')
    source.setItem('simplemusic-shuange-candidate-cache-v1', '候选池')
    const target = memoryStorage()
    const archive = collectPlaybackStorage(source)
    migratePlaybackStorage(target, archive)
    expect(target.getItem('simplemusic-playback')).toBe('{"position":12}')
    expect(target.getItem('simplemusic-app-playlists')).toBeNull()
    expect(target.getItem('simplemusic-shuange-candidate-cache-v1')).toBe('候选池')
    expect(JSON.parse(target.getItem(PLAYBACK_HOST_BACKUP_KEY)!)).toEqual({ schema: 1, source: 'original-ui-partition', keys: Object.keys(archive) })
    expect(target.getItem(PLAYBACK_HOST_MIGRATION_KEY)).toBe('1')
    expect(source.getItem('simplemusic-playback')).toBe('{"position":12}')
  })

  it('重连不以旧UI存档覆盖后台已经写入的进度', () => {
    const target = memoryStorage()
    migratePlaybackStorage(target, { 'simplemusic-playback': '旧值' })
    target.setItem('simplemusic-playback', '新值')
    migratePlaybackStorage(target, { 'simplemusic-playback': '旧值' })
    expect(target.getItem('simplemusic-playback')).toBe('新值')
  })

  it('写入失败不提交标记，回滚目标数据并允许重试', () => {
    const target = memoryStorage()
    target.setItem('simplemusic-settings', '目标旧值')
    const write = target.setItem
    target.setItem = (key, value) => {
      if (key === 'simplemusic-playback') throw new Error('quota')
      write(key, value)
    }
    expect(() => migratePlaybackStorage(target, { 'simplemusic-settings': '新值', 'simplemusic-playback': '队列' })).toThrow('quota')
    expect(target.getItem(PLAYBACK_HOST_MIGRATION_KEY)).toBeNull()
    expect(target.getItem('simplemusic-settings')).toBe('目标旧值')
    target.setItem = write
    migratePlaybackStorage(target, { 'simplemusic-playback': '队列' })
    expect(target.getItem(PLAYBACK_HOST_MIGRATION_KEY)).toBe('1')
  })

  it('拒绝未知存档字段且不进入迁移', () => {
    const target = memoryStorage()
    expect(() => migratePlaybackStorage(target, { credentials: 'secret' })).toThrow('无效字段')
    expect(target.getItem(PLAYBACK_HOST_BACKUP_KEY)).toBeNull()
  })
})
