import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  KARAOKE_MODEL,
  enforceKaraokeStemLimit,
  ensureKaraokeModel,
  findKaraokeStem,
  karaokeModelStatus,
  karaokeStemPath,
  writeKaraokeStem,
} from './karaoke-store'

const wavBytes = (size: number) => {
  const buf = Buffer.alloc(size)
  buf.write('RIFF', 0, 'latin1')
  buf.write('WAVE', 8, 'latin1')
  return buf
}
async function* chunks(...parts: Buffer[]) { for (const part of parts) yield part }

describe('AI K 歌存储', () => {
  it('伴奏校验 WAV 头后落盘，按 key 摘要命名并可读回', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'karaoke-'))
    const bytes = wavBytes(64)
    expect(await writeKaraokeStem(dir, 'netease:1', chunks(bytes.subarray(0, 5), bytes.subarray(5)))).toBe(64)
    expect(karaokeStemPath(dir, 'netease:1')).not.toContain('netease')
    expect(await findKaraokeStem(dir, 'netease:1')).toMatchObject({ size: 64 })
    expect(await findKaraokeStem(dir, 'netease:2')).toBeNull()
  })

  it('非 WAV 内容拒收且不留临时文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'karaoke-'))
    await expect(writeKaraokeStem(dir, 'qq:1', chunks(Buffer.from('<html>not audio</html>')))).rejects.toThrow('WAV')
    expect(await readdir(join(dir, 'karaoke', 'stems'))).toEqual([])
  })

  it('超过上限时先删最久未用的伴奏，刚写入的保留', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'karaoke-'))
    await mkdir(join(dir, 'karaoke', 'stems'), { recursive: true })
    for (const [key, age] of [['local:old', 300], ['local:mid', 200]] as const) {
      await writeFile(karaokeStemPath(dir, key), wavBytes(100))
      const t = new Date(Date.now() - age * 1000)
      await utimes(karaokeStemPath(dir, key), t, t)
    }
    await writeKaraokeStem(dir, 'local:new', chunks(wavBytes(100)), 250)
    expect(await findKaraokeStem(dir, 'local:old')).toBeNull()
    expect(await findKaraokeStem(dir, 'local:mid')).not.toBeNull()
    expect(await findKaraokeStem(dir, 'local:new')).not.toBeNull()
    await enforceKaraokeStemLimit(dir, 0)
    expect(await readdir(join(dir, 'karaoke', 'stems'))).toEqual([])
  })

  it('模型摘要不符时报错并允许重试，下载中重复调用不重复请求', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'karaoke-'))
    let calls = 0
    const fetcher = async () => { calls++; return new Response(new Uint8Array([1, 2, 3])) }
    expect((await ensureKaraokeModel(dir, fetcher)).state).toBe('downloading')
    expect((await ensureKaraokeModel(dir, fetcher)).state).toBe('downloading')
    for (let i = 0; i < 50 && (await karaokeModelStatus(dir)).state === 'downloading'; i++) await new Promise(r => setTimeout(r, 10))
    expect(await karaokeModelStatus(dir)).toMatchObject({ state: 'error', error: '模型校验失败，请重试' })
    expect(calls).toBe(1)
    expect(await readdir(join(dir, 'karaoke'))).not.toContain(`${KARAOKE_MODEL.fileName}.part`)
    expect((await ensureKaraokeModel(dir, fetcher)).state).toBe('downloading')
    for (let i = 0; i < 50 && calls < 2; i++) await new Promise(r => setTimeout(r, 10))
    expect(calls).toBe(2)
  })
})
