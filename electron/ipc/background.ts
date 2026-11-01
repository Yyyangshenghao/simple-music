import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { app, dialog, ipcMain, nativeImage } from 'electron'
import { getMainWindow } from '../modules/window-manager'
import {
  CUSTOM_BACKGROUND_EXTENSIONS,
  CustomBackgroundError,
  importCustomBackground,
  shrinkStoredBackgrounds,
  type BackgroundImageShrinker,
  removeCustomBackground
} from '../../server/lib/custom-background'
import { IMAGE_HEADER_BYTES, readImageHeader, type ImageHeader } from '../../server/lib/image-header'
import type { BackgroundImportResult, OkResult } from '../../src/types/ipc'

async function readHeader(sourcePath: string): Promise<ImageHeader | null> {
  const file = await open(sourcePath, 'r')
  try {
    const buf = Buffer.alloc(IMAGE_HEADER_BYTES)
    const { bytesRead } = await file.read(buf, 0, buf.length, 0)
    return readImageHeader(buf.subarray(0, bytesRead))
  } finally {
    await file.close()
  }
}

/** 静态 JPEG/PNG 超过长边上限时按比例缩小；GIF 可能是动图、WebP/AVIF 解码支持不稳，都保留原图。
 *  先读文件头：不超上限就不解码（启动时每张已存背景都会过一遍）；带 EXIF 旋转的照片保留原图，
 *  nativeImage 不按方向摆正且重新编码会丢掉 EXIF，缩完会横过来。认不出文件头同样保留原图。 */
export const shrinkBackgroundImage: BackgroundImageShrinker = async (sourcePath, maxEdge) => {
  const ext = extname(sourcePath).toLowerCase()
  if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') return null
  const header = await readHeader(sourcePath)
  if (!header || header.orientation !== 1 || Math.max(header.width, header.height) <= maxEdge) return null
  const image = nativeImage.createFromPath(sourcePath)
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  if (Math.max(width, height) <= maxEdge) return null
  const resized = width >= height
    ? image.resize({ width: maxEdge, quality: 'best' })
    : image.resize({ height: maxEdge, quality: 'best' })
  return ext === '.png' ? resized.toPNG() : resized.toJPEG(92)
}

/** 自定义背景：路径只在主进程内经系统对话框取得，渲染层拿到的是复制后的 id。 */
export function registerBackgroundIpc(): void {
  void app.whenReady()
    .then(() => shrinkStoredBackgrounds(app.getPath('userData'), shrinkBackgroundImage))
    .catch(() => { /* 缩不了就继续用原图 */ })

  ipcMain.handle('background:import', async (): Promise<BackgroundImportResult> => {
    try {
      const owner = getMainWindow() ?? undefined
      const result = await dialog.showOpenDialog(owner!, {
        title: '选择背景图片或视频',
        properties: ['openFile'],
        filters: [{ name: '图片或视频', extensions: CUSTOM_BACKGROUND_EXTENSIONS }]
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
      return { ok: true, media: await importCustomBackground(app.getPath('userData'), result.filePaths[0], shrinkBackgroundImage) }
    } catch (e) {
      return { ok: false, error: e instanceof CustomBackgroundError ? e.message : 'IMPORT_FAILED' }
    }
  })

  ipcMain.handle('background:remove', async (_e, arg: { id?: unknown }): Promise<OkResult> => {
    if (typeof arg?.id !== 'string') return { ok: false, error: 'INVALID_ID' }
    try {
      await removeCustomBackground(app.getPath('userData'), arg.id)
      return { ok: true }
    } catch {
      return { ok: false, error: 'REMOVE_FAILED' }
    }
  })
}
