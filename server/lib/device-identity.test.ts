import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveDeviceDigits,
  deriveDeviceHex,
  deviceDigits,
  isUsableMachineId,
  parseMachineId,
  readStoredDeviceValue,
  setDeviceIdentityDir,
  writeStoredDeviceValue,
} from './device-identity'

describe('设备标识', () => {
  const dirs: string[] = []
  const newDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'simplemusic-device-test-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('同一机器同一用途结果不变，不同机器或用途互不相同，且不含原始机器码', () => {
    const root = 'machine-a-0123456789'
    expect(deriveDeviceHex(root, 'qq')).toBe(deriveDeviceHex(root, 'qq'))
    expect(deriveDeviceHex(root, 'qq')).not.toBe(deriveDeviceHex(root, 'netease'))
    expect(deriveDeviceHex(root, 'qq')).not.toBe(deriveDeviceHex('machine-b-0123456789', 'qq'))
    expect(deriveDeviceHex(root, 'qq')).not.toContain(root)
  })

  it('数字标识位数固定，首位不为 0', () => {
    for (const purpose of ['a', 'b', 'c', 'd', 'e']) {
      expect(deriveDeviceDigits('machine-a-0123456789', purpose, 8)).toMatch(/^[1-9]\d{7}$/)
      expect(deriveDeviceDigits('machine-a-0123456789', purpose, 14)).toMatch(/^[1-9]\d{13}$/)
    }
  })

  it('解析各系统机器码，拒绝占位值', () => {
    const uuid = '12345678-ABCD-4321-ABCD-1234567890AB'
    expect(parseMachineId('darwin', `  "IOPlatformUUID" = "${uuid}"\n`)).toBe(uuid)
    expect(parseMachineId('win32', `\r\n    MachineGuid    REG_SZ    ${uuid}\r\n`)).toBe(uuid)
    expect(parseMachineId('darwin', '"IOPlatformUUID" = "00000000-0000-0000-0000-000000000000"')).toBeNull()
    expect(parseMachineId('win32', '')).toBeNull()
    expect(isUsableMachineId('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')).toBe(false)
    expect(isUsableMachineId('uninitialized')).toBe(false)
  })

  it('换数据目录（模拟清除应用数据后重装）标识不变', () => {
    setDeviceIdentityDir(newDir())
    const first = deviceDigits('qq', 8)
    setDeviceIdentityDir(newDir())
    expect(deviceDigits('qq', 8)).toBe(first)
  })

  it('上游下发的标识可保存、跨读取复用、可清除', () => {
    setDeviceIdentityDir(newDir())
    expect(readStoredDeviceValue('bilibili')).toBe('')
    writeStoredDeviceValue('bilibili', 'buvid-1')
    expect(readStoredDeviceValue('bilibili')).toBe('buvid-1')
    writeStoredDeviceValue('bilibili', '')
    expect(readStoredDeviceValue('bilibili')).toBe('')
  })
})
