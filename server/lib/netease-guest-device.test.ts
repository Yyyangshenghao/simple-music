import { describe, expect, it } from 'vitest'
import { withGuestDevice } from './netease-client'

describe('网易云游客设备字段', () => {
  it('游客请求每次带相同的设备字段', () => {
    const first = withGuestDevice({ cookie: '' }).cookie as string
    expect(first).toMatch(/_ntes_nuid=[0-9a-f]{32}/)
    expect(first).toMatch(/deviceId=[0-9A-F]{32}/)
    expect(first).toMatch(/WNMCID=[a-z]{6}\.\d+\.01\.0/)
    expect(withGuestDevice({ cookie: '' }).cookie).toBe(first)
    expect(withGuestDevice({ id: 1 }).cookie).toMatchObject({ deviceId: expect.stringMatching(/^[0-9A-F]{32}$/) })
  })

  it('保留已有字段，不重复追加', () => {
    const cookie = withGuestDevice({ cookie: 'NMTID=abc; _ntes_nuid=mine' }).cookie as string
    expect(cookie.startsWith('NMTID=abc; _ntes_nuid=mine')).toBe(true)
    expect(cookie.match(/_ntes_nuid=/g)).toHaveLength(1)
    expect(withGuestDevice({ cookie: { WNMCID: 'mine' } }).cookie).toMatchObject({ WNMCID: 'mine', deviceId: expect.any(String) })
  })

  it('已登录账号的请求保持原样', () => {
    const params = { cookie: 'MUSIC_U=secret; os=pc' }
    expect(withGuestDevice(params)).toBe(params)
    const objectParams = { cookie: { MUSIC_U: 'secret' } }
    expect(withGuestDevice(objectParams)).toBe(objectParams)
  })
})
