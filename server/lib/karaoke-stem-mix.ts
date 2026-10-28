import { promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import type { ServerResponse } from 'node:http'
import { parseByteRange } from './audio-cache'

const HEADER = 44
const BATCH_FRAMES = 16384

/** 只接受生成器写出的 44 字节头 16 bit 立体声 WAV；其它文件不拼接。 */
async function stereoFrames(path: string): Promise<{ frames: number; sampleRate: number } | null> {
  const handle = await fs.open(path, 'r').catch(() => null)
  if (!handle) return null
  try {
    const head = Buffer.alloc(HEADER)
    const [{ bytesRead }, stat] = await Promise.all([handle.read(head, 0, HEADER, 0), handle.stat()])
    if (bytesRead < HEADER || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE'
      || head.readUInt16LE(20) !== 1 || head.readUInt16LE(22) !== 2 || head.readUInt16LE(34) !== 16
      || head.toString('latin1', 36, 40) !== 'data') return null
    return { frames: Math.floor((stat.size - HEADER) / 4), sampleRate: head.readUInt32LE(24) }
  } finally { await handle.close() }
}

function quadHeader(frames: number, sampleRate: number): Buffer {
  const head = Buffer.alloc(HEADER)
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(36 + frames * 8, 4); head.write('WAVE', 8, 'latin1'); head.write('fmt ', 12, 'latin1')
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(4, 22); head.writeUInt32LE(sampleRate, 24)
  head.writeUInt32LE(sampleRate * 8, 28); head.writeUInt16LE(8, 32); head.writeUInt16LE(16, 34); head.write('data', 36, 'latin1')
  head.writeUInt32LE(frames * 8, 40)
  return head
}

/**
 * 按字节区间生成 4 声道 WAV：1、2 声道是伴奏，3、4 声道是人声侧轨。
 * 两份文件逐样本交织，播放端用一个媒体元素即可保证对齐，混回比例在 Web Audio 中实时调节。
 */
async function* quadBytes(accompaniment: string, vocals: string, header: Buffer, start: number, end: number): AsyncGenerator<Buffer> {
  if (start < HEADER) yield header.subarray(start, Math.min(HEADER, end + 1))
  if (end < HEADER) return
  const [acc, voc] = await Promise.all([fs.open(accompaniment, 'r'), fs.open(vocals, 'r')])
  try {
    const first = Math.floor(Math.max(0, start - HEADER) / 8)
    const last = Math.floor((end - HEADER) / 8)
    const a = Buffer.alloc(BATCH_FRAMES * 4)
    const v = Buffer.alloc(BATCH_FRAMES * 4)
    for (let frame = first; frame <= last; frame += BATCH_FRAMES) {
      const count = Math.min(BATCH_FRAMES, last - frame + 1)
      await Promise.all([acc.read(a, 0, count * 4, HEADER + frame * 4), voc.read(v, 0, count * 4, HEADER + frame * 4)])
      const out = Buffer.alloc(count * 8)
      for (let i = 0; i < count; i++) {
        a.copy(out, i * 8, i * 4, i * 4 + 4)
        v.copy(out, i * 8 + 4, i * 4, i * 4 + 4)
      }
      const from = Math.max(start, HEADER + frame * 8) - (HEADER + frame * 8)
      const to = Math.min(end + 1, HEADER + (frame + count) * 8) - (HEADER + frame * 8)
      yield out.subarray(from, to)
    }
  } finally { await Promise.all([acc.close(), voc.close()]) }
}

/**
 * 伴奏带人声侧轨时返回拼接流；格式不符或长度不一致时返回 false，由调用方按普通伴奏服务。
 */
export async function serveStemMix(res: ServerResponse, accompaniment: string, vocals: string, range: string): Promise<boolean> {
  const [acc, voc] = await Promise.all([stereoFrames(accompaniment), stereoFrames(vocals)])
  if (!acc || !voc || acc.frames !== voc.frames || acc.sampleRate !== voc.sampleRate) return false
  const size = HEADER + acc.frames * 8
  const base: Record<string, string> = {
    'Content-Type': 'audio/wav', 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
  }
  const parsed = range ? parseByteRange(range, size) : null
  if (range && !parsed) {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` })
    res.end()
    return true
  }
  const start = parsed?.start ?? 0
  const end = parsed?.end ?? size - 1
  res.writeHead(parsed ? 206 : 200, {
    ...base, 'Content-Length': String(end - start + 1), ...(parsed ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  })
  const stream = Readable.from(quadBytes(accompaniment, vocals, quadHeader(acc.frames, acc.sampleRate), start, end))
  stream.once('error', () => res.destroy())
  res.once('close', () => stream.destroy())
  stream.pipe(res)
  return true
}
