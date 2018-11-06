const crypto = require('shardus-crypto-utils')
const { fork } = require('child_process')

class Crypto {
  constructor (logger, storage) {
    this.mainLogger = logger.getLogger('main')
    this.storage = storage
    this.keypair = {}
    this.powGenerators = {}
  }

  async init () {
    crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
    let keypair = await this.storage.getProperty('keypair')
    if (!keypair) {
      this.keypair = this._generateKeypair()
      await this.storage.setProperty('keypair', this.keypair)
      return
    }
    this.mainLogger.info('Keypair loaded successfully from database.')
    this.keypair = keypair
    this.powGenerator = null
  }

  _generateKeypair () {
    let keypair = crypto.generateKeypair()
    this.mainLogger.info('New keypair generated.')
    return keypair
  }

  getPublicKey () {
    return this.keypair.publicKey
  }

  sign (obj) {
    let objCopy = JSON.parse(crypto.stringify(obj))
    crypto.signObj(objCopy, this.keypair.secretKey, this.keypair.publicKey)
    return objCopy
  }

  verify (obj, expectedPk) {
    if (expectedPk) {
      if (obj.sign.owner !== expectedPk) return false
    }
    return crypto.verifyObj(obj)
  }

  hash (obj) {
    if (!obj.sign) {
      return crypto.hashObj(obj)
    }
    return crypto.hashObj(obj, true)
  }

  getComputeProofOfWork (seed, difficulty) {
    return this._runProofOfWorkGenerator('./computePowGenerator.js', seed, difficulty)
  }

  _runProofOfWorkGenerator (generator, seed, difficulty) {
    // Fork a child process to compute the PoW, if it doesn't exist
    if (!this.powGenerators[generator]) this.powGenerators[generator] = fork(generator, { cwd: __dirname })
    let promise = new Promise((resolve, reject) => {
      this.powGenerators[generator].on('message', (powObj) => {
        this._stopProofOfWorkGenerator(generator)
        resolve(powObj)
      })
    })
    // Tell child to compute PoW
    this.powGenerators[generator].send({ seed, difficulty })
    // Return a promise the resolves to a valid { nonce, hash }
    return promise
  }

  _stopProofOfWorkGenerator (generator) {
    if (!this.powGenerators[generator]) return Promise.resolve('not running')
    let promise = new Promise((resolve, reject) => {
      this.powGenerators[generator].on('close', (signal) => {
        delete this.powGenerators[generator]
        resolve(signal)
      })
    })
    this.powGenerators[generator].kill()
    return promise
  }
}

module.exports = Crypto
