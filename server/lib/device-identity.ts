import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'

/**
 * 设备标识：优先取系统机器码，应用更新、重装和换网络都不变。
 * 只把按用途做过 HMAC 的结果发给上游，原始机器码不出本机。
 * 读不到机器码时退回固定硬件地址，再退回随机值，结果存入数据目录保持稳定。
 */
const FILE_NAME = 'device-identity.json'

let directory: string | null = null
let cachedRoot: string | null = null

export function setDeviceIdentityDir(dir: string | null): void {
  if (directory !== dir) cachedRoot = null
  directory = dir
}

/** 虚拟机和未初始化系统可能给出全 0、全 F 这类占位值。 */
export function isUsableMachineId(value: string): boolean {
  const compact = value.replace(/[^0-9a-z]/gi, '').toLowerCase()
  return compact.length >= 16 && !/^(.)\1*$/.test(compact) && compact !== 'uninitialized'
}

function commandOutput(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
}

export function parseMachineId(platform: NodeJS.Platform, output: string): string | null {
  const pattern = platform === 'darwin' ? /"IOPlatformUUID"\s*=\s*"([^"]+)"/ : /MachineGuid\s+REG_SZ\s+(\S+)/
  const value = pattern.exec(output)?.[1]
  return value && isUsableMachineId(value) ? value : null
}

function systemMachineId(): string | null {
  try {
    if (process.platform === 'darwin') return parseMachineId('darwin', commandOutput('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']))
    if (process.platform === 'win32') return parseMachineId('win32', commandOutput('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']))
  } catch {
    return null
  }
  for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const value = readFileSync(path, 'utf8').trim()
      if (isUsableMachineId(value)) return value
    } catch { /* 继续尝试下一个位置 */ }
  }
  return null
}

/** 系统随机化的地址（本地管理位为 1）会随网络变化，不能作为设备标识。 */
function hardwareAddress(): string | null {
  const addresses = Object.values(networkInterfaces()).flatMap(list => list ?? [])
    .filter(item => !item.internal && item.mac && item.mac !== '00:00:00:00:00:00' && !(parseInt(item.mac.slice(0, 2), 16) & 2))
    .map(item => item.mac)
  return addresses.sort()[0] ?? null
}

function readStore(): Record<string, unknown> {
  if (!directory) return {}
  try {
    const value: unknown = JSON.parse(readFileSync(join(directory, FILE_NAME), 'utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, unknown>): void {
  if (!directory) return
  const file = join(directory, FILE_NAME)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporary, JSON.stringify(store), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    // 写不进数据目录时本次运行仍可用，下次启动重新获取。
  } finally {
    rmSync(temporary, { force: true })
  }
}

function rootSecret(): string {
  if (cachedRoot) return cachedRoot
  const machineId = systemMachineId()
  if (machineId) return cachedRoot = machineId
  const saved = readStore().root
  if (typeof saved === 'string' && saved) return cachedRoot = saved
  const root = hardwareAddress() ?? randomBytes(32).toString('hex')
  writeStore({ ...readStore(), root })
  return cachedRoot = root
}

export function deriveDeviceHex(root: string, purpose: string): string {
  return createHmac('sha256', root).update(`simplemusic:${purpose}`).digest('hex')
}

/** 把派生结果映射为固定位数的数字，首位不为 0。 */
export function deriveDeviceDigits(root: string, purpose: string, length: number): string {
  const min = 10n ** BigInt(length - 1)
  return String(min + BigInt(`0x${deriveDeviceHex(root, purpose)}`) % (min * 9n))
}

export function deviceHex(purpose: string): string {
  return deriveDeviceHex(rootSecret(), purpose)
}

export function deviceDigits(purpose: string, length: number): string {
  return deriveDeviceDigits(rootSecret(), purpose, length)
}

/** 上游下发、无法本地派生的标识（如 B 站 buvid3）存在这里，跨启动复用。 */
export function readStoredDeviceValue(name: string): string {
  const value = readStore()[name]
  return typeof value === 'string' ? value : ''
}

export function writeStoredDeviceValue(name: string, value: string): void {
  if (!directory) return
  const store = readStore()
  if (value) store[name] = value
  else delete store[name]
  writeStore(store)
}
