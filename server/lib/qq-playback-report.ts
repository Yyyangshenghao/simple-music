import { playbackAccountToken } from './playback-account'
import { parseCookieString, qqCookieUin, qqMusicRequest, QQ_HEADERS, requestText } from './qq-client'

const REPORT_URL = 'https://stat6.y.qq.com/pc/fcgi-bin/cgi_music_webreport.fcg'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

/** 使用官网播放器的 listenReport 通道；不伪造 Android 设备或播放日志。 */
export async function reportQQPlayback(
  cookie: string, mid: string, suppliedId: unknown, seconds: number, isCurrentAccount: () => boolean
): Promise<void> {
  const cookies = parseCookieString(cookie)
  const uin = qqCookieUin(cookies)
  if (!uin || uin === '0') throw new Error('AUTH_REQUIRED')
  let songId = String(suppliedId ?? '')
  if (!/^[1-9]\d*$/.test(songId)) {
    const detail = record(await qqMusicRequest(cookie, {
      comm: { ct: 24, cv: 0 },
      songinfo: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_mid: mid } },
    }))
    const info = record(detail.songinfo)
    const track = record(record(info.data).track_info)
    if (Number(info.code) !== 0 || String(track.mid ?? '') !== mid) throw new Error('SONG_ID_UNAVAILABLE')
    songId = String(track.id ?? '')
  }
  if (!/^[1-9]\d*$/.test(songId) || !isCurrentAccount()) throw new Error('ACCOUNT_CHANGED')
  const token = playbackAccountToken(cookie)!
  const guid = /^\d+$/.test(cookies.pgv_pvid ?? '') ? cookies.pgv_pvid
    : String(BigInt(`0x${token.slice(0,12)}`) % 10000000000n)
  const url = new URL(REPORT_URL)
  const fields = {
    Count: '1', Fqq: uin, Fguid: guid, Ffromtag1: '10050', Ffromtag2: songId,
    Fsong_id: songId, Fplay_time: String(seconds), Fstart_time: String(Math.floor(Date.now() / 1000)),
    Ftype: '3', Fversion: '1', Fid1: '0',
  }
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value)
  await requestText(url.toString(), { headers: { ...QQ_HEADERS, Cookie: cookie } })
}
