const { signVmpPackage } = require('./vmp-sign.cjs')

exports.default = async function afterPack(context) {
  signVmpPackage(context, 'darwin')
}
