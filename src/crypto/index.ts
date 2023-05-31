import * as crypto from '@shardus/crypto-utils'
import { ChildProcess, fork } from 'child_process'
import fs from 'fs'
import Log4js from 'log4js'
import path from 'path'
import Logger, { logFlags } from '../logger'
import * as Shardus from '../shardus/shardus-types'
import Storage from '../storage'

export type HashableObject = object & { sign?: Shardus.Sign }

interface Keypair {
  publicKey?: crypto.publicKey
  secretKey?: crypto.secretKey
}

interface Crypto {
  baseDir: string
  config: Shardus.StrictServerConfiguration
  mainLogger: Log4js.Logger
  storage: Storage
  keypair: Keypair
  curveKeypair: {
    publicKey?: crypto.curvePublicKey
    secretKey?: crypto.curveSecretKey
  }
  powGenerators: { [name: string]: ChildProcess }
  sharedKeys: { [name: string]: Buffer }
}

class Crypto {
  constructor(baseDir: string, config: Shardus.StrictServerConfiguration, logger: Logger, storage: Storage) {
    this.baseDir = baseDir
    this.config = config
    this.mainLogger = logger.getLogger('main')
    this.storage = storage
    this.keypair = {}
    this.curveKeypair = {}
    this.powGenerators = {}
    this.sharedKeys = {}
  }

  async init() {
    crypto.init(this.config.crypto.hashKey)

    const keypair = await this.storage.getProperty('keypair')
    if (keypair) {
      this.mainLogger.info('Keypair loaded from database', this.getKeyPairFile())
      this.keypair = keypair
      this.setCurveKeyPair(this.keypair)
      return
    }

    if (this.config.crypto.keyPairConfig.useKeyPairFromFile) {
      const fsKeypair = this.readKeypairFromFile()
      if (fsKeypair && fsKeypair.secretKey && fsKeypair.publicKey) {
        this.keypair = fsKeypair
        this.mainLogger.info('Keypair loaded from file', this.getKeyPairFile())
        this.setCurveKeyPair(this.keypair)
        return
      }
    }

    try {
      this.mainLogger.info('Unable to load keypair. Generating new...')
      this.keypair = this._generateKeypair()
      if (this.config.crypto.keyPairConfig.useKeyPairFromFile) this.writeKeypairToFile(this.keypair)
      await this.storage.setProperty('keypair', this.keypair)
      this.mainLogger.info('New keypair successfully generated and saved to database.')
      this.setCurveKeyPair(this.keypair)
    } catch (e) {
      if (logFlags.error) this.mainLogger.error(`error ${JSON.stringify(e)}`)
    }
  }

  setCurveKeyPair(keypair: Keypair) {
    if (keypair) {
      this.curveKeypair = {
        secretKey: crypto.convertSkToCurve(this.keypair.secretKey),
        publicKey: crypto.convertPkToCurve(this.keypair.publicKey),
      }
    }
  }

  getKeyPairFile(): string {
    return path.join(this.baseDir, this.config.crypto.keyPairConfig.keyPairJsonFile)
  }

  writeKeypairToFile(keypair: Keypair) {
    // probably safe; accesses keypair defined by config
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(this.getKeyPairFile(), JSON.stringify(keypair))
  }

  readKeypairFromFile() {
    // probably safe; accesses keypair defined by config
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(this.getKeyPairFile())) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const fileData = fs.readFileSync(this.getKeyPairFile())
      return JSON.parse(fileData.toString())
    }
    return null
  }

  _generateKeypair() {
    const keypair = crypto.generateKeypair()
    this.mainLogger.info('New keypair generated.')
    return keypair
  }

  convertPublicKeyToCurve(pk: crypto.publicKey) {
    return crypto.convertPkToCurve(pk)
  }

  getPublicKey() {
    return this.keypair.publicKey
  }

  getCurvePublicKey() {
    return this.curveKeypair.publicKey
  }

  getSharedKey(curvePk: crypto.curvePublicKey) {
    // eslint-disable-next-line security/detect-object-injection
    let sharedKey = this.sharedKeys[curvePk]
    if (!sharedKey) {
      sharedKey = crypto.generateSharedKey(this.curveKeypair.secretKey, curvePk)
      // eslint-disable-next-line security/detect-object-injection
      this.sharedKeys[curvePk] = sharedKey
    }
    return sharedKey
  }

  tag(obj: unknown, recipientCurvePk: crypto.curvePublicKey) {
    const objCopy = JSON.parse(crypto.stringify(obj))
    const sharedKey = this.getSharedKey(recipientCurvePk)
    crypto.tagObj(objCopy, sharedKey)
    return objCopy
  }

  /**
   * Measure the message size when we are making the object copy (because it is pretty much free)
   * then add msgSize to the object
   * relies on node honesty.. better (but more work) to implement at shardus_net level
   *    to implement at shardus_net level we need to have it send us an extra argument to show
   *    the message size
   * @param obj
   * @param recipientCurvePk
   * @returns
   */
  tagWithSize(obj: unknown, recipientCurvePk: crypto.curvePublicKey) {
    const strEncoded = crypto.stringify(obj)
    const msgSize = strEncoded.length //get the message size
    const objCopy = JSON.parse(strEncoded)
    objCopy.msgSize = msgSize // set the size
    const sharedKey = this.getSharedKey(recipientCurvePk)
    crypto.tagObj(objCopy, sharedKey)
    return objCopy
  }

  signWithSize(obj: { msgSize: number, [key: string]: unknown }) {
    const wrappedMsgStr = crypto.stringify(obj)
    const msgLength = wrappedMsgStr.length
    obj.msgSize = msgLength
    return this.sign(obj)
  }

  authenticate(obj: crypto.TaggedObject, senderCurvePk: crypto.curvePublicKey) {
    const sharedKey = this.getSharedKey(senderCurvePk)
    return crypto.authenticateObj(obj, sharedKey)
  }

  sign(obj: unknown) {
    const objCopy = JSON.parse(crypto.stringify(obj))
    crypto.signObj(objCopy, this.keypair.secretKey, this.keypair.publicKey)
    return objCopy
  }

  verify(obj: crypto.SignedObject, expectedPk?: string) {
    try {
      if (expectedPk) {
        if (obj.sign.owner !== expectedPk) return false
      }
      return crypto.verifyObj(obj)
    } catch (e) {
      this.mainLogger.error(`Error in verifying object ${JSON.stringify(obj)}, error: ${e}`)
      return false
    }
  }

  hash(obj: HashableObject | unknown) {
    if (!(obj as HashableObject).sign) {
      return crypto.hashObj(obj)
    }
    return crypto.hashObj(obj, true)
  }

  isGreaterHash(hash1: string | number, hash2: string | number) {
    return hash1 > hash2
  }

  getComputeProofOfWork(seed: unknown, difficulty: number) {
    return this._runProofOfWorkGenerator('./computePowGenerator.js', seed, difficulty)
  }

  stopAllGenerators() {
    // tslint:disable-next-line: forin
    for (const generator in this.powGenerators) {
      // eslint-disable-next-line security/detect-object-injection
      this.powGenerators[generator].kill()
    }
    this.powGenerators = {}
  }

  /* eslint-disable security/detect-object-injection */
  _runProofOfWorkGenerator(generator: string, seed: unknown, difficulty: number) {
    // Fork a child process to compute the PoW, if it doesn't exist
    if (!this.powGenerators[generator]) {
      this.powGenerators[generator] = fork(generator, undefined, { cwd: __dirname })
    }
    const promise = new Promise((resolve) => {
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
  /* eslint-enable security/detect-object-injection */

  /* eslint-disable security/detect-object-injection */
  _stopProofOfWorkGenerator(generator: string) {
    if (!this.powGenerators[generator]) return Promise.resolve('not running')
    const promise = new Promise((resolve) => {
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
  /* eslint-enable security/detect-object-injection */
}

// tslint:disable-next-line: no-default-export
export default Crypto
