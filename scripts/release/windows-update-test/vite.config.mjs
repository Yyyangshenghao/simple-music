// Test-only build: override the package JSON seen by Vite without editing the repository version.
import fs from 'node:fs'
import path from 'node:path'
import base from '../../../electron.vite.config.ts'

const packagePath = path.resolve('package.json').replaceAll('\\', '/')
const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const versionPlugin = () => ({
  name: 'local-update-test-version',
  enforce: 'pre',
  load(id) {
    if (id.replaceAll('\\', '/') === packagePath) return JSON.stringify({ ...metadata, version: '2.7.0' })
  }
})
const part = (name) => ({
  ...base[name],
  plugins: [versionPlugin(), ...(base[name]?.plugins || [])],
  build: { ...base[name]?.build, outDir: path.resolve(`dist/update-test/out/${name}`) }
})
export default { main: part('main'), preload: part('preload'), renderer: part('renderer') }
