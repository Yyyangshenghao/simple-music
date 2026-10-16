import { parseCookieString, qqAuthComm, qqMusicRequest } from './qq-client'
import { qqWebMusicRequest } from './qq-web-request'

export const qqRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

/** 官网 Web 信封；业务码与 retCode 均成功才算写入被接受，调用方仍需读回。 */
export async function qqPlaylistRequest(cookie: string, module: string, method: string, param: Record<string, unknown>, write = false): Promise<Record<string, unknown>> {
  const auth = qqAuthComm(cookie)
  const cookies = parseCookieString(cookie)
  const token = (key: string) => {
    let hash = 5381
    for (const char of key) hash = (hash + (hash << 5) + char.charCodeAt(0)) | 0
    return hash & 0x7fffffff
  }
  const payload = {
    comm: { ...auth, ct: 24, cv: 4747474, platform: 'yqq.json', g_tk: token(cookies.skey || cookies.qqmusic_key || cookies.qm_keyst || ''),
      g_tk_new_20200303: token(cookies.qqmusic_key || cookies.p_skey || cookies.skey || cookies.p_lskey || cookies.lskey || cookies.qm_keyst || ''),
      inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1 },
    playlist: { module, method, param },
  }
  const signed = write && module === 'music.musicasset.PlaylistDetailWrite'
    && (method === 'AddSonglist' || method === 'DelSonglist') && param.dirId === 201
  const response = qqRecord(await (signed ? qqWebMusicRequest(cookie, payload) : qqMusicRequest(cookie, payload, { cookie: true })))
  const block = qqRecord(response.playlist)
  const data = qqRecord(block.data)
  const codes = [response.code, block.code, data.code ?? 0, data.subcode ?? 0,
    ...(write ? [data.retCode ?? (method === 'EditPlaylist' ? 0 : undefined)] : [])]
  if (codes.some(code => code === undefined || Number(code) !== 0)) {
    const code = codes.find(code => code === undefined || Number(code) !== 0)
    throw new Error(`QQ 音乐${write ? '拒绝写入' : '暂时无法读取歌单'}（${code ?? '响应不完整'}），请稍后重试`)
  }
  return data
}
