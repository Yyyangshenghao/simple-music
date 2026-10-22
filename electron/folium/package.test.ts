import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { readModZip, verifyModPackage, sha256, safeModPath } from './package'

function zip(entries: [string, string | Buffer, number?][]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, raw, mode = 0o100644] of entries) {
    const path = Buffer.from(name)
    const content = Buffer.from(raw)
    const data = deflateRawSync(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(path.length, 26)
    locals.push(local, path, data)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50)
    record.writeUInt16LE(8, 10)
    record.writeUInt32LE(data.length, 20)
    record.writeUInt32LE(content.length, 24)
    record.writeUInt16LE(path.length, 28)
    record.writeUInt32LE((mode * 65536) >>> 0, 38)
    record.writeUInt32LE(offset, 42)
    central.push(record, path)
    offset += local.length + path.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function signedFixture() {
  const keys = generateKeyPairSync('ed25519')
  const manifest = { id: 'test-mod', name: '测试', folium: 1, version: '1.0.0', client: 'client.mjs' }
  const entries: [string, string][] = [['client.mjs', 'export default function activate() {}'], ['mod.json', JSON.stringify(manifest)]]
  const digest = 'sha256:' + sha256(entries.map(([name, bytes]) => sha256(bytes) + ' ' + name + '\n').join(''))
  const record = { format: 'folium-signature', version: 1, modId: 'test-mod', modVersion: '1.0.0', digest, keyId: 'test-key', signedAt: '2026-10-21T00:00:00.000Z', signature: '' }
  const message = ['folium-signature/1', 'modId=test-mod', 'modVersion=1.0.0', 'digest=' + digest, 'keyId=test-key', 'signedAt=' + record.signedAt, ''].join('\n')
  record.signature = sign(null, Buffer.from(message), keys.privateKey).toString('base64')
  const trust = { profiles: { 'test-mod': { version: '1.0.0', digest } }, keys: { 'test-key': keys.publicKey.export({ format: 'jwk' }).x! } }
  const archive = (files = entries, signature = record) => zip([...files, ['folium.sig.json', JSON.stringify(signature)]].map(([name, value]) => ['test-mod/' + name, value]))
  return { archive, trust, entries, record }
}

describe('Folium 原始包校验', () => {
  it('读取压缩条目并验证完整文件摘要与 Ed25519 签名', () => {
    const fixture = signedFixture()
    const mod = verifyModPackage(fixture.archive(), fixture.trust)
    expect(mod.info).toMatchObject({ id: 'test-mod', valid: true, compatible: true })
    expect(mod.files.get('client.mjs')?.toString()).toContain('activate')
  })
  it('拒绝未知签名密钥、自签假包和未验证版本', () => {
    const fixture = signedFixture()
    expect(() => verifyModPackage(fixture.archive())).toThrow('尚未通过兼容')
    expect(() => verifyModPackage(fixture.archive(), { ...fixture.trust, keys: {} })).toThrow('校验失败')
    expect(() => verifyModPackage(fixture.archive(fixture.entries, { ...fixture.record, signature: Buffer.alloc(64).toString('base64') }), fixture.trust)).toThrow('签名验证失败')
  })
  it('拒绝同 id/version 的文件篡改和新增未签文件', () => {
    const fixture = signedFixture()
    expect(() => verifyModPackage(fixture.archive([['client.mjs', 'altered'], fixture.entries[1]]), fixture.trust)).toThrow('校验失败')
    expect(() => verifyModPackage(fixture.archive([...fixture.entries, ['extra.mjs', 'alert(1)']]), fixture.trust)).toThrow('校验失败')
  })
  it.each(['../outside', '/absolute', 'a/../b', 'a//b', 'a\\b', 'a/%2e%2e', 'a/b?c', 'a/b\n'])('拒绝不安全路径 %s', path => {
    expect(safeModPath(path)).toBe(false)
    expect(() => readModZip(zip([[path, 'test'], ['mod/mod.json', '{}']]))).toThrow()
  })
  it('拒绝符号链接、重复路径和顶层模组外文件', () => {
    expect(() => readModZip(zip([['mod/link', 'target', 0o120777], ['mod/mod.json', '{}']]))).toThrow('不受支持')
    expect(() => readModZip(zip([['mod/mod.json', '{}'], ['mod/mod.json', '{}']]))).toThrow('重复')
    expect(() => readModZip(zip([['mod/mod.json', '{}'], ['extra.txt', 'extra']]))).toThrow('目录外')
  })
  it('解压上限在分配大块内存前生效，损坏目录被拒绝', () => {
    const bytes = zip([['mod/mod.json', '{}']])
    const central = bytes.readUInt32LE(bytes.length - 6)
    bytes.writeUInt32LE(32 * 1024 * 1024, central + 24)
    expect(() => readModZip(bytes)).toThrow('解压后过大')
    expect(() => readModZip(Buffer.alloc(30))).toThrow('格式无效')
  })
})
