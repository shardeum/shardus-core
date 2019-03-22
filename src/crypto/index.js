const crypto = require('shardus-crypto-utils')
const { fork } = require('child_process')

class Crypto {
  constructor (config, logger, storage) {
    this.config = config
    this.mainLogger = logger.getLogger('main')
    this.storage = storage
    this.keypair = {}
    this.curveKeypair = {}
    this.powGenerators = {}
  }

  async init () {
    crypto(this.config.hashKey)
    let keypair = await this.storage.getProperty('keypair')
    if (!keypair) {
      this.mainLogger.info('Keypair unable to be loaded from database. Generating new keypair...')
      this.keypair = this._generateKeypair()
      await this.storage.setProperty('keypair', this.keypair)
      this.mainLogger.info('New keypair successfully generated and saved to database.')
    } else {
      this.mainLogger.info('Keypair loaded successfully from database.')
      this.keypair = keypair
    }
    this.curveKeypair = {
      secretKey: crypto.convertSkToCurve(this.keypair.secretKey),
      publicKey: crypto.convertPkToCurve(this.keypair.publicKey)
    }
  }

  _generateKeypair () {
    let keypair = crypto.generateKeypair()
    this.mainLogger.info('New keypair generated.')
    return keypair
  }

  convertPublicKeyToCurve (pk) {
    return crypto.convertPkToCurve(pk)
  }

  getPublicKey () {
    return this.keypair.publicKey
  }

  getCurvePublicKey () {
    return this.curveKeypair.publicKey
  }

  tag (obj, recipientCurvePk) {
    crypto.tagObj(obj, this.curveKeypair.secretKey, recipientCurvePk)
  }

  authenticate (obj, senderCurvePk) {
    crypto.authenticateObj(obj, this.curveKeypair.secretKey, senderCurvePk)
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

  isGreaterHash (hash1, hash2) {
    return hash1 > hash2
  }

  getComputeProofOfWork (seed, difficulty) {
    return this._runProofOfWorkGenerator('./computePowGenerator.js', seed, difficulty)
  }

  stopAllGenerators () {
    for (const generator in this.powGenerators) {
      this.powGenerators[generator].kill()
    }
    this.powGenerators = {}
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
