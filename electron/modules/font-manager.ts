import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SystemFontFamily } from '../../src/types/ipc'

const execFileAsync = promisify(execFile)

const MAC_FONT_SCRIPT = [
  'ObjC.import("AppKit")',
  'var manager = $.NSFontManager.sharedFontManager',
  'var families = ObjC.deepUnwrap(manager.availableFontFamilies)',
  'var fonts = []',
  'for (var i = 0; i < families.length; i++) {',
  '  var family = families[i]',
  '  var members = ObjC.deepUnwrap(manager.availableMembersOfFontFamily(family) || $())',
  '  var member = members[0]',
  '  for (var j = 0; j < members.length; j++) {',
  '    if (members[j][1] === "Regular") { member = members[j]; break }',
  '  }',
  '  if (!member) { fonts.push({ family: family }); continue }',
  '  var font = $.NSFont.fontWithNameSize(member[0], 12)',
  '  if (!font) { fonts.push({ family: family }); continue }',
  '  var localizedName = ObjC.unwrap(font.displayName) || ""',
  '  var localizedFace = ObjC.unwrap(manager.localizedNameForFamilyFace(family, member[1]))',
  '  if (localizedFace && localizedName.slice(-localizedFace.length - 1) === " " + localizedFace) {',
  '    localizedName = localizedName.slice(0, -localizedFace.length - 1)',
  '  }',
  '  fonts.push(/[\\u3400-\\u9fff]/.test(localizedName) ? { family: family, localizedName: localizedName } : { family: family })',
  '}',
  'JSON.stringify(fonts)'
].join('; ')

const WINDOWS_FONT_SCRIPT = [
  '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
  '$OutputEncoding = [Console]::OutputEncoding',
  'Add-Type -AssemblyName System.Drawing',
  '$fonts = [System.Drawing.Text.InstalledFontCollection]::new()',
  '$items = $fonts.Families | ForEach-Object {',
  '  try { $family = $_.GetName(1033) } catch { $family = $_.Name }',
  '  $localizedName = $null',
  '  try {',
  '    $candidate = $_.GetName(2052)',
  '    if ($candidate -and $candidate -ne $family) { $localizedName = $candidate }',
  '  } catch {}',
  '  [PSCustomObject]@{ family = $family; localizedName = $localizedName }',
  '}',
  '$items | Sort-Object family -Unique | ConvertTo-Json -Compress'
].join('; ')

const KNOWN_CHINESE_NAMES = new Map([
  ['pingfang sc', '苹方-简'],
  ['songti sc', '宋体-简'],
  ['heiti sc', '黑体-简'],
  ['hiragino sans gb', '冬青黑体简体中文'],
  ['stsong', '华文宋体'],
  ['kaiti sc', '楷体-简'],
  ['xingkai sc', '行楷-简'],
  ['harmonyos sans sc', '鸿蒙黑体'],
  ['lxgw wenkai mono', '霞鹜文楷等宽'],
  ['microsoft yahei', '微软雅黑'],
  ['microsoft jhenghei', '微软正黑体'],
  ['simsun', '宋体'],
  ['nsimsun', '新宋体'],
  ['simhei', '黑体'],
  ['kaiti', '楷体'],
  ['fangsong', '仿宋'],
  ['dengxian', '等线']
])

function hasChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

export function normalizeFontFamilies(values: unknown): SystemFontFamily[] {
  if (!Array.isArray(values)) return []

  const unique = new Map<string, SystemFontFamily>()
  for (const value of values) {
    const familyValue = typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'family' in value
        ? (value as { family?: unknown }).family
        : ''
    if (typeof familyValue !== 'string') continue
    const family = familyValue.trim()
    if (!family || family.startsWith('.')) continue

    const localizedValue = value && typeof value === 'object' && 'localizedName' in value
      ? (value as { localizedName?: unknown }).localizedName
      : ''
    const suppliedName = typeof localizedValue === 'string' ? localizedValue.trim() : ''
    const localizedName = suppliedName !== family && hasChinese(suppliedName)
      ? suppliedName
      : KNOWN_CHINESE_NAMES.get(family.toLocaleLowerCase())
    const key = family.toLocaleLowerCase()
    const existing = unique.get(key)
    if (!existing || (!existing.localizedName && localizedName)) {
      unique.set(key, localizedName ? { family, localizedName } : { family })
    }
  }

  return [...unique.values()].sort((a, b) => a.family.localeCompare(b.family, undefined, {
    numeric: true,
    sensitivity: 'base'
  }))
}

export function parseFontFamiliesJson(output: string): SystemFontFamily[] {
  const parsed = JSON.parse(output.replace(/^\uFEFF/, '').trim()) as unknown
  return normalizeFontFamilies(Array.isArray(parsed) ? parsed : [parsed])
}

export async function listSystemFonts(platform = process.platform): Promise<SystemFontFamily[]> {
  if (platform === 'darwin') {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_FONT_SCRIPT], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024
    })
    return parseFontFamiliesJson(stdout)
  }

  if (platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_FONT_SCRIPT
    ], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    })
    return parseFontFamiliesJson(stdout)
  }

  throw new Error('UNSUPPORTED_PLATFORM')
}
