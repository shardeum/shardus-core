const Logger = require('../logger')
const ExitHandler = require('../exit-handler')
const P2P = require('../p2p')
const Crypto = require('../crypto')
const Storage = require('../storage')
const Network = require('../network')
const utils = require('../utils')
const Consensus = require('../consensus')

class Shardus {
  constructor (config) {
    this.config = config
    this.logger = new Logger(config.baseDir, config.log)
    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.exitHandler = new ExitHandler()
    this.storage = new Storage(this.logger, config.baseDir, config.storage)
    this.crypto = {}
    this.network = new Network(config.network, this.logger)
    this.p2p = {}
    this.app = {}
    this.consensus = {}

    this.heartbeatInterval = config.heartbeatInterval
    this.heartbeatTimer = null

    // alias the network register calls so that an app can get to them
    this.registerExternalGet = (route, handler) => this.network.registerExternalGet(route, handler)
    this.registerExternalPost = (route, handler) => this.network.registerExternalPost(route, handler)
    this.registerExternalPut = (route, handler) => this.network.registerExternalPut(route, handler)
    this.registerExternalDelete = (route, handler) => this.network.registerExternalDelete(route, handler)
    this.registerExternalPatch = (route, handler) => this.network.registerExternalPatch(route, handler)

    this.exitHandler.addSigListeners()
    this.exitHandler.registerSync('shardus', () => {
      this.stopHeartbeat()
    })
    this.exitHandler.registerSync('crypto', () => {
      this.crypto.stopAllGenerators()
    })
    this.exitHandler.registerAsync('shardus', () => {
      this.mainLogger.info('Writing heartbeat to database before exiting...')
      return this.writeHeartbeat()
    })
    this.exitHandler.registerAsync('storage', () => {
      return this.storage.close()
    })
    this.exitHandler.registerAsync('application', () => {
      this.mainLogger.log('Closing the application')
      if (this.app && this.app.close) {
        return this.app.close()
      }
    })
    this.exitHandler.registerAsync('logger', () => {
      return this.logger.shutdown()
    })
  }

  _registerRoutes () {
    this.network.registerExternalPost('exit', async (req, res) => {
      res.json({ success: true })
      await this.shutdown()
    })
  }

  registerExceptionHandler () {
    process.on('uncaughtException', async (err) => {
      this.fatalLogger.fatal(err)
      try {
        await this.exitHandler.exitCleanly()
      } catch (e) {
        console.error(e)
        process.exit(1)
      }
    })
  }

  async writeHeartbeat () {
    const timestamp = utils.getTime('s')
    await this.storage.setProperty('heartbeat', timestamp)
  }

  _setupHeartbeat () {
    this._heartbeatTimer = setInterval(async () => {
      await this.writeHeartbeat()
    }, this.heartbeatInterval * 1000)
  }

  stopHeartbeat () {
    this.mainLogger.info('Stopping heartbeat...')
    clearInterval(this.heartbeatTimer)
  }

  setup (app = null) {
    this.app = this.getApplicationInterface(app)
    return this
  }

  /**
   * Handle incoming tranaction requests
   */

  async put (req, res) {
    this.mainLogger.debug(`Start of injectTransaction ${JSON.stringify(req.body)}`)
    // retrieve incoming transaction from HTTP request
    let inTransaction = req.body
    let shardusTransaction = {}
    try {
      if (typeof inTransaction !== 'object') {
        return { success: false, reason: `Invalid Transaction! ${inTransaction}` }
      }

      /**
       * {txnReceivedTimestamp, sign, inTxn:{srcAct, tgtAct, tnxAmt, txnType, seqNum, txnTimestamp, signs}}
       * Timestamping the transaction of when the transaction was received. Sign the complete transaction
       * with the node SK
       * ToDo: Check with Omar if validateTransaction () methods needs receivedTimestamp and Node Signature
       */
      shardusTransaction.receivedTimestamp = Date.now()
      shardusTransaction.inTransaction = inTransaction

      this.mainLogger.debug(`ShardusTransaction: ${shardusTransaction}`)

      // Validate transaction through the application. Shardus can see inside the transaction
      let transactionValidateResult = await this.app.validateTransaction(inTransaction)
      if (transactionValidateResult.result !== 'pass') {
        this.mainLogger.error(`Failed to validate transaction. Reason: ${transactionValidateResult.reason}`)
        return { success: false, reason: transactionValidateResult.reason }
      }
      this.crypto.sign(shardusTransaction)

      this.mainLogger.debug('Transaction Valided')
      // Perform Consensus -- Currently no algorithm is being used
      // let nodeList = await this.storage.getNodes()
      let transactionReceipt = await this.consensus.inject(shardusTransaction)
      this.mainLogger.debug(`Received Consensus. Receipt: ${JSON.stringify(transactionReceipt)}`)
      // Apply the transaction
      await this.app.apply(inTransaction, transactionReceipt)
    } catch (ex) {
      this.fatalLogger.fatal(`Failed to process transaction. Exception: ${ex}`)
      return { success: false, reason: `Failed to process trasnaction: ${JSON.parse(inTransaction)} ${ex}` }
    }
    this.mainLogger.debug(`End of injectTransaction ${inTransaction}`)
    return { success: true, reason: 'Transaction successfully processed' }
  }

  /**
 * getApplicaitonInterface() method acts as an interface between Shardus core and Application
 * It validates the implementation of Shardus Application Interface
 * @param {Application} Application running on Shardus network
 * @returns {applicationInterfaceImpl} Shardus application interface implementation
 * @throws {Exception} If the interface is not appropriately implemented
 */
  getApplicationInterface (application) {
    this.mainLogger.debug('Start of getApplicationInterfaces()')
    let applicationInterfaceImpl = {}
    try {
      if (application == null) {
        // throw new Error('Invalid Application Instance')
        return null
      }

      // Required Methods:
      if (typeof (application.validateTransaction) === 'function') {
        applicationInterfaceImpl.validateTransaction = async (inTx) => application.validateTransaction(inTx)
      } else {
        throw new Error('Missing requried interface function. validateTransaction()')
      }

      if (typeof (application.apply) === 'function') {
        applicationInterfaceImpl.apply = async (inTx, receipt) => application.apply(inTx, receipt)
      } else {
        throw new Error('Missing requried interface function. apply()')
      }

      if (typeof (application.getKeyFromTransaction) === 'function') {
        applicationInterfaceImpl.getKeyFromTransaction = application.getKeyFromTransaction
      } else {
        throw new Error('Missing requried interface function. getKeysFromTransaction()')
      }

      if (typeof (application.getStateId) === 'function') {
        applicationInterfaceImpl.getStateId = async (accountAddress) => application.getStateId(accountAddress)
      } else {
        throw new Error('Missing requried interface function. getStateId()')
      }

      // opitonal methods
      if (typeof (application.close) === 'function') {
        applicationInterfaceImpl.close = async () => application.close()
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }
      if (typeof (application.handleHttpRequest) === 'function') {
        applicationInterfaceImpl.handleHttpRequest = async (httpMethod, uri, req, res) => application.handleHttpRequest(httpMethod, uri, req, res)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }

      // TEMP endpoints for workaround. delete this later.
      if (typeof (application.onAccounts) === 'function') {
        applicationInterfaceImpl.onAccounts = async (req, res) => application.onAccounts(req, res)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }

      if (typeof (application.onGetAccount) === 'function') {
        applicationInterfaceImpl.onGetAccount = async (req, res) => application.onGetAccount(req, res)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }
    } catch (ex) {
      this.fatalLogger.log(`Required application interface not implemented. Exception: ${ex}`)
      throw new Error(ex)
    }
    this.mainLogger.debug('End of getApplicationInterfaces()')
    return applicationInterfaceImpl
  }

  async catchAllHandler (method, path, req, res) {
    // console.log('shardus catch all: ' + method + ' ' + path)
    if (this.app.handleHttpRequest) {
      this.app.handleHttpRequest(method, path, req, res)
    }
  }

  async start () {
    await this.storage.init()
    this._setupHeartbeat()
    this.crypto = new Crypto(this.logger, this.storage)
    await this.crypto.init()
    const { ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay } = this.config
    const ipInfo = this.config.ip
    const p2pConf = { ipInfo, ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay }
    this.p2p = new P2P(p2pConf, this.logger, this.storage, this.crypto, this.network)
    await this.p2p.init()

    this.consensus = new Consensus(this.config, this.logger, this.crypto, this.p2p, this.storage, null, this.app)

    this._registerRoutes()

    let started
    try {
      started = await this.p2p.startup()
    } catch (e) {
      throw new Error(e)
    }
    if (!started) await this.shutdown()
  }

  async shutdown () {
    try {
      await this.exitHandler.exitCleanly()
    } catch (e) {
      throw e
    }
  }
}

module.exports = Shardus
