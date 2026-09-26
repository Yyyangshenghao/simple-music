const { signVmpPackage } = require('./vmp-sign.cjs')

exports.default = async function afterSign(context) {
  signVmpPackage(context, 'win32')
}
