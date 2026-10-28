import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupUpdateArtifacts,
  installerVersion,
  parseMacInstallResult,
  pruneOtherInstallers,
  staleUpdateFiles,
} from './update-cleanup'

describe('installerVersion', () => {
  it('识别新旧两种 mac 命名与 Windows 安装包', () => {
    expect(installerVersion('Simple-Music-2.6.0-arm64.dmg')).toBe('2.6.0')
    expect(installerVersion('Simple.Music-2.0.2-arm64.dmg')).toBe('2.0.2')
    expect(installerVersion('Simple-Music-2.6.1-Setup.exe')).toBe('2.6.1')
    expect(installerVersion('notes.dmg')).toBe('')
  })
})

describe('staleUpdateFiles', () => {
  const names = [
    'Simple.Music-2.0.2-arm64.dmg',
    'Simple-Music-2.6.0-arm64.dmg',
    'Simple-Music-2.6.1-arm64.dmg',
    'Simple-Music-2.6.2-arm64.dmg.download',
    'Simple-Music-2.5.1-arm64.invalid-1700000000000.dmg',
    'mystery.dmg',
    'readme.txt',
  ]

  it('启动时删不比当前新的安装包、中断与校验失败的残留，保留待装的新版和认不出版本的文件', () => {
    expect(staleUpdateFiles(names, '2.6.0').sort()).toEqual(
      [
        'Simple.Music-2.0.2-arm64.dmg',
        'Simple-Music-2.6.0-arm64.dmg',
        'Simple-Music-2.6.2-arm64.dmg.download',
        'Simple-Music-2.5.1-arm64.invalid-1700000000000.dmg',
      ].sort()
    )
  })

  it('刚下载完时只保留这一个，不动进行中的 .download、待排查的 .invalid-* 与非安装包文件', () => {
    expect(staleUpdateFiles(names, '', 'Simple-Music-2.6.1-arm64.dmg').sort()).toEqual(
      ['Simple.Music-2.0.2-arm64.dmg', 'Simple-Music-2.6.0-arm64.dmg', 'mystery.dmg'].sort()
    )
  })
})

describe('cleanupUpdateArtifacts / pruneOtherInstallers', () => {
  let userData: string
  let downloads: string
  let work: string
  const touch = (file: string, text = 'x') => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-update-cleanup-'))
    work = path.join(userData, 'updates')
    downloads = path.join(work, 'downloads')
    touch(path.join(downloads, 'Simple-Music-2.6.0-arm64.dmg'))
    touch(path.join(downloads, 'Simple-Music-2.6.1-arm64.dmg'))
    touch(path.join(work, 'staging', 'Simple Music.app', 'Contents', 'marker'))
    touch(path.join(work, 'backup', 'Simple Music.app', 'Contents', 'marker'))
    touch(path.join(work, 'mac-swap.sh'))
  })

  afterEach(() => fs.rmSync(userData, { recursive: true, force: true }))

  it('启动时清旧包与替换残留，并只报告一次替换结果', () => {
    touch(path.join(work, 'install-result.json'), '{"ok":true,"code":"OK","from":"2.6.0","to":"2.6.1","at":1}')
    expect(cleanupUpdateArtifacts(userData, '2.6.1')).toMatchObject({ ok: true, code: 'OK', to: '2.6.1' })
    expect(fs.readdirSync(downloads)).toEqual([])
    expect(fs.readdirSync(work).sort()).toEqual(['downloads'])
    expect(cleanupUpdateArtifacts(userData, '2.6.1')).toBeNull()
  })

  it('回滚失败时保留备份里的旧版', () => {
    touch(path.join(work, 'install-result.json'), '{"ok":false,"code":"ROLLBACK_FAILED","from":"2.6.0","to":"2.6.1","at":1}')
    expect(cleanupUpdateArtifacts(userData, '2.6.0')?.code).toBe('ROLLBACK_FAILED')
    expect(fs.existsSync(path.join(work, 'backup', 'Simple Music.app'))).toBe(true)
    expect(fs.readdirSync(downloads)).toEqual(['Simple-Music-2.6.1-arm64.dmg'])
  })

  it('下载完成后只留刚下好的安装包', () => {
    pruneOtherInstallers(downloads, 'Simple-Music-2.6.1-arm64.dmg')
    expect(fs.readdirSync(downloads)).toEqual(['Simple-Music-2.6.1-arm64.dmg'])
  })

  it('损坏的结果文件返回 null', () => {
    expect(parseMacInstallResult('{')).toBeNull()
    expect(parseMacInstallResult('{"ok":"yes"}')).toBeNull()
  })
})
