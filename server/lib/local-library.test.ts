import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join, sep } from 'node:path'
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
  it.each(['父目录', '子目录', '带分隔符的子目录'])('移除%s 时保留其他目录覆盖的曲目和封面', async (removed) => {
    const parent = await createFolder('music', 'first.mp3')
    const child = join(parent, 'album')
    await fsp.mkdir(child)
    await fsp.writeFile(join(child, 'second.mp3'), '')
    const registeredChild = removed === '带分隔符的子目录' ? child + sep : child
    const tracks = await addLocalFolder(directory, parent)
    await addLocalFolder(directory, registeredChild)
    const covers = join(directory, 'local-covers')
    await fsp.mkdir(covers)
    for (const track of tracks) await fsp.writeFile(join(covers, `${track.id}.img`), track.name)

    await removeLocalFolder(directory, removed === '父目录' ? parent : registeredChild)

    const kept = removed === '父目录' ? tracks.filter(track => track.path.startsWith(child + sep)) : tracks
    const library = await listLocalLibrary(directory)
    expect(library.folders).toEqual([removed === '父目录' ? registeredChild : parent])
    expect(library.tracks).toEqual(kept)
    for (const track of kept) {
      expect(await findLocalTrack(directory, track.id)).toEqual(track)
      expect(await fsp.readFile(join(covers, `${track.id}.img`), 'utf8')).toBe(track.name)
    }
    for (const track of tracks) expect((await fsp.stat(track.path)).isFile()).toBe(true)
    for (const track of tracks.filter(track => !kept.includes(track))) {
      await expect(fsp.stat(join(covers, `${track.id}.img`))).rejects.toMatchObject({ code: 'ENOENT' })
    }

    await removeLocalFolder(directory, library.folders[0])
    expect(await listLocalLibrary(directory)).toEqual({ folders: [], tracks: [] })
    for (const track of tracks) await expect(fsp.stat(join(covers, `${track.id}.img`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('带尾部分隔符的文件夹移除也清理其曲目', async () => {
    const folder = await createFolder('first', 'first.mp3') + sep
    await addLocalFolder(directory, folder)
    await removeLocalFolder(directory, folder)
    expect(await listLocalLibrary(directory)).toEqual({ folders: [], tracks: [] })
  })

  it('重扫移除已删除曲目与封面，保留其他文件夹和仍存在的曲目', async () => {
    const first = await createFolder('first', 'first.mp3')
    const second = await createFolder('second', 'second.mp3')
    await fsp.writeFile(join(first, 'second.mp3'), '')
    const tracks = await addLocalFolder(directory, first)
    await addLocalFolder(directory, second)
    const deleted = tracks.find((track) => track.path === join(first, 'first.mp3'))!
    const cover = join(directory, 'local-covers', `${deleted.id}.img`)
    await fsp.mkdir(join(directory, 'local-covers'))
    await fsp.writeFile(cover, 'cover')
    await fsp.rm(deleted.path)
    await addLocalFolder(directory, first)
    const library = await listLocalLibrary(directory)
    expect(library.folders).toEqual([first, second])
    expect(library.tracks.map((track) => track.path)).toEqual([join(first, 'second.mp3'), join(second, 'second.mp3')])
    expect(await findLocalTrack(directory, deleted.id)).toBeNull()
    await expect(fsp.stat(cover)).rejects.toMatchObject({ code: 'ENOENT' })
  })

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
