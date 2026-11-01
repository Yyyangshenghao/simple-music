import { describe, expect, it } from 'vitest'
import { compareVersions, normalizeVersion } from './update-version'

describe('compareVersions', () => {
  it('按数字段比较正式版，忽略 v 前缀与构建元数据', () => {
    expect(compareVersions('2.6.2', '2.6.1')).toBe(1)
    expect(compareVersions('v2.10.0', '2.9.9')).toBe(1)
    expect(compareVersions('2.6.1+wvcus', '2.6.1')).toBe(0)
  })

  it('预发版低于同号正式版、高于上一正式版', () => {
    expect(compareVersions('2.6.2', '2.6.2-beta.1')).toBe(1)
    expect(compareVersions('2.6.2-beta.1', '2.6.2')).toBe(-1)
    expect(compareVersions('2.6.2-beta.1', '2.6.1')).toBe(1)
  })

  it('预发版之间按 semver 标识符比较', () => {
    expect(compareVersions('2.6.2-beta.2', '2.6.2-beta.1')).toBe(1)
    expect(compareVersions('2.6.2-beta.10', '2.6.2-beta.9')).toBe(1)
    expect(compareVersions('2.6.2-rc.1', '2.6.2-beta.3')).toBe(1)
    expect(compareVersions('2.6.2-beta', '2.6.2-beta.1')).toBe(-1)
    expect(compareVersions('v2.6.2-beta.1', '2.6.2-beta.1')).toBe(0)
  })

  it('normalizeVersion 仍只保留数字主版本，供文件名与 tag 拼接', () => {
    expect(normalizeVersion('v2.6.2-beta.1+wvcus')).toBe('2.6.2')
  })
})
