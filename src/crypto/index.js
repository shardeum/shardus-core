const crypto = require('shardus-crypto-utils')

class Crypto {
  constructor (logger, storage) {
    this.mainLogger = logger.getLogger('main')
    this.storage = storage
    this.keypair = {}
  }

  async init () {
    crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
    let keypair = await this.storage.get('keypair')
    if (!keypair) {
      this.keypair = this._generateKeypair()
      await this.storage.set('keypair', this.keypair)
      return
    }
    this.mainLogger.info('Keypair loaded successfully from database.')
    this.keypair = keypair
  }

  _generateKeypair () {
    let keypair = crypto.generateKeypair()
    this.mainLogger.info('New keypair generated.')
    return keypair
  }

  sign (obj) {
    let objCopy = JSON.parse(crypto.stringify(obj))
    crypto.signObj(objCopy, this.keypair.secretKey, this.keypair.publicKey)
    return objCopy
  }

  verify (obj) {
    return crypto.verifyObj(obj)
  }

  hash (obj) {
    if (!obj.sign) {
      return crypto.hashObj(obj)
    }
    return crypto.hashObj(obj, true)
  }
}

module.exports = Crypto
