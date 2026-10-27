import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  KARAOKE_MODELS,
  clearKaraokeStems,
  enforceKaraokeStemLimit,
  ensureKaraokeModel,
  findKaraokeStem,
  karaokeModelFile,
  karaokeModelInfo,
  karaokeModelStatus,
  karaokeModelViews,
  karaokeStemPath,
  uninstallKaraokeModel,
  writeKaraokeStem,
  type KaraokeModelInfo,
} from './karaoke-store'

const wavBytes = (size: number) => {
  const buf = Buffer.alloc(size)
  buf.write('RIFF', 0, 'latin1')
  buf.write('WAVE', 8, 'latin1')
  return buf
}
async function* chunks(...parts: Buffer[]) { for (const part of parts) yield part }
const tmp = () => mkdtemp(join(tmpdir(), 'karaoke-'))
const fakeModel = (bytes: Buffer): KaraokeModelInfo => ({
  ...karaokeModelInfo('kara2')!, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
})
const waitFor = async (check: () => Promise<boolean>) => { for (let i = 0; i < 100 && !(await check()); i++) await new Promise(r => setTimeout(r, 10)) }

describe('AI K 歌存储', () => {
  it('目录表 id 唯一、参数合法，fp16 模型标为需要 shader-f16', async () => {
    expect(new Set(KARAOKE_MODELS.map(model => model.id)).size).toBe(KARAOKE_MODELS.length)
    for (const model of KARAOKE_MODELS) {
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(model.params.dimF).toBeLessThanOrEqual(model.params.nFft / 2)
    }
    const views = await karaokeModelViews(await tmp())
    expect(views.find(view => view.id === 'hq3-fp16')).toMatchObject({ requiresF16: true, state: 'missing' })
    expect(views.find(view => view.id === 'hq3')).toMatchObject({ requiresF16: false, stemCount: 0 })
  })

  it('伴奏按模型分开存，校验 WAV 头后落盘并可读回', async () => {
    const dir = await tmp()
    const bytes = wavBytes(64)
    expect(await writeKaraokeStem(dir, 'hq3', 'netease:1', chunks(bytes.subarray(0, 5), bytes.subarray(5)))).toBe(64)
    expect(karaokeStemPath(dir, 'hq3', 'netease:1')).not.toContain('netease')
    expect(await findKaraokeStem(dir, 'hq3', 'netease:1')).toMatchObject({ size: 64 })
    expect(await findKaraokeStem(dir, 'kara2', 'netease:1')).toBeNull()
    expect((await karaokeModelViews(dir)).find(view => view.id === 'hq3')).toMatchObject({ stemBytes: 64, stemCount: 1 })
  })

  it('人声侧轨与伴奏成对计数、计入占用并一起淘汰', async () => {
    const dir = await tmp()
    await writeKaraokeStem(dir, 'hq3', 'netease:1', chunks(wavBytes(64)), undefined, 'vocals')
    // 侧轨先到、伴奏未到时是残留，单独占一项，也会被清理
    expect((await karaokeModelViews(dir)).find(view => view.id === 'hq3')).toMatchObject({ stemBytes: 64, stemCount: 1 })
    await writeKaraokeStem(dir, 'hq3', 'netease:1', chunks(wavBytes(64)))
    expect(await findKaraokeStem(dir, 'hq3', 'netease:1', 'vocals')).toMatchObject({ size: 64 })
    expect((await karaokeModelViews(dir)).find(view => view.id === 'hq3')).toMatchObject({ stemBytes: 128, stemCount: 1 })
    await enforceKaraokeStemLimit(dir, 0)
    expect(await findKaraokeStem(dir, 'hq3', 'netease:1')).toBeNull()
    expect(await findKaraokeStem(dir, 'hq3', 'netease:1', 'vocals')).toBeNull()
  })

  it('非 WAV 内容拒收且不留临时文件', async () => {
    const dir = await tmp()
    await expect(writeKaraokeStem(dir, 'hq3', 'qq:1', chunks(Buffer.from('<html>not audio</html>')))).rejects.toThrow('WAV')
    expect(await readdir(join(dir, 'karaoke', 'stems', 'hq3'))).toEqual([])
  })

  it('所有模型的伴奏合计超限时先删最久未用的，刚写入的保留', async () => {
    const dir = await tmp()
    for (const [model, key, age] of [['hq3', 'local:old', 300], ['kara2', 'local:mid', 200]] as const) {
      await mkdir(join(dir, 'karaoke', 'stems', model), { recursive: true })
      await writeFile(karaokeStemPath(dir, model, key), wavBytes(100))
      const t = new Date(Date.now() - age * 1000)
      await utimes(karaokeStemPath(dir, model, key), t, t)
    }
    await writeKaraokeStem(dir, 'hq3', 'local:new', chunks(wavBytes(100)), 250)
    expect(await findKaraokeStem(dir, 'hq3', 'local:old')).toBeNull()
    expect(await findKaraokeStem(dir, 'kara2', 'local:mid')).not.toBeNull()
    expect(await findKaraokeStem(dir, 'hq3', 'local:new')).not.toBeNull()
    await clearKaraokeStems(dir, 'kara2')
    expect(await findKaraokeStem(dir, 'kara2', 'local:mid')).toBeNull()
    expect(await findKaraokeStem(dir, 'hq3', 'local:new')).not.toBeNull()
    await enforceKaraokeStemLimit(dir, 0)
    expect(await findKaraokeStem(dir, 'hq3', 'local:new')).toBeNull()
  })

  it('旧版布局（根目录 HQ3 模型、平铺伴奏）迁移到新目录', async () => {
    const dir = await tmp()
    const hq3 = karaokeModelInfo('hq3')!
    await mkdir(join(dir, 'karaoke', 'stems'), { recursive: true })
    await writeFile(join(dir, 'karaoke', hq3.fileName), Buffer.alloc(hq3.bytes))
    const legacyStem = `${createHash('sha1').update('netease:9').digest('hex')}.wav`
    await writeFile(join(dir, 'karaoke', 'stems', legacyStem), wavBytes(80))
    expect((await karaokeModelStatus(dir, hq3)).state).toBe('ready')
    expect(await karaokeModelFile(dir, hq3)).toMatchObject({ path: join(dir, 'karaoke', 'models', hq3.fileName) })
    expect(await findKaraokeStem(dir, 'hq3', 'netease:9')).toMatchObject({ size: 80 })
  })

  it('模型校验失败时报错并允许重试，下载中重复调用不重复请求', async () => {
    const dir = await tmp()
    const model = karaokeModelInfo('kara2')!
    let calls = 0
    const fetcher = async () => { calls++; return new Response(new Uint8Array([1, 2, 3])) }
    expect((await ensureKaraokeModel(dir, model, fetcher)).state).toBe('downloading')
    expect((await ensureKaraokeModel(dir, model, fetcher)).state).toBe('downloading')
    await waitFor(async () => (await karaokeModelStatus(dir, model)).state !== 'downloading')
    expect(await karaokeModelStatus(dir, model)).toMatchObject({ state: 'error', error: '模型校验失败，请重试' })
    expect(calls).toBe(1)
    expect(await readdir(join(dir, 'karaoke', 'models'))).not.toContain(`${model.fileName}.part`)
    expect((await ensureKaraokeModel(dir, model, fetcher)).state).toBe('downloading')
    await waitFor(async () => calls >= 2)
    expect(calls).toBe(2)
  })

  it('下载完成后可读取；卸载删除模型与它的伴奏，不影响其他模型', async () => {
    const dir = await tmp()
    const bytes = Buffer.from('model-bytes')
    const model = fakeModel(bytes)
    await ensureKaraokeModel(dir, model, async () => new Response(bytes))
    await waitFor(async () => (await karaokeModelStatus(dir, model)).state === 'ready')
    expect(await karaokeModelFile(dir, model)).not.toBeNull()
    await writeKaraokeStem(dir, 'kara2', 'local:1', chunks(wavBytes(40)))
    await writeKaraokeStem(dir, 'hq3', 'local:1', chunks(wavBytes(40)))
    await uninstallKaraokeModel(dir, model)
    expect((await karaokeModelStatus(dir, model)).state).toBe('missing')
    expect(await findKaraokeStem(dir, 'kara2', 'local:1')).toBeNull()
    expect(await findKaraokeStem(dir, 'hq3', 'local:1')).not.toBeNull()
  })

  it('下载中卸载会中止下载并回到未安装', async () => {
    const dir = await tmp()
    const model = karaokeModelInfo('kara2')!
    let started = false
    let aborted = false
    const fetcher = (_url: string, signal: AbortSignal) => new Promise<Response>((_resolve, reject) => {
      started = true
      signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')) })
    })
    expect((await ensureKaraokeModel(dir, model, fetcher)).state).toBe('downloading')
    await waitFor(async () => started)
    await uninstallKaraokeModel(dir, model)
    expect(aborted).toBe(true)
    expect((await karaokeModelStatus(dir, model)).state).toBe('missing')
  })
})
