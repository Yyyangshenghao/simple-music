import { describe, it, expect } from 'vitest'
import { resolveMacAppBundlePath, buildMacSwapScript } from './update-installer-logic'

describe('resolveMacAppBundlePath', () => {
  it('从可执行文件路径反推 .app bundle 根目录', () => {
    expect(resolveMacAppBundlePath('/Applications/SimpleMusic.app/Contents/MacOS/SimpleMusic')).toBe(
      '/Applications/SimpleMusic.app'
    )
  })

  it('路径不带 .app/Contents/MacOS 结构时返回 null，避免误删无关目录', () => {
    expect(resolveMacAppBundlePath('/usr/local/bin/simplemusic')).toBeNull()
  })

  it('用户级安装路径（带空格）也能正确解析', () => {
    expect(
      resolveMacAppBundlePath('/Users/foo/Applications/Simple Music.app/Contents/MacOS/Simple Music')
    ).toBe('/Users/foo/Applications/Simple Music.app')
  })
})

describe('buildMacSwapScript', () => {
  const script = buildMacSwapScript({
    dmgPath: '/tmp/SimpleMusic-1.2.0.dmg',
    appPath: '/Applications/SimpleMusic.app',
    logPath: '/tmp/install.log',
  })

  it('挂载失败（找不到 .app）时不动旧安装，直接重启旧版本', () => {
    const beforeSwap = script.split('NEW_APP=')[0]
    expect(beforeSwap).toContain('SRC_APP_NOT_FOUND')
    expect(beforeSwap).not.toContain('mv "$APP_PATH"')
  })

  it('替换失败时从备份回滚，而不是留下一个空目录', () => {
    expect(script).toContain('SWAP_FAILED_ROLLBACK')
    expect(script).toContain('mv "$OLD_BACKUP" "$APP_PATH"')
  })

  it('嵌入调用方传入的 dmg 路径与 app 路径', () => {
    expect(script).toContain('DMG="/tmp/SimpleMusic-1.2.0.dmg"')
    expect(script).toContain('APP_PATH="/Applications/SimpleMusic.app"')
  })
})
