// 打包产物检查：asar 里只能有运行时文件，安装包与更新清单齐全。CI 打包后自动执行，本地打包后也可手动跑。
//   node scripts/release/check-package.mjs mac|win|linux
// files 白名单失效时 docs/、src/ 等会整个打进 asar，安装包体积成倍增加。
import { readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import asar from '@electron/asar'

const TARGETS = {
  mac: {
    // 每个平台必需的安装包、差分 blockmap 与自动更新清单。
    required: [/-arm64\.dmg$/, /-x64\.dmg$/, /-arm64\.dmg\.blockmap$/, /-x64\.dmg\.blockmap$/, /^latest-mac\.yml$/],
    asar: ['mac-arm64', 'mac'].map((dir) => `${dir}/Simple Music.app/Contents/Resources/app.asar`),
    sizes: /\.dmg$/
  },
  win: {
    required: [/-Setup\.exe$/, /-portable\.exe$/, /-Setup\.exe\.blockmap$/, /^latest\.yml$/],
    asar: ['win-unpacked/resources/app.asar'],
    sizes: /\.exe$/
  },
  linux: {
    // AppImage 才带自动更新清单；deb 只做安装包。electron-builder 的 ${arch} 在 Linux 上
    // 按目标格式展开成 x86_64（AppImage）/ amd64（deb），不是 x64。
    required: [/-x86_64\.AppImage$/, /-amd64\.deb$/, /^latest-linux\.yml$/],
    asar: ['linux-unpacked/resources/app.asar'],
    sizes: /\.(AppImage|deb)$/
  }
}

const target = process.argv[2]
const spec = TARGETS[target]
if (!spec) {
  console.error(`用法：node scripts/release/check-package.mjs ${Object.keys(TARGETS).join('|')}`)
  process.exit(2)
}

const dist = path.resolve('dist')
const errors = []
const files = existsSync(dist) ? readdirSync(dist) : []

for (const pattern of spec.required) {
  if (!files.some((file) => pattern.test(file))) errors.push(`dist/ 缺少匹配 ${pattern} 的产物`)
}

const asarFiles = spec.asar.map((relative) => path.join(dist, relative))
const ALLOWED = /^\/(out|node_modules)(\/|$)|^\/package\.json$|^\/build(\/icon\.(ico|png))?$/
for (const file of asarFiles) {
  if (!existsSync(file)) { errors.push(`缺少 ${path.relative(dist, file)}`); continue }
  const unexpected = asar.listPackage(file).map((entry) => entry.replace(/\\/g, '/')).filter((entry) => !ALLOWED.test(entry))
  if (unexpected.length) {
    errors.push(`${path.relative(dist, file)} 含非运行时文件（共 ${unexpected.length} 项），先检查 package.json 的 build.files：\n    ${unexpected.slice(0, 10).join('\n    ')}`)
  }
}

for (const file of files.filter((name) => spec.sizes.test(name))) {
  console.log(`${file}  ${(statSync(path.join(dist, file)).size / 1048576).toFixed(1)} MB`)
}
if (errors.length) {
  for (const message of errors) console.error(`✗ ${message}`)
  process.exit(1)
}
console.log(`✓ ${target} 打包产物检查通过`)
