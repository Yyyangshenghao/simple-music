import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accompanimentFile, deleteAccompaniment, readKaraokeLibrary, saveAccompaniment, setKaraokeDirectory } from './karaoke-library'
import { clearKaraokeStems, karaokeModelInfo, uninstallKaraokeModel, writeKaraokeStem } from './karaoke-store'
import { karaokeResources } from './karaoke-resources'
import type { Track } from '../../src/types/domain'

const roots: string[] = []
const temp = async () => { const root = await mkdtemp(join(tmpdir(), 'accompaniment-')); roots.push(root); return root }
const track: Track = { provider: 'netease', source: 'netease', type: 'song', id: '1', name: '曲名/不能作路径', artist: '歌手', artists: [], duration: 180000 }
async function stem(root: string, model: 'hq3' | 'kara2' = 'hq3') {
  const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8)
  await writeKaraokeStem(root, model, 'netease:1', (async function* () { yield wav })())
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('用户伴奏文件库', () => {
  it('不同平台原曲共用实际音源时分别保存，重试仍复用各自成品', async () => {
    const root = await temp()
    const directory = join(root, 'chosen')
    await setKaraokeDirectory(root, directory)
    await stem(root)
    const first = await saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track, directory })
    const other: Track = { ...track, provider: 'qq', source: 'qq', id: 'qq-song' }
    await stem(root)
    const second = await saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track: other, directory })
    expect(second.id).not.toBe(first.id)
    expect(second.track).toMatchObject({ source: 'qq', id: 'qq-song' })
    expect((await readKaraokeLibrary(root)).items).toHaveLength(2)
    expect((await saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track: other, directory })).id).toBe(second.id)
  })

  it('同曲不同模型分别保存，同模型复用；清缓存或卸载不影响用户文件', async () => {
    const root = await temp()
    const directory = join(root, 'chosen')
    await setKaraokeDirectory(root, directory)
    await stem(root)
    await stem(root, 'kara2')
    const first = await saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track, directory })
    const second = await saveAccompaniment(root, { model: 'kara2', key: 'netease:1', track, directory })
    expect(first.id).not.toBe(second.id)
    expect((await saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track, directory })).fileName).toBe(first.fileName)
    await clearKaraokeStems(root)
    await uninstallKaraokeModel(root, karaokeModelInfo('hq3')!)
    expect((await readKaraokeLibrary(root)).items).toHaveLength(2)
    expect(await readFile((await accompanimentFile(root, first.id))!.path)).toHaveLength(48)
  })

  it('修改目录保留旧文件索引，删除只作用于指定版本', async () => {
    const root = await temp()
    const old = join(root, 'old'), next = join(root, 'new')
    await setKaraokeDirectory(root, old)
    await stem(root)
    const first = await saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track, directory: old })
    await setKaraokeDirectory(root, next)
    await stem(root, 'kara2')
    const second = await saveAccompaniment(root, { model: 'kara2', key: 'netease:1', track, directory: next })
    expect((await readKaraokeLibrary(root)).items).toHaveLength(2)
    await expect(deleteAccompaniment(root, first.id, first.generatedAt - 1)).rejects.toThrow('已更新')
    await deleteAccompaniment(root, first.id, first.generatedAt)
    expect((await readKaraokeLibrary(root)).items.map(item => item.id)).toEqual([second.id])
  })

  it('便携文件夹整体移动后用相对文件名恢复，文件丢失保留记录', async () => {
    const root = await temp()
    const directory = join(root, 'portable', 'Accompaniments')
    await readKaraokeLibrary(root, directory)
    await stem(root)
    const item = await saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track, directory })
    const next = join(root, 'moved')
    await rename(join(root, 'portable'), next)
    const moved = join(next, 'Accompaniments')
    const library = await readKaraokeLibrary(root, moved)
    expect(library.items[0]).toMatchObject({ id: item.id, available: true, directory: moved })
    await rm(join(moved, item.fileName))
    expect((await readKaraokeLibrary(root, moved)).items[0].available).toBe(false)
  })

  it('损坏索引拒绝写入且不覆盖原记录，路径不能借文件名逃逸', async () => {
    const root = await temp()
    const directory = join(root, 'chosen')
    await setKaraokeDirectory(root, directory)
    const path = join(directory, '.simplemusic-accompaniments.json')
    await writeFile(path, 'broken')
    await stem(root)
    await expect(saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track, directory })).rejects.toThrow('索引读取失败')
    expect(await readFile(path, 'utf8')).toBe('broken')
    expect(await accompanimentFile(root, '../../outside')).toBeNull()
  })

  it('复制便携目录后只管理新位置，不删除旧副本或让删除记录复活', async () => {
    const root = await temp()
    const old = join(root, 'portable-old', 'Accompaniments')
    await readKaraokeLibrary(root, old)
    await stem(root)
    const item = await saveAccompaniment(root, { model: 'hq3', key: 'netease:1', track, directory: old })
    const next = join(root, 'portable-copy', 'Accompaniments')
    await cp(old, next, { recursive: true })
    expect((await readKaraokeLibrary(root, next)).items[0].directory).toBe(next)
    await deleteAccompaniment(root, item.id, item.generatedAt, next)
    expect((await readKaraokeLibrary(root, next)).items).toEqual([])
    expect(await readFile(join(old, item.fileName))).toHaveLength(48)
  })

  it('内存预算考虑模型和音频长度，并为其他应用保留余量', () => {
    const memory = { total: 16 * 1024 ** 3, free: 3 * 1024 ** 3 }
    expect(karaokeResources('hq3', 180000, memory).canStart).toBe(false)
    expect(karaokeResources('hq3-fp16', 180000, memory).requiredBytes).toBeLessThan(karaokeResources('hq3', 180000, memory).requiredBytes)
    expect(karaokeResources('hq3', 1800000, memory).requiredBytes).toBeGreaterThan(karaokeResources('hq3', 180000, memory).requiredBytes)
  })

  it('仅首次默认位置不可写时回退，自选目录失败不改变现有配置', async () => {
    const root = await temp()
    const invalid = join(root, 'not-a-directory')
    await writeFile(invalid, '保留用户文件')
    const fallback = join(root, 'Music', 'Accompaniments')
    expect(await readKaraokeLibrary(root, invalid, fallback)).toMatchObject({ directory: fallback, directoryNotice: expect.stringContaining('不可写') })
    await expect(setKaraokeDirectory(root, invalid)).rejects.toThrow()
    expect((await readKaraokeLibrary(root)).directory).toBe(fallback)
    expect(await readFile(invalid, 'utf8')).toBe('保留用户文件')
  })
})
