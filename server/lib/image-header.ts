// 只读文件头判断 JPEG/PNG 的尺寸与 EXIF 方向，不解码整张图。
// 背景缩图据此决定是否需要解码：小图直接跳过，带旋转方向的照片保留原图（重新编码会丢掉方向）。

export interface ImageHeader {
  width: number
  height: number
  /** EXIF Orientation，1 为正常；PNG 与无 EXIF 的 JPEG 为 1 */
  orientation: number
}

/** 读文件头时取的字节数；EXIF 缩略图通常在 64KB 内，超出仍找不到尺寸就当作认不出。 */
export const IMAGE_HEADER_BYTES = 512 * 1024

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function readImageHeader(buf: Buffer): ImageHeader | null {
  if (buf.length >= 24 && PNG_SIGNATURE.every((b, i) => buf[i] === b) && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), orientation: 1 }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return readJpegHeader(buf)
  return null
}

function readJpegHeader(buf: Buffer): ImageHeader | null {
  let orientation = 1
  let pos = 2
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return null
    const marker = buf[pos + 1]
    // 填充字节与无长度的独立标记
    if (marker === 0xff) { pos += 1; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { pos += 2; continue }
    if (marker === 0xd9 || marker === 0xda) return null
    const length = buf.readUInt16BE(pos + 2)
    if (length < 2) return null
    const start = pos + 4
    const end = pos + 2 + length
    if (marker === 0xe1 && end <= buf.length && buf.toString('latin1', start, start + 6) === 'Exif\0\0') {
      orientation = exifOrientation(buf.subarray(start + 6, end)) ?? orientation
    }
    // SOF0–SOF15（除 DHT/JPG/DAC）：精度 1 字节后是高、宽
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (start + 5 > buf.length) return null
      return { height: buf.readUInt16BE(start + 1), width: buf.readUInt16BE(start + 3), orientation }
    }
    pos = end
  }
  return null
}

function exifOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null
  const order = tiff.toString('latin1', 0, 2)
  if (order !== 'II' && order !== 'MM') return null
  const le = order === 'II'
  const u16 = (at: number) => (le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
  const u32 = (at: number) => (le ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return null
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) return null
    if (u16(entry) === 0x0112) return u16(entry + 8)
  }
  return null
}
