import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ServerResponse } from 'node:http'
import { serveStemMix } from './karaoke-stem-mix'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

const sample = (base: number, i: number) => (base + i) % 30000

function wav(frames: number, base: number, channels = 2): Buffer {
  const buf = Buffer.alloc(44 + frames * channels * 2)
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + frames * channels * 2, 4); buf.write('WAVE', 8, 'latin1'); buf.write('fmt ', 12, 'latin1')
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(44100, 24)
  buf.writeUInt32LE(44100 * channels * 2, 28); buf.writeUInt16LE(channels * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36, 'latin1')
  buf.writeUInt32LE(frames * channels * 2, 40)
  for (let i = 0; i < frames * channels; i++) buf.writeInt16LE(sample(base, i), 44 + i * 2)
  return buf
}

async function files(acc: Buffer, voc: Buffer) {
  const root = await mkdtemp(join(tmpdir(), 'stem-mix-'))
  roots.push(root)
  await writeFile(join(root, 'acc.wav'), acc)
  await writeFile(join(root, 'voc.wav'), voc)
  return [join(root, 'acc.wav'), join(root, 'voc.wav')] as const
}

async function request(accompaniment: string, vocals: string, range = '') {
  const sink = new PassThrough()
  const chunks: Buffer[] = []
  sink.on('data', chunk => chunks.push(chunk))
  const head: { status?: number; headers?: Record<string, string> } = {}
  const res = Object.assign(sink, { writeHead(status: number, headers: Record<string, string>) { head.status = status; head.headers = headers; return this } }) as unknown as ServerResponse
  const served = await serveStemMix(res, accompaniment, vocals, range)
  if (served) await new Promise(resolve => sink.on('end', resolve))
  return { served, ...head, body: Buffer.concat(chunks) }
}

describe('伴奏人声侧轨拼接流', () => {
  it('伴奏与人声逐帧交织为 4 声道 WAV', async () => {
    const [acc, voc] = await files(wav(40000, 0), wav(40000, 1000))
    const { served, status, headers, body } = await request(acc, voc)
    expect(served).toBe(true)
    expect(status).toBe(200)
    expect(body.length).toBe(44 + 40000 * 8)
    expect(headers?.['Content-Length']).toBe(String(body.length))
    expect(body.readUInt16LE(22)).toBe(4)
    expect(body.readUInt16LE(32)).toBe(8)
    expect(body.readUInt32LE(40)).toBe(40000 * 8)
    for (const frame of [0, 1, 16383, 16384, 39999]) {
      const at = 44 + frame * 8
      expect([0, 1, 2, 3].map(c => body.readInt16LE(at + c * 2))).toEqual([sample(0, frame * 2), sample(0, frame * 2 + 1), sample(1000, frame * 2), sample(1000, frame * 2 + 1)])
    }
  })

  it('非帧对齐的字节区间与完整流对应部分一致', async () => {
    const [acc, voc] = await files(wav(40000, 0), wav(40000, 1000))
    const whole = (await request(acc, voc)).body
    for (const [start, end] of [[0, 10], [30, 50], [131111, 131200], [44 + 16384 * 8 - 3, 44 + 16384 * 8 + 5]]) {
      const part = await request(acc, voc, `bytes=${start}-${end}`)
      expect(part.status).toBe(206)
      expect(part.headers?.['Content-Range']).toBe(`bytes ${start}-${end}/${whole.length}`)
      expect(part.body).toEqual(whole.subarray(start, end + 1))
    }
  })

  it('长度或格式不一致时不拼接，交回普通伴奏', async () => {
    const [acc, voc] = await files(wav(100, 0), wav(99, 0))
    expect((await request(acc, voc)).served).toBe(false)
    const [stereo, mono] = await files(wav(100, 0), wav(200, 0, 1))
    expect((await request(stereo, mono)).served).toBe(false)
  })
})
