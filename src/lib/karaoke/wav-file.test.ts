import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTemporaryWav, removeTemporaryWav } from './wav-file'

afterEach(() => vi.unstubAllGlobals())

function storage() {
  const writable = { write: vi.fn(), close: vi.fn(), abort: vi.fn() }
  const file = { createWritable: vi.fn(async () => writable) }
  const directory = { removeEntry: vi.fn(async (_name: string) => {}), getFileHandle: vi.fn(async (_name: string, _options: unknown) => file) }
  const root = { getDirectoryHandle: vi.fn(async (_name: string, _options?: unknown) => directory) }
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn(async () => root) } })
  return { root, directory, file, writable }
}

describe('伴奏临时文件', () => {
  it('先删除上次中断留下的文件，再创建本次输出', async () => {
    const { directory, file, writable } = storage()
    expect(await createTemporaryWav()).toEqual({ file, writable })
    expect(directory.removeEntry).toHaveBeenCalledWith('accompaniment.wav')
    expect(directory.getFileHandle).toHaveBeenCalledWith('accompaniment.wav', { create: true })
    expect(directory.removeEntry.mock.invocationCallOrder[0]).toBeLessThan(directory.getFileHandle.mock.invocationCallOrder[0])
    await removeTemporaryWav()
    expect(directory.removeEntry).toHaveBeenCalledTimes(2)
  })

  it('没有历史文件时正常创建；清理不存在的目录也不报错', async () => {
    const { directory, root } = storage()
    directory.removeEntry.mockRejectedValueOnce(new DOMException('Missing', 'NotFoundError'))
    await createTemporaryWav()
    root.getDirectoryHandle.mockRejectedValueOnce(new DOMException('Missing', 'NotFoundError'))
    await expect(removeTemporaryWav()).resolves.toBeUndefined()
  })

  it('空间或访问错误会传给调用方，避免静默改回内存输出', async () => {
    const { root, file } = storage()
    file.createWritable.mockRejectedValueOnce(new DOMException('Disk full', 'QuotaExceededError'))
    await expect(createTemporaryWav()).rejects.toMatchObject({ name: 'QuotaExceededError' })
    root.getDirectoryHandle.mockRejectedValueOnce(new DOMException('Denied', 'SecurityError'))
    await expect(removeTemporaryWav()).rejects.toMatchObject({ name: 'SecurityError' })
  })
})
