import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { customBackgroundPath, importCustomBackground, removeCustomBackground, resolveBackgroundSource } from './custom-background'

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

  it('Wallpaper Engine 视频工程取 file 与标题；场景/网页工程与越界路径拒绝', async () => {
    const dir = await tempDir()
    const project = join(dir, 'project.json')
    await writeFile(project, JSON.stringify({ type: 'Video', file: 'loop.mp4', title: '雨夜' }))
    await expect(resolveBackgroundSource(project)).resolves.toEqual({ sourcePath: join(dir, 'loop.mp4'), kind: 'video', name: '雨夜' })
    await writeFile(project, JSON.stringify({ type: 'scene', file: 'scene.pkg' }))
    await expect(resolveBackgroundSource(project)).rejects.toThrow('WE_UNSUPPORTED_TYPE:scene')
    await writeFile(project, JSON.stringify({ type: 'video', file: '../outside.mp4' }))
    await expect(resolveBackgroundSource(project)).rejects.toThrow('WE_PROJECT_INVALID')
    await writeFile(project, '{broken')
    await expect(resolveBackgroundSource(project)).rejects.toThrow('WE_PROJECT_INVALID')
  })

  it('复制进 userData 后按 id 读取与删除，非法 id 不给路径', async () => {
    const source = await tempDir()
    const userData = await tempDir()
    await mkdir(join(source, 'we'))
    await writeFile(join(source, 'we', 'loop.mp4'), 'video')
    await writeFile(join(source, 'we', 'project.json'), JSON.stringify({ type: 'video', file: 'loop.mp4' }))
    const media = await importCustomBackground(userData, join(source, 'we', 'project.json'))
    expect(media).toMatchObject({ kind: 'video', name: 'loop.mp4' })
    expect(media.id).toMatch(/^[a-f0-9]{32}\.mp4$/)
    expect(await readdir(join(userData, 'backgrounds'))).toEqual([media.id])
    expect(customBackgroundPath(userData, '../api-token')).toBeNull()
    expect(customBackgroundPath(userData, `${'a'.repeat(32)}.json`)).toBeNull()
    await removeCustomBackground(userData, media.id)
    expect(await readdir(join(userData, 'backgrounds'))).toEqual([])
  })
})
