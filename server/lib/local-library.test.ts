import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { addLocalFolder, findLocalTrack, listLocalLibrary, removeLocalFolder } from './local-library'

vi.mock('music-metadata', () => ({
  parseFile: vi.fn(async (path: string) => ({
    common: { title: path.endsWith('second.mp3') ? 'Second' : 'First', artist: 'Artist' },
    format: { duration: 1 },
  })),
}))

let directory: string

beforeEach(async () => {
  directory = await fsp.mkdtemp(join(tmpdir(), 'simplemusic-local-library-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsp.rm(directory, { recursive: true, force: true })
})

async function seedLibrary(userDataDir: string, name = 'First'): Promise<void> {
  await fsp.mkdir(userDataDir, { recursive: true })
  await fsp.writeFile(join(userDataDir, 'local-library.json'), JSON.stringify({
    folders: ['/music'],
    tracks: [{ id: 'track', path: '/music/song.mp3', name, artist: 'Artist', hasCover: false, mtimeMs: 1 }],
  }))
}

async function createFolder(name: string, fileName: string): Promise<string> {
  const folder = join(directory, name)
  await fsp.mkdir(folder)
  await fsp.writeFile(join(folder, fileName), '')
  return folder
}

describe('本地音乐索引快照', () => {
  it('合并同目录并发读取，后续音频和封面查找不重复解析索引', async () => {
    await seedLibrary(directory)
    const readFile = vi.spyOn(fsp, 'readFile')
    const records = await Promise.all(Array.from({ length: 20 }, () => findLocalTrack(directory, 'track')))
    expect(records.every((record) => record?.name === 'First')).toBe(true)
    await findLocalTrack(directory, 'track')
    await listLocalLibrary(directory)
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('不同目录中的同名 ID 不串库，返回值修改不污染缓存', async () => {
    const second = join(directory, 'other')
    await seedLibrary(directory)
    await seedLibrary(second, 'Second')
    const first = await findLocalTrack(directory, 'track')
    first!.name = 'Changed'
    const listed = await listLocalLibrary(directory)
    listed.folders.length = 0
    listed.tracks[0].name = 'Changed again'
    expect(await findLocalTrack(directory, 'track')).toMatchObject({ name: 'First' })
    expect(await findLocalTrack(second, 'track')).toMatchObject({ name: 'Second' })
    expect((await listLocalLibrary(directory)).folders).toEqual(['/music'])
  })

  it('外部替换或删除索引后不会继续返回旧曲目', async () => {
    await seedLibrary(directory)
    await findLocalTrack(directory, 'track')
    const replacement = join(directory, 'replacement.json')
    await fsp.writeFile(replacement, JSON.stringify({ folders: [], tracks: [] }))
    await fsp.rename(replacement, join(directory, 'local-library.json'))
    expect(await findLocalTrack(directory, 'track')).toBeNull()
    await fsp.rm(join(directory, 'local-library.json'))
    expect(await listLocalLibrary(directory)).toEqual({ folders: [], tracks: [] })
  })

  it('仅保留最近 4 个目录，淘汰后重新读取磁盘', async () => {
    const libraries = Array.from({ length: 5 }, (_, i) => join(directory, String(i)))
    for (const library of libraries) await seedLibrary(library)
    const readFile = vi.spyOn(fsp, 'readFile')
    for (const library of libraries) await findLocalTrack(library, 'track')
    await findLocalTrack(libraries[0], 'track')
    expect(readFile).toHaveBeenCalledTimes(6)
  })

  it('并发扫描串行合并，缓存读取立即看到两个目录的提交结果', async () => {
    const first = await createFolder('first', 'first.mp3')
    const second = await createFolder('second', 'second.mp3')
    await listLocalLibrary(directory)
    await Promise.all([addLocalFolder(directory, first), addLocalFolder(directory, second)])
    const index = await listLocalLibrary(directory)
    expect(index.folders).toEqual([first, second])
    expect(index.tracks.map((track) => track.name)).toEqual(['First', 'Second'])
    for (const track of index.tracks) expect(await findLocalTrack(directory, track.id)).toEqual(track)
  })

  it('扫描与删除按调用顺序提交，删除后索引和封面不残留', async () => {
    const folder = await createFolder('first', 'first.mp3')
    const tracks = await addLocalFolder(directory, folder)
    await findLocalTrack(directory, tracks[0].id)
    const covers = join(directory, 'local-covers')
    await fsp.mkdir(covers)
    const cover = join(covers, `${tracks[0].id}.img`)
    await fsp.writeFile(cover, 'cover')
    await Promise.all([addLocalFolder(directory, folder), removeLocalFolder(directory, folder)])
    expect(await findLocalTrack(directory, tracks[0].id)).toBeNull()
    expect(await listLocalLibrary(directory)).toEqual({ folders: [], tracks: [] })
    await expect(fsp.stat(cover)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
