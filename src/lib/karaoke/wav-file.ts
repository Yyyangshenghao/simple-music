const DIRECTORY = 'karaoke-output'
const FILENAME = 'accompaniment.wav'
/** 人声侧轨与伴奏同一次生成，私有目录中各留一份。 */
export const VOCALS_FILENAME = 'vocals.wav'

/** 独立分离进程一次只处理一首，私有目录中最多留一个临时伴奏；重启后先清理中断的任务。 */
export async function createTemporaryWav(name = FILENAME): Promise<{ file: FileSystemFileHandle; writable: FileSystemWritableFileStream }> {
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(DIRECTORY, { create: true })
  await removeEntry(directory, name)
  const file = await directory.getFileHandle(name, { create: true })
  return { file, writable: await file.createWritable() }
}

async function removeEntry(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await directory.removeEntry(name)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
}

export async function removeTemporaryWav(): Promise<void> {
  let directory: FileSystemDirectoryHandle
  try {
    const root = await navigator.storage.getDirectory()
    directory = await root.getDirectoryHandle(DIRECTORY)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return
    throw error
  }
  await removeEntry(directory, FILENAME)
  await removeEntry(directory, VOCALS_FILENAME)
}
