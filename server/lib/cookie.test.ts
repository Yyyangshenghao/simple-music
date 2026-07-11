import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCookie, getCookie, clearCookie, getBeatmapCacheDir } from './cookie'

const ctx = { userDataDir: mkdtempSync(join(tmpdir(), 'mr-')), port: 0 }

describe('cookie store', () => {
  it('roundtrips a cookie', () => {
    setCookie(ctx, 'netease', 'MUSIC_U=abc')
    expect(getCookie(ctx, 'netease')).toBe('MUSIC_U=abc')
  })

  it('isolates sources', () => {
    setCookie(ctx, 'qq', 'uin=123')
    expect(getCookie(ctx, 'netease')).toBe('MUSIC_U=abc')
    expect(getCookie(ctx, 'qq')).toBe('uin=123')
  })

  it('clears a cookie', () => {
    clearCookie(ctx, 'netease')
    expect(getCookie(ctx, 'netease')).toBe('')
  })
})

describe('beatmap cache dir', () => {
  it('lives under userData and is not the hardcoded D: path', () => {
    delete process.env.SIMPLEMUSIC_BEAT_CACHE_DIR
    const dir = getBeatmapCacheDir(ctx)
    expect(dir.startsWith(ctx.userDataDir)).toBe(true)
    expect(dir).not.toContain('MineradioCache')
  })
})
