import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  KugouAuthError,
  checkKugouQr,
  clearKugouSession,
  createKugouMid,
  fetchKugouAccountUrls,
  isKugouCollectionId,
  kugouRsaRaw,
  kugouUrlKey,
  mapKugouCollectionSong,
  mapKugouUserPlaylist,
  readKugouSession,
  signKugouAndroid,
  signKugouWeb,
  writeKugouSession,
  type KugouSession,
} from './kugou-account'

const HASH = 'd46ef1ab32284c61733d77baa7fc3ee8'
const session: KugouSession = { token: 't'.repeat(64), userid: '451777357', mid: '331480298828794757756124475206432551890', dfid: '-' }
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = '' })

describe('酷狗账号签名', () => {
  it('安卓签名按参数名排序并把请求体拼在盐之间', () => {
    // 与 KuGouMusicApi signatureAndroidParams 同算法：md5(salt + 排序后 k=v + body + salt)
    expect(signKugouAndroid({ b: 2, a: 1 }, '{"x":1}')).toBe(signKugouAndroid({ a: 1, b: 2 }, '{"x":1}'))
    expect(signKugouAndroid({ a: 1 })).not.toBe(signKugouAndroid({ a: 1 }, 'x'))
    expect(signKugouWeb({ b: 2, a: 1 })).toMatch(/^[0-9a-f]{32}$/)
  })

  it('MID 是十进制大整数，播放 key 绑定 mid 与 userid', () => {
    expect(createKugouMid()).toMatch(/^\d{10,48}$/)
    expect(kugouUrlKey(HASH, session.mid, session.userid)).not.toBe(kugouUrlKey(HASH, session.mid, 0))
  })

  it('资料接口的 RSA 是 1024 位无填充密文', () => {
    expect(kugouRsaRaw({ token: session.token, clienttime: 1 })).toMatch(/^[0-9a-f]{256}$/)
  })
})

describe('酷狗会话存储', () => {
  it('写入后可读回，文件只给当前用户读写；清除后为空', () => {
    dir = mkdtempSync(join(tmpdir(), 'kugou-account-'))
    writeKugouSession(dir, { ...session, nickname: 'A.M' })
    expect(readKugouSession(dir)).toMatchObject({ ...session, nickname: 'A.M' })
    if (process.platform !== 'win32') expect(statSync(join(dir, 'kugou-account.json')).mode & 0o077).toBe(0)
    clearKugouSession(dir)
    expect(readKugouSession(dir)).toBeNull()
  })

  it('缺 token 或 mid 非法时视为未登录', () => {
    dir = mkdtempSync(join(tmpdir(), 'kugou-account-'))
    writeKugouSession(dir, { ...session, mid: '../x' })
    expect(readKugouSession(dir)).toBeNull()
  })
})

describe('酷狗扫码状态', () => {
  it('状态码映射；确认时带回 token 与资料', async () => {
    const reply = (data: Record<string, unknown>) => vi.fn(async () => json({ status: 1, error_code: 0, data }))
    expect(await checkKugouQr('k'.repeat(36), session.mid, reply({ status: 1 }))).toEqual({ status: 'waiting' })
    expect(await checkKugouQr('k'.repeat(36), session.mid, reply({ status: 2 }))).toEqual({ status: 'scanned' })
    expect(await checkKugouQr('k'.repeat(36), session.mid, reply({ status: 0 }))).toEqual({ status: 'expired' })
    expect(await checkKugouQr('k'.repeat(36), session.mid, reply({ status: 4, token: 'abc', userid: 451777357, nickname: 'A.M', pic: 'http://imge.kugou.com/a.jpg' })))
      .toEqual({ status: 'confirmed', token: 'abc', userid: '451777357', nickname: 'A.M', avatar: 'https://imge.kugou.com/a.jpg' })
  })
})

describe('酷狗账号歌单映射', () => {
  it('collection id 才算账号歌单；我喜欢标记 specialType=5', () => {
    expect(isKugouCollectionId('collection_3_451777357_2_0')).toBe(true)
    expect(isKugouCollectionId('3136952023')).toBe(false)
    expect(mapKugouUserPlaylist({ global_collection_id: 'collection_3_451777357_2_0', name: '我喜欢', is_def: 2, count: 3, list_create_userid: 451777357 }, session.userid))
      .toMatchObject({ id: 'collection_3_451777357_2_0', specialType: 5, trackCount: 3, subscribed: false })
    expect(mapKugouUserPlaylist({ global_collection_id: 'collection_3_1_9_0', name: '别人的', list_create_userid: 1 }, session.userid))
      .toMatchObject({ subscribed: true })
  })

  it('歌单曲目：时长为毫秒，各档 hash 取自 relate_goods', () => {
    const track = mapKugouCollectionSong({
      hash: HASH.toUpperCase(), name: '绵阳STAR、7opy - 死疙瘩', timelen: 135262, privilege: 5, add_mixsongid: 599822201,
      albuminfo: { name: '死疙瘩', id: 83683620 },
      singerinfo: [{ id: 12224698, name: '绵阳STAR' }, { id: 12708977, name: '7opy' }],
      relate_goods: [{ hash: HASH.toUpperCase(), level: 2 }, { hash: 'EF21E1C708138F742FDD45154324ABC2', level: 4 }],
      trans_param: { union_cover: 'http://imge.kugou.com/stdmusic/{size}/a.jpg' },
    })
    expect(track).toMatchObject({
      id: HASH, name: '死疙瘩', artist: '绵阳STAR / 7opy', album: '死疙瘩', albumId: '83683620', albumAudioId: '599822201',
      duration: 135262, hash320: 'ef21e1c708138f742fdd45154324abc2', cover: 'https://imge.kugou.com/stdmusic/480/a.jpg',
    })
  })
})

describe('酷狗账号播放地址', () => {
  it('从请求档位逐档向下，最多两档', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input)
      expect(url.searchParams.get('key')).toBe(kugouUrlKey(HASH, session.mid, session.userid))
      const quality = url.searchParams.get('quality')
      return quality === 'flac' ? json({ status: 2 }) : json({ status: 1, url: [`http://fs.kugou.com/${quality}.mp3`] })
    })
    const urls = await fetchKugouAccountUrls(session, { hash: HASH, quality: 'lossless' }, fetchImpl)
    expect(urls.map((item) => item.level)).toEqual(['exhigh', 'standard'])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('token 失效抛 KugouAuthError，无权益返回空', async () => {
    await expect(fetchKugouAccountUrls(session, { hash: HASH, quality: 'standard' }, vi.fn(async () => json({ status: 0, error_code: 20018 }))))
      .rejects.toBeInstanceOf(KugouAuthError)
    expect(await fetchKugouAccountUrls(session, { hash: HASH, quality: 'standard' }, vi.fn(async () => json({ status: 2 })))).toEqual([])
  })
})
