const { signVmpPackage } = require('./vmp-sign.cjs')
const { prepareWindowsUninstall } = require('./windows-uninstall.cjs')

exports.default = async function afterPack(context) {
  prepareWindowsUninstall(context)
  signVmpPackage(context, 'darwin')
}
