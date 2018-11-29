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

    this.heartbeatInterval = config.heartbeatInterval
    this.heartbeatTimer = null

    // alias the network register calls so that an app can get to them
    this.registerExternalGet = this.network.registerExternalGet
    this.registerExternalPost = this.network.registerExternalPost

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
      if (this.app.close) {
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
   * Temp external API
   * ToDo:- Will need to be moved accordingly after the network refactor
   */

  _tempRegisterAPI () {
    this.mainLogger.debug('Registring External API. Temporary...')

    this.network.registerExternalPost('inject', async (req, res) => {
      console.log(`Request=${JSON.stringify(req.body)}`)
      // await this.injectTransaction(req, res)
      await this.app.handleHttpRequest('post', '/inject', req, res) // method?
    })

    // super hack!
    this.network.registerExternalGet('nodes', async (req, res) => {
      res.json({ nodes: [{ id: 1, ip: '127.0.0.1', port: '9001' }], success: true })
    })

    this.network.registerExternalGet('accounts', async (req, res) => {
      await this.app.onAccounts(req, res)
    })
    this.network.registerExternalGet('account/:id', async (req, res) => {
      await this.app.onGetAccount(req, res)
    })
    this.mainLogger.debug('Done Registring External API. Temporary...')
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
      this.crypto.sign(shardusTransaction)
      this.mainLogger.debug(`ShardusTransaction: ${shardusTransaction}`)

      // Validate transaction through the application. Shardus can see inside the transaction
      let transactionValidateResult = await this.app.validateTransaction(inTransaction)
      if (transactionValidateResult.result !== 'pass') {
        this.mainLogger.error(`Failed to validate transaction. Reason: ${transactionValidateResult.reason}`)
        return { success: false, reason: transactionValidateResult.reason }
      }
      this.mainLogger.debug('Transaction Valided')
      // Perform Consensus -- Currently no algorithm is being used
      // let nodeList = await this.storage.getNodes()
      let consensus = new Consensus(this.config, this.logger, this.crypto, this.p2p, this.storage, null, this.app)
      // let transactionReceipt = await consensus.inject(inTransaction)
      let transactionReceipt = await consensus.inject(shardusTransaction)
      this.mainLogger.debug(`Received Consensus. Receipt: ${JSON.stringify(transactionReceipt)}`)
      // Apply the transaction
      await this.app.apply(inTransaction, transactionReceipt)

      // TODO///////////////////////
      // //////Broadcast reciept to other nodes in the list?  (possibly do that in consensus.inject() instead )
      // //////////////////////////
    } catch (ex) {
      this.fatalLogger.fatal(`Failed to process transaction. Exception: ${ex}`)
      return { success: false, reason: `Failed to process trasnaction: ${JSON.parse(inTransaction)} ${ex}` }
    }
    this.mainLogger.debug(`End of injectTransaction ${inTransaction}`)
    return { success: true, reason: 'Transaction successfully processed' }
  }

  // TODO , register and an internal endpoint so that something can call this
  async onReceipt (receipt, shardusTransaction) {
    this.mainLogger.debug(`Start of onReciept`)
    let transaction = shardusTransaction.inTransaction
    // retrieve incoming transaction from HTTP request
    try {
      if (typeof transaction !== 'object') {
        return false
      }
      // TODO! validate that reciept is sign by a valid node in the network
      if (this.crypto.verify(receipt.sign.owner) === false) {
        return false
      }

      // check that the tx hash matches the receipt
      let txhash = this.crypto.hash(transaction) // todo use this instead: cryptoRaw.hashObj(transaction)
      if (txhash !== receipt.txHash) {
        return false
      }

      await this.app.apply(transaction, receipt)
    } catch (ex) {
      this.fatalLogger.fatal(`Failed to process receipt. Exception: ${ex}`)
    }
    this.mainLogger.debug(`End of onReceipt`)
    return true
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
    if (this.applicationInterfaceImpl.handleHttpRequest) {
      this.applicationInterfaceImpl.handleHttpRequest(method, path, req, res)
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
    this._registerRoutes()
    // this._tempRegisterAPI()
    this.network._registerCatchAll()
    this.network.setExternalCatchAll(async (method, path, req, res) => this.catchAllHandler(method, path, req, res))

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
