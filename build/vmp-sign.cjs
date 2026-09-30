const { spawnSync } = require('node:child_process')

function signVmpPackage(context, expectedPlatform) {
  if (context.electronPlatformName !== expectedPlatform) return

  const hasCredentials = Boolean(process.env.EVS_ACCOUNT_NAME && process.env.EVS_PASSWD)
  if (!hasCredentials && process.env.CI) {
    throw new Error('生产安装包必须配置 EVS_ACCOUNT_NAME 和 EVS_PASSWD，才能完成 Widevine VMP 签名')
  }
  if (!hasCredentials && process.env.VMP_SIGN !== '1') {
    console.warn('[VMP] 本地打包未配置 EVS 凭据，跳过生产签名；发布流水线不会允许跳过')
    return
  }

  const pythonCommands = process.platform === 'win32' ? ['python'] : ['python3', 'python']
  const args = ['-m', 'castlabs_evs.vmp', '--no-ask', 'sign-pkg', context.appOutDir]
  let result
  for (const command of pythonCommands) {
    result = spawnSync(command, args, {
      stdio: 'inherit',
      env: { ...process.env, EVS_NO_ASK: '1' },
    })
    if (!result.error || result.error.code !== 'ENOENT') break
  }
  if (result?.error) throw result.error
  if (result?.status !== 0) throw new Error(`Widevine VMP 签名失败（退出码 ${result?.status ?? 'unknown'}）`)
}

module.exports = { signVmpPackage }
