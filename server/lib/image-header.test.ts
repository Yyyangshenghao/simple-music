import { describe, expect, it } from 'vitest'
import { readImageHeader } from './image-header'

function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'latin1')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

function segment(marker: number, body: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head[0] = 0xff
  head[1] = marker
  head.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([head, body])
}

function exif(orientation: number, littleEndian: boolean): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4)
  tiff.write(littleEndian ? 'II' : 'MM', 0, 'latin1')
  const u16 = (v: number, at: number) => (littleEndian ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at))
  const u32 = (v: number, at: number) => (littleEndian ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at))
  u16(42, 2)
  u32(8, 4)
  u16(1, 8)
  u16(0x0112, 10)
  u16(3, 12)
  u32(1, 14)
  u16(orientation, 18)
  return segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]))
}

function jpeg(width: number, height: number, ...segments: Buffer[]): Buffer {
  const sof = Buffer.alloc(6)
  sof[0] = 8
  sof.writeUInt16BE(height, 1)
  sof.writeUInt16BE(width, 3)
  sof[5] = 3
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, segment(0xc0, sof), Buffer.from([0xff, 0xda])])
}

describe('readImageHeader', () => {
  it('读出 PNG 尺寸', () => {
    expect(readImageHeader(png(10000, 5625))).toEqual({ width: 10000, height: 5625, orientation: 1 })
  })

  it('读出 JPEG 尺寸，没有 EXIF 时方向为 1', () => {
    expect(readImageHeader(jpeg(4032, 3024, segment(0xe0, Buffer.from('JFIF\0', 'latin1'))))).toEqual({ width: 4032, height: 3024, orientation: 1 })
  })

  it('读出两种字节序的 EXIF 方向', () => {
    expect(readImageHeader(jpeg(4032, 3024, exif(6, true)))?.orientation).toBe(6)
    expect(readImageHeader(jpeg(4032, 3024, exif(8, false)))?.orientation).toBe(8)
  })

  it('截断或认不出的文件返回 null', () => {
    expect(readImageHeader(jpeg(4032, 3024, exif(6, true)).subarray(0, 20))).toBeNull()
    expect(readImageHeader(Buffer.from('GIF89a'))).toBeNull()
    expect(readImageHeader(Buffer.alloc(0))).toBeNull()
  })
})
