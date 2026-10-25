import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearWallpaperEngineCache,
  getWallpaperEngineLibrary,
  getWallpaperEngineProject,
  parseLibraryFoldersVdf,
  resolveWallpaperVideoFile,
  resolveWallpaperWebFile,
  resolveWorkshopContentDir,
  setWallpaperEngineRoot
} from './wallpaper-engine'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sm-we-'))
  dirs.push(dir)
  return dir
}

beforeEach(() => clearWallpaperEngineCache())
afterEach(async () => {
  clearWallpaperEngineCache()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function writeProject(contentDir: string, id: string, project: unknown, files: Record<string, string> = {}): Promise<void> {
  const dir = join(contentDir, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'project.json'), typeof project === 'string' ? project : JSON.stringify(project))
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true })
    await writeFile(join(dir, name), content)
  }
}

/** 造一个标准 Steam 目录：steamapps/workshop/content/431960/<id>/。 */
async function steamFixture(): Promise<{ root: string; content: string }> {
  const root = await tempDir()
  const content = join(root, 'steamapps', 'workshop', 'content', '431960')
  await mkdir(content, { recursive: true })
  await writeProject(content, '111', { type: 'Video', file: 'wallpaper.mp4', title: '雨夜', preview: 'preview.jpg' }, {
    'wallpaper.mp4': 'video',
    'preview.jpg': 'image'
  })
  await writeProject(content, '222', { type: 'web', file: 'index.html', title: '网页壁纸' }, {
    'index.html': '<html><head></head><body>web</body></html>',
    'assets/style.css': 'body{}'
  })
  await writeProject(content, '333', { type: 'scene', file: 'scene.pkg', title: '场景壁纸', preview: 'preview.png' }, {
    'scene.pkg': 'pkg',
    'preview.png': 'image'
  })
  await writeProject(content, '444', '{broken', {})
  // 入口越界的工程不应出现在列表里。
  await writeProject(content, '555', { type: 'video', file: '../111/wallpaper.mp4', title: '越界' }, {})
  // 没有 preview 字段也没有 preview.* 文件时仍可列出，只是没有缩略图。
  await writeProject(content, '666', { type: 'video', file: 'loop.webm', title: '无封面' }, { 'loop.webm': 'video' })
  return { root, content }
}

describe('Wallpaper Engine 壁纸库', () => {
  it('解析新版与旧版 libraryfolders.vdf', () => {
    expect(parseLibraryFoldersVdf(String.raw`"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}`)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])

    expect(parseLibraryFoldersVdf('"LibraryFolders"\n{\n\t"TimeNextStatsReport"\t\t"1700000000"\n\t"1"\t\t"E:\\\\Games\\\\Steam"\n}'))
      .toEqual(['E:\\Games\\Steam'])
  })

  it('Steam 根目录、content 目录与 431960 目录都能归一成壁纸目录', async () => {
    const { root, content } = await steamFixture()
    await expect(resolveWorkshopContentDir(root)).resolves.toBe(content)
    await expect(resolveWorkshopContentDir(join(root, 'steamapps'))).resolves.toBe(content)
    await expect(resolveWorkshopContentDir(join(root, 'steamapps', 'workshop', 'content'))).resolves.toBe(content)
    await expect(resolveWorkshopContentDir(content)).resolves.toBe(content)
    await expect(resolveWorkshopContentDir(join(root, 'empty'))).resolves.toBeNull()
  })

  it('只列出可用的工程，读取标题、类型与预览图', async () => {
    const { root } = await steamFixture()
    const library = await getWallpaperEngineLibrary(await tempDir(), { roots: [root] })
    expect(library.roots).toBe(1)
    expect(library.customRoot).toBeNull()
    const byId = Object.fromEntries(library.wallpapers.map(item => [item.id, item]))
    expect(byId['111']).toEqual({ id: '111', title: '雨夜', type: 'video', hasPreview: true })
    expect(byId['222']).toEqual({ id: '222', title: '网页壁纸', type: 'web', hasPreview: false })
    expect(byId['333']).toMatchObject({ title: '场景壁纸', type: 'scene', hasPreview: true })
    expect(byId['666']).toMatchObject({ type: 'video', hasPreview: false })
    expect(byId['444']).toBeUndefined()
    expect(byId['555']).toBeUndefined()
  })

  it('按 id 取入口文件，网页资源不允许越出工程目录', async () => {
    const { root, content } = await steamFixture()
    const userData = await tempDir()
    const video = await getWallpaperEngineProject(userData, '111', { roots: [root] })
    expect(resolveWallpaperVideoFile(video!)).toBe(join(content, '111', 'wallpaper.mp4'))
    expect(resolveWallpaperVideoFile((await getWallpaperEngineProject(userData, '222', { roots: [root] }))!)).toBeNull()

    const web = await getWallpaperEngineProject(userData, '222', { roots: [root] })
    expect(resolveWallpaperWebFile(web!, '')).toBe(join(content, '222', 'index.html'))
    expect(resolveWallpaperWebFile(web!, 'assets/style.css')).toBe(join(content, '222', 'assets', 'style.css'))
    expect(resolveWallpaperWebFile(web!, '../111/wallpaper.mp4')).toBeNull()
    await expect(getWallpaperEngineProject(userData, '../111', { roots: [root] })).resolves.toBeNull()
    await expect(getWallpaperEngineProject(userData, '999', { roots: [root] })).resolves.toBeNull()
  })

  it('手动目录优先于自动检测，可恢复自动检测；无效目录报错', async () => {
    const { root } = await steamFixture()
    const customRoot = await tempDir()
    const customContent = join(customRoot, '431960')
    await mkdir(customContent, { recursive: true })
    await writeProject(customContent, '999', { type: 'video', file: 'a.mp4', title: '手动库' }, { 'a.mp4': 'video' })
    const userData = await tempDir()

    const manual = await setWallpaperEngineRoot(userData, customRoot)
    expect(manual.customRoot).toBe(customRoot)
    expect(manual.wallpapers.map(item => item.id)).toEqual(['999'])

    await expect(setWallpaperEngineRoot(userData, join(customRoot, 'missing'))).rejects.toThrow('WALLPAPER_DIR_INVALID')

    const cleared = await setWallpaperEngineRoot(userData, null, { roots: [root] })
    expect(cleared.customRoot).toBeNull()
    expect(cleared.wallpapers.map(item => item.id).sort()).toEqual(['111', '222', '333', '666'])
  })
})
