import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BACKGROUND_IMAGE_MAX_EDGE, customBackgroundPath, importCustomBackground, removeCustomBackground, resolveBackgroundSource, shrinkStoredBackgrounds } from './custom-background'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sm-bg-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

describe('自定义背景导入', () => {
  it('图片与视频按扩展名识别，其它格式拒绝', async () => {
    await expect(resolveBackgroundSource('/a/b/cover.PNG')).resolves.toMatchObject({ kind: 'image', name: 'cover.PNG' })
    await expect(resolveBackgroundSource('/a/b/clip.webm')).resolves.toMatchObject({ kind: 'video' })
    await expect(resolveBackgroundSource('/a/b/run.exe')).rejects.toThrow('UNSUPPORTED_FILE')
  })

  it('Wallpaper Engine 的 project.json 不再是可导入的背景文件', async () => {
    const dir = await tempDir()
    const project = join(dir, 'project.json')
    await writeFile(project, JSON.stringify({ type: 'video', file: 'loop.mp4', title: '雨夜' }))
    await expect(resolveBackgroundSource(project)).rejects.toThrow('UNSUPPORTED_FILE')
  })

  it('复制进 userData 后按 id 读取与删除，非法 id 不给路径', async () => {
    const source = await tempDir()
    const userData = await tempDir()
    await mkdir(join(source, 'we'))
    await writeFile(join(source, 'we', 'loop.mp4'), 'video')
    const media = await importCustomBackground(userData, join(source, 'we', 'loop.mp4'))
    expect(media).toMatchObject({ kind: 'video', name: 'loop.mp4' })
    expect(media.id).toMatch(/^[a-f0-9]{32}\.mp4$/)
    expect(await readdir(join(userData, 'backgrounds'))).toEqual([media.id])
    expect(customBackgroundPath(userData, '../api-token')).toBeNull()
    expect(customBackgroundPath(userData, `${'a'.repeat(32)}.json`)).toBeNull()
    await removeCustomBackground(userData, media.id)
    expect(await readdir(join(userData, 'backgrounds'))).toEqual([])
  })
  it('超大图片存缩小后的版本，缩图不处理或失败时复制原图', async () => {
    const source = await tempDir()
    const userData = await tempDir()
    await writeFile(join(source, 'huge.jpeg'), 'original')
    const edges: number[] = []
    const shrunk = await importCustomBackground(userData, join(source, 'huge.jpeg'), async (_path, maxEdge) => {
      edges.push(maxEdge)
      return Buffer.from('small')
    })
    expect(edges).toEqual([BACKGROUND_IMAGE_MAX_EDGE])
    expect(shrunk.id).toMatch(/^[a-f0-9]{32}\.jpeg$/)
    expect(String(await readFile(customBackgroundPath(userData, shrunk.id)!))).toBe('small')

    const kept = await importCustomBackground(userData, join(source, 'huge.jpeg'), async () => { throw new Error('decode') })
    expect(kept.id).toMatch(/\.jpeg$/)
    expect(String(await readFile(customBackgroundPath(userData, kept.id)!))).toBe('original')
  })

  it('视频不经过缩图', async () => {
    const source = await tempDir()
    const userData = await tempDir()
    await writeFile(join(source, 'loop.mp4'), 'video')
    let called = false
    await importCustomBackground(userData, join(source, 'loop.mp4'), async () => { called = true; return null })
    expect(called).toBe(false)
  })
  it('已存的超大背景原地缩小，id 不变，视频与无需缩小的图不动', async () => {
    const userData = await tempDir()
    const dir = join(userData, 'backgrounds')
    await mkdir(dir)
    const big = `${'a'.repeat(32)}.jpg`
    const small = `${'b'.repeat(32)}.png`
    const video = `${'c'.repeat(32)}.mp4`
    for (const id of [big, small, video]) await writeFile(join(dir, id), 'original')
    const seen: string[] = []
    await shrinkStoredBackgrounds(userData, async (path) => {
      seen.push(path)
      return path.endsWith(big) ? Buffer.from('small') : null
    })
    expect(seen.map(path => path.slice(-36)).sort()).toEqual([big, small])
    expect(String(await readFile(join(dir, big)))).toBe('small')
    expect(String(await readFile(join(dir, small)))).toBe('original')
    expect((await readdir(dir)).sort()).toEqual([big, small, video])
  })
})
