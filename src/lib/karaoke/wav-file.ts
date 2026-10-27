const DIRECTORY = 'karaoke-output'
const FILENAME = 'accompaniment.wav'

/** 独立分离进程一次只处理一首，私有目录中最多留一个临时 WAV；重启后先清理中断的任务。 */
export async function createTemporaryWav(): Promise<{ file: FileSystemFileHandle; writable: FileSystemWritableFileStream }> {
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(DIRECTORY, { create: true })
  await removeTemporaryWav()
  const file = await directory.getFileHandle(FILENAME, { create: true })
  return { file, writable: await file.createWritable() }
}

export async function removeTemporaryWav(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(DIRECTORY)
    await directory.removeEntry(FILENAME)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
}
