import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import config from '../../package.json'

const require = createRequire(import.meta.url)
const { FileMatcher } = require('app-builder-lib/out/fileMatcher')
const stat = { isFile: () => true, isDirectory: () => false }

describe('原生分离运行库打包', () => {
  it.each(['mac', 'win', 'linux'] as const)('%s 仅包含目标平台和架构，不依赖构建宿主平台', (target) => {
    const nativePlatform = { mac: 'darwin', win: 'win32', linux: 'linux' }[target]
    for (const arch of ['x64', 'arm64']) {
      const matcher = new FileMatcher('/app', '/out', (text: string) => text.replaceAll('${arch}', arch), ['**/*', ...config.build[target].files])
      const filter = matcher.createFilter()
      for (const platform of ['darwin', 'win32', 'linux']) for (const candidate of ['x64', 'arm64']) {
        expect(filter(`/app/node_modules/onnxruntime-node/bin/napi-v6/${platform}/${candidate}/runtime.node`, stat)).toBe(platform === nativePlatform && candidate === arch)
      }
    }
  })

  it('原生绑定和相邻动态库都解包，使加载器可读取真实文件', () => {
    const matcher = new FileMatcher('/app', '/out', (text: string) => text, config.build.asarUnpack)
    const filter = matcher.createFilter()
    for (const file of ['runtime.node', 'libonnxruntime.dylib', 'onnxruntime.dll', 'libonnxruntime.so']) {
      expect(filter(`/app/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/${file}`, stat)).toBe(true)
    }
  })

  it('macOS 保留绑定使用的主版本库，排除内容重复的完整版本库', () => {
    const matcher = new FileMatcher('/app', '/out', (text: string) => text.replaceAll('${arch}', 'arm64'), ['**/*', ...config.build.mac.files])
    const filter = matcher.createFilter()
    const prefix = '/app/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/'
    expect(filter(`${prefix}libonnxruntime.1.dylib`, stat)).toBe(true)
    expect(filter(`${prefix}libonnxruntime.1.30.0.dylib`, stat)).toBe(false)
  })
})
