const crypto = require('shardus-crypto-utils')
const { fork } = require('child_process')

import Shardus = require('../shardus/shardus-types')

interface Crypto {
  config: Shardus.ShardusConfiguration
  mainLogger: any
  storage: any
  keypair: any
  curveKeypair: any
  powGenerators: any
  sharedKeys: any
}

class Crypto {
  constructor (config, logger, storage) {
    this.config = config
    this.mainLogger = logger.getLogger('main')
    this.storage = storage
    this.keypair = {}
    this.curveKeypair = {}
    this.powGenerators = {}
    this.sharedKeys = {}
  }

  async init () {
    crypto.init(this.config.crypto.hashKey)
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

  getSharedKey (curvePk) {
    let sharedKey = this.sharedKeys[curvePk]
    if (!sharedKey) {
      sharedKey = crypto.generateSharedKey(this.curveKeypair.secretKey, curvePk)
      this.sharedKeys[curvePk] = sharedKey
    }
    return sharedKey
  }

  tag (obj, recipientCurvePk) {
    const objCopy = JSON.parse(crypto.stringify(obj))
    const sharedKey = this.getSharedKey(recipientCurvePk)
    crypto.tagObj(objCopy, sharedKey)
    return objCopy
  }

  authenticate (obj, senderCurvePk) {
    const sharedKey = this.getSharedKey(senderCurvePk)
    return crypto.authenticateObj(obj, sharedKey)
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
    // @ts-ignore for seems to have a funky definition so ignoring it for now.  could be good to go back and research this.
    if (!this.powGenerators[generator]) this.powGenerators[generator] = fork(generator, { cwd: __dirname })
    let promise = new Promise((resolve, reject) => {
      this.powGenerators[generator].on('message', (powObj) => {
        this._stopProofOfWorkGenerator(generator)
        resolve(powObj)
      })
    })
    // Tell child to compute PoW
    if (!this.powGenerators[generator].killed) {
      this.powGenerators[generator].send({ seed, difficulty })
    }
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
    if (!this.powGenerators[generator].killed) {
      this.powGenerators[generator].kill()
    }
    return promise
  }
}

export default Crypto
