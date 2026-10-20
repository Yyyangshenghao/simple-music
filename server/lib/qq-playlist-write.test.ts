import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ plain: vi.fn(), signed: vi.fn() }))
vi.mock('./qq-client', async original => ({ ...await original<typeof import('./qq-client')>(), qqMusicRequest: h.plain }))
vi.mock('./qq-web-request', () => ({ qqWebMusicRequest: h.signed }))
import { qqPlaylistRequest } from './qq-playlist-write'
const success = { code: 0, playlist: { code: 0, data: { retCode: 0 } } }
beforeEach(() => { vi.resetAllMocks(); h.plain.mockResolvedValue(success); h.signed.mockResolvedValue(success) })
it.each(['AddSonglist', 'DelSonglist'])('201目录%s使用官网签名加密通道，不在失败后重发明文', async method => {
  h.plain.mockResolvedValue({ code: 0, playlist: { code: 80105, data: { retCode: 0 } } })
  await expect(qqPlaylistRequest('uin=7; qqmusic_key=fixture', 'music.musicasset.PlaylistDetailWrite', method, { dirId: 201, v_songInfo: [{ songId: 1, songType: 0 }] }, true)).resolves.toEqual({ retCode: 0 })
  expect(h.signed).toHaveBeenCalledTimes(1)
  expect(h.plain).not.toHaveBeenCalled()
  h.signed.mockRejectedValueOnce(new Error('timeout'))
  await expect(qqPlaylistRequest('cookie', 'music.musicasset.PlaylistDetailWrite', method, { dirId: 201 }, true)).rejects.toThrow('timeout')
  expect(h.signed).toHaveBeenCalledTimes(2)
  expect(h.plain).not.toHaveBeenCalled()
})
it('普通歌单写入和收藏状态读取沿用已验证通道', async () => {
  await qqPlaylistRequest('cookie', 'music.musicasset.PlaylistDetailWrite', 'AddSonglist', { dirId: 5 }, true)
  await qqPlaylistRequest('cookie', 'music.musicasset.SongFavRead', 'IsSongFanByMid', { v_songMid: ['mid1'] })
  expect(h.plain).toHaveBeenCalledTimes(2)
  expect(h.signed).not.toHaveBeenCalled()
})
it.each([
  { code: 80105, playlist: { code: 0, data: { retCode: 0 } } },
  { code: 0, playlist: { code: 80105, data: { retCode: 0 } } },
  { code: 0, playlist: { code: 0, data: { retCode: 80105 } } },
  { code: 0, playlist: { code: 0, data: {} } },
])('签名解码后仍逐层核对业务码，不能假成功 %j', async response => {
  h.signed.mockResolvedValue(response)
  await expect(qqPlaylistRequest('cookie', 'music.musicasset.PlaylistDetailWrite', 'AddSonglist', { dirId: 201 }, true)).rejects.toThrow('QQ 音乐拒绝写入')
})
