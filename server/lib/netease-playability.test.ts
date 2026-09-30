import { describe, expect, it } from 'vitest'
import { isNeteaseSongAvailable } from './netease-client'

describe('isNeteaseSongAvailable', () => {
  it('移除网易云明确标记为无版权的版本', () => {
    expect(isNeteaseSongAvailable({ st: -1, noCopyrightRcmd: { typeDesc: 'MV可播' } })).toBe(false)
    expect(isNeteaseSongAvailable({ st: 0, privilege: { st: -200 } })).toBe(false)
  })

  it('保留可播、VIP、付费和缺少版权字段的歌曲', () => {
    expect(isNeteaseSongAvailable({ st: 0, fee: 0, privilege: { st: 0 } })).toBe(true)
    expect(isNeteaseSongAvailable({ st: 0, fee: 1, privilege: { st: 0, fee: 1 } })).toBe(true)
    expect(isNeteaseSongAvailable({ st: 0, fee: 4, privilege: { st: 0, fee: 4 } })).toBe(true)
    expect(isNeteaseSongAvailable({ id: 1, name: '未知版权状态' })).toBe(true)
  })
})
