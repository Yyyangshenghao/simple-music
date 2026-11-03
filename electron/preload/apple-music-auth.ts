import { contextBridge } from 'electron'

// Windows 上 Electron 把 WebAuthn 直接交给系统安全密钥对话框（“插入 USB 安全密钥”），
// Apple ID 登录会卡在这里。让官网判定不支持通行密钥，退回密码 + 验证码登录。
contextBridge.executeInMainWorld({
  func: () => {
    const credentials = navigator.credentials
    if (credentials) {
      const reject = () => Promise.reject(new DOMException('通行密钥在此窗口不可用', 'NotAllowedError'))
      const get = credentials.get.bind(credentials)
      const create = credentials.create.bind(credentials)
      credentials.get = options => options?.publicKey ? reject() : get(options)
      credentials.create = options => options?.publicKey ? reject() : create(options)
    }
    delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential
  },
})
