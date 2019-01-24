const Logger = require('../logger')
const ExitHandler = require('../exit-handler')
const P2P = require('../p2p')
const Crypto = require('../crypto')
const Storage = require('../storage')
const Network = require('../network')
const utils = require('../utils')
const Consensus = require('../consensus')
const Reporter = require('../reporter')
const Profiler = require('../utils/profiler.js')
const allZeroes64 = '0'.repeat(64)

class Shardus {
  constructor ({ server: config, logs: logsConfig, storage: storageConfig }) {
    this.profiler = new Profiler()
    this.config = config
    this.verboseLogs = false
    this.logger = new Logger(config.baseDir, logsConfig)
    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.exitHandler = new ExitHandler()
    this.storage = new Storage(config.baseDir, storageConfig, this.logger, this.profiler)
    this.crypto = {}
    this.network = new Network(config.network, this.logger)
    this.p2p = {}
    this.consensus = {}
    this.appProvided = null
    this.app = null
    this.accountUtility = null
    this.reporter = null

    this.heartbeatInterval = config.heartbeatInterval
    this.heartbeatTimer = null

    if (this.mainLogger && ['TRACE'].includes(this.mainLogger.level.levelStr)) {
      this.verboseLogs = true
    }

    // alias the network register calls so that an app can get to them
    this.registerExternalGet = (route, handler) => this.network.registerExternalGet(route, handler)
    this.registerExternalPost = (route, handler) => this.network.registerExternalPost(route, handler)
    this.registerExternalPut = (route, handler) => this.network.registerExternalPut(route, handler)
    this.registerExternalDelete = (route, handler) => this.network.registerExternalDelete(route, handler)
    this.registerExternalPatch = (route, handler) => this.network.registerExternalPatch(route, handler)

    this.exitHandler.addSigListeners()
    this.exitHandler.registerSync('reporter', () => {
      if (this.reporter) {
        this.reporter.stopReporting()
      }
    })
    this.exitHandler.registerSync('p2p', () => {
      if (this.p2p) {
        this.p2p.cleanupSync()
      }
    })
    this.exitHandler.registerSync('shardus', () => {
      this.stopHeartbeat()
    })
    this.exitHandler.registerSync('crypto', () => {
      this.crypto.stopAllGenerators()
    })
    this.exitHandler.registerAsync('network', () => {
      this.mainLogger.info('Shutting down networking...')
      return this.network.shutdown()
    })
    this.exitHandler.registerAsync('shardus', () => {
      this.mainLogger.info('Writing heartbeat to database before exiting...')
      return this.writeHeartbeat()
    })
    this.exitHandler.registerAsync('storage', () => {
      return this.storage.close()
    })
    this.exitHandler.registerAsync('application', () => {
      this.mainLogger.info('Closing the application...')
      if (this.app && this.app.close) {
        return this.app.close()
      }
    })
    this.exitHandler.registerAsync('logger', () => {
      return this.logger.shutdown()
    })

    this.logger.playbackLogState('constructed', '', '')
  }

  _registerRoutes () {
    this.network.registerExternalPost('exit', async (req, res) => {
      res.json({ success: true })
      await this.shutdown()
    })
    if (this.appProvided) this._registerSyncEndpoints()
  }

  registerExceptionHandler () {
    process.on('uncaughtException', async (err) => {
      this.fatalLogger.fatal('uncaughtException: ' + err.name + ': ' + err.message + ' at ' + err.stack)
      try {
        await this.exitHandler.exitCleanly()
      } catch (e) {
        console.error('uncaughtException: ' + e.name + ': ' + e.message + ' at ' + e.stack)
        process.exit(1)
      }
    })
  }

  async writeHeartbeat () {
    const timestamp = utils.getTime('s')
    await this.storage.setProperty('heartbeat', timestamp)
  }

  _setupHeartbeat () {
    this.heartbeatTimer = setInterval(async () => {
      await this.writeHeartbeat()
    }, this.heartbeatInterval * 1000)
  }

  stopHeartbeat () {
    this.mainLogger.info('Stopping heartbeat...')
    clearInterval(this.heartbeatTimer)
  }

  setup (app) {
    if (app === null) {
      this.appProvided = false
    } else if (app === Object(app)) {
      this.accountUtility = this.getAccountUtilityInterface(app)
      this.app = this.getApplicationInterface(app)
      this.appProvided = true
      this.logger.playbackLogState('appProvided', '', '')
    } else {
      throw new Error('Please provide an App object or null to Shardus.setup.')
    }
    return this
  }

  isTransactionTimestampExpired (txnTimestamp) {
    // this.mainLogger.debug(`Start of isTransactionTimestampExpired(${txnTimestamp})`)
    let transactionExpired = false
    const txnExprationTime = this.config.transactionExpireTime
    const currNodeTimestamp = Date.now()

    const txnAge = currNodeTimestamp - txnTimestamp
    this.mainLogger.debug(`Transaction Timestamp: ${txnTimestamp} CurrNodeTimestamp: ${currNodeTimestamp}
    txnExprationTime: ${txnExprationTime}   TransactionAge: ${txnAge}`)

    // this.mainLogger.debug(`TransactionAge: ${txnAge}`)
    if (txnAge >= (txnExprationTime * 1000)) {
      this.fatalLogger.error(`Transaction Expired`)
      transactionExpired = true
    }
    // this.mainLogger.debug(`End of isTransactionTimestampExpired(${txnTimestamp})`)
    return transactionExpired
  }

  /**
   * Handle incoming tranaction requests
   */

  async put (req, res) {
    let transactionOk = false
    if (this.reporter) this.reporter.incrementTxInjected()

    if (!this.appProvided) throw new Error('Please provide an App object to Shardus.setup before calling Shardus.put')
    if (this.verboseLogs) this.mainLogger.debug(`Start of injectTransaction ${JSON.stringify(req.body)}`) // not reducing tx here so we can get the long hashes
    // retrieve incoming transaction from HTTP request
    let inTransaction = req.body
    let shardusTransaction = {}
    let ourLock = -1
    try {
      if (typeof inTransaction !== 'object') {
        return { success: false, reason: `Invalid Transaction! ${utils.stringifyReduce(inTransaction)}` }
      }
      /**
       * Perform basic validation of the transaction fields. Also, validate the transaction timestamp
       */
      if (this.verboseLogs) this.mainLogger.debug(`Performing initial validation of the transaction`)
      const initValidationResp = this.app.validateTxnFields(inTransaction)
      if (this.verboseLogs) this.mainLogger.debug(`InitialValidationResponse: ${utils.stringifyReduce(initValidationResp)}`)

      const txnTimestamp = initValidationResp.txnTimestamp
      if (this.isTransactionTimestampExpired(txnTimestamp)) {
        this.fatalLogger.fatal(`Transaction Expired: ${utils.stringifyReduce(inTransaction)}`)
        return { success: false, reason: 'Transaction Expired' }
      }

      /**
       * {txnReceivedTimestamp, sign, inTxn:{srcAct, tgtAct, tnxAmt, txnType, seqNum, txnTimestamp, signs}}
       * Timestamping the transaction of when the transaction was received. Sign the complete transaction
       * with the node SK
       * ToDo: Check with Omar if validateTransaction () methods needs receivedTimestamp and Node Signature
       */
      shardusTransaction.receivedTimestamp = Date.now()
      shardusTransaction.inTransaction = inTransaction

      let txId = this.crypto.hash(inTransaction)
      // QUEUE delay system...
      ourLock = await this.consensus.queueAndDelay(txnTimestamp, txId)

      this.profiler.profileSectionStart('put')

      if (this.verboseLogs) this.mainLogger.debug(`ShardusTransaction. shortTxID: ${txId} txID: ${utils.makeShortHash(txId)} TX data: ${utils.stringifyReduce(shardusTransaction)}`)

      // Validate transaction through the application. Shardus can see inside the transaction
      this.profiler.profileSectionStart('validateTx')
      let transactionValidateResult = await this.app.validateTransaction(inTransaction)
      this.profiler.profileSectionEnd('validateTx')
      if (transactionValidateResult.result !== 'pass') {
        this.mainLogger.error(`Failed to validate transaction. Reason: ${transactionValidateResult.reason}`)
        return { success: false, reason: transactionValidateResult.reason }
      }
      shardusTransaction = this.crypto.sign(shardusTransaction)

      if (this.verboseLogs) this.mainLogger.debug('Transaction Valided')
      // Perform Consensus -- Currently no algorithm is being used
      // let nodeList = await this.storage.getNodes()
      this.profiler.profileSectionStart('consensusInject')
      let transactionReceipt = await this.consensus.inject(shardusTransaction)
      this.profiler.profileSectionEnd('consensusInject')
      if (this.verboseLogs) this.mainLogger.debug(`Received Consensus. Receipt: ${utils.stringifyReduce(transactionReceipt)}`)
      // Apply the transaction
      this.profiler.profileSectionStart('acceptTx')
      transactionOk = await this.acceptTransaction(inTransaction, transactionReceipt, true)
      this.profiler.profileSectionEnd('acceptTx')
    } catch (ex) {
      this.fatalLogger.fatal(`Put: Failed to process transaction. Exception: ${ex}`)
      this.fatalLogger.fatal('put: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      return { success: false, reason: `Failed to process trasnaction: ${utils.stringifyReduce(inTransaction)} ${ex}` }
    } finally {
      // this.profiler.profileSectionEnd('acceptTx')
      // this.profiler.profileSectionEnd('validateTx')
      this.profiler.profileSectionEnd('put')
      this.consensus.unlockQueue(ourLock)
      if (!transactionOk) {
        this.mainLogger.debug('Transaction result failed: ' + utils.stringifyReduce(inTransaction))
      }
    }
    if (transactionOk) {
      this.mainLogger.debug('Transaction result ok: ' + utils.stringifyReduce(inTransaction))
    }
    if (this.verboseLogs) this.mainLogger.debug(`End of injectTransaction ${utils.stringifyReduce(inTransaction)}`)
    return { success: true, reason: 'Transaction successfully processed' }
  }

  async resetAppRelatedState () {
    await this.storage.clearAppRelatedState()
  }

  async acceptTransaction (tx, receipt, gossipTx = false) {
    this.profiler.profileSectionStart('acceptTx-teststate')
    let { success, hasStateTableData } = await this.testAccountStateTable(tx)
    let timestamp = tx.txnTimestamp
    if (!success) {
      let errorMsg = 'acceptTransaction ' + timestamp + ' failed. has state table data: ' + hasStateTableData
      console.log(errorMsg)
      throw new Error(errorMsg)
    }
    this.profiler.profileSectionEnd('acceptTx-teststate')

    this.profiler.profileSectionStart('acceptTx-apply')
    // app applies data
    let { stateTableResults, txId, txTimestamp } = await this.app.apply(tx)
    // TODO post enterprise:  the stateTableResults may need to be a map with keys so we can choose which one to actually insert in our accountStateTable
    this.profiler.profileSectionEnd('acceptTx-apply')

    if (this.reporter) this.reporter.incrementTxApplied()

    this.profiler.profileSectionStart('acceptTx-addAccepted')
    let txStatus = 1 // TODO m15: unhardcode this
    // store transaction in accepted table
    let acceptedTX = { id: txId, timestamp: txTimestamp, data: tx, status: txStatus, receipt: receipt }
    await this.storage.addAcceptedTransactions([acceptedTX])
    this.profiler.profileSectionEnd('acceptTx-addAccepted')

    // this.profiler.profileSectionStart('acceptTx-addAccepted3')
    // await this.storage.addAcceptedTransactions3(acceptedTX)
    // this.profiler.profileSectionEnd('acceptTx-addAccepted3')

    this.profiler.profileSectionStart('acceptTx-addState')
    // query app for account state (or return it from apply)
    // write entry into account state table (for each source or dest account in our shard)
    await this.storage.addAccountStates(stateTableResults)
    this.profiler.profileSectionEnd('acceptTx-addState')

    // await this.storage.addAccountStates2(stateTableResults)

    this.profiler.profileSectionStart('acceptTx-gossip')
    if (gossipTx) {
      // temporary implementaiton to share transactions
      this.p2p.sendGossipIn('acceptedTx', acceptedTX)
    }
    this.profiler.profileSectionEnd('acceptTx-gossip')

    return true
  }

  async testAccountStateTable (tx) {
    let keysResponse = this.app.getKeyFromTransaction(tx)
    let { sourceKeys, targetKeys } = keysResponse
    let sourceAddress, targetAddress, sourceState, targetState

    let timestamp = tx.txnTimestamp

    let hasStateTableData = false
    if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
      sourceAddress = sourceKeys[0]
      sourceState = await this.app.getStateId(sourceAddress)

      // let accountStates = await this.storage.queryAccountStateTable(sourceState, sourceState, timestamp, timestamp, 1)
      let accountStates = await this.storage.searchAccountStateTable(sourceAddress, timestamp)

      if (accountStates.length !== 0) {
        hasStateTableData = true
        if (accountStates.length === 0) {
          if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' missing source account state 1')
          if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' missing source account state 1')
          return { success: false, hasStateTableData }
        }

        if (accountStates.length === 0 || accountStates[0].stateBefore !== sourceState) {
          if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' cant apply state 1')
          if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' cant apply state 1')
          return { success: false, hasStateTableData }
        }
      }
    }
    if (Array.isArray(targetKeys) && targetKeys.length > 0) {
      targetAddress = targetKeys[0]
      // let accountStates = await this.storage.queryAccountStateTable(targetState, targetState, timestamp, timestamp, 1)
      let accountStates = await this.storage.searchAccountStateTable(targetAddress, timestamp)

      if (accountStates.length !== 0) {
        hasStateTableData = true
        if (accountStates.length === 0) {
          if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' missing target account state 2')
          if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' missing target account state 2')
          return { success: false, hasStateTableData }
        }
        if (accountStates.length !== 0 && accountStates[0].stateBefore !== allZeroes64) {
          targetState = await this.app.getStateId(targetAddress, false)
          if (targetState == null) {
            if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' target state does not exist, thats ok')
            if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' target state does not exist, thats ok')
          } else if (accountStates[0].stateBefore !== targetState) {
            if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' cant apply state 2')
            if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' cant apply state 2')
            return { success: false, hasStateTableData }
          }
        }
      }
      // todo post enterprise, only check this if it is in our address range
    }

    return { success: true, hasStateTableData }
  }

  // state ids should be checked before applying this transaction because it may have already been applied while we were still syncing data.
  async tryApplyTransaction (acceptedTX) {
    let tx = acceptedTX.data
    let receipt = acceptedTX.receipt
    let timestamp = tx.txnTimestamp // TODO m11: need to push this to application method thta cracks the transaction
    if (this.verboseLogs) console.log('tryApplyTransaction ' + timestamp)
    if (this.verboseLogs) this.mainLogger.debug('DATASYNC: tryApplyTransaction ' + timestamp)

    let { success, hasStateTableData } = await this.testAccountStateTable(tx)

    if (!success) {
      return // we failed
    }

    // test reciept state ids. some redundant queries that could be optimized!
    let keysResponse = this.app.getKeyFromTransaction(tx)
    let { sourceKeys, targetKeys } = keysResponse
    let sourceAddress, targetAddress, sourceState, targetState
    if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
      sourceAddress = sourceKeys[0]
      sourceState = await this.app.getStateId(sourceAddress)
      if (sourceState !== receipt.stateId) {
        if (this.verboseLogs) console.log('tryApplyTransaction source stateid does not match reciept. ts:' + timestamp + ' stateId: ' + sourceState + ' reciept: ' + receipt.stateId)
        if (this.verboseLogs) this.mainLogger.debug('DATASYNC: tryApplyTransaction source stateid does not match reciept. ts:' + timestamp + ' stateId: ' + sourceState + ' reciept: ' + receipt.stateId)
        return
      }
    }
    if (Array.isArray(targetKeys) && targetKeys.length > 0) {
      targetAddress = targetKeys[0]
      targetState = await this.app.getStateId(targetAddress, false)
      if (targetState !== receipt.targetStateId) {
        if (this.verboseLogs) console.log('tryApplyTransaction target stateid does not match reciept. ts:' + timestamp + ' stateId: ' + targetState + ' reciept: ' + receipt.targetStateId)
        if (this.verboseLogs) this.mainLogger.debug('DATASYNC: tryApplyTransaction target stateid does not match reciept. ts:' + timestamp + ' stateId: ' + targetState + ' reciept: ' + receipt.targetStateId)
        return
      }
    }

    if (this.verboseLogs) console.log('tryApplyTransaction ' + timestamp + ' Applying!')
    if (this.verboseLogs) this.mainLogger.debug('DATASYNC: tryApplyTransaction ' + timestamp + ' Applying!')
    let { stateTableResults } = await this.app.apply(tx)
    // only write our state table data if we dont already have it in the db
    if (hasStateTableData === false) {
      await this.storage.addAccountStates(stateTableResults)
      for (let stateT of stateTableResults) {
        if (this.verboseLogs) console.log('writeStateTable ' + stateT.accountId)
        if (this.verboseLogs) this.mainLogger.debug('DATASYNC: writeStateTable ' + stateT.accountId)
      }
    }

    // post validate that state ended up correctly?

    // write the accepted TX to storage
    this.storage.addAcceptedTransactions([acceptedTX])
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

      if (typeof (application.validateTxnFields) === 'function') {
        applicationInterfaceImpl.validateTxnFields = (inTx) => application.validateTxnFields(inTx)
      } else {
        throw new Error('Missing requried interface function. validateTxnFields()')
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
        applicationInterfaceImpl.getStateId = async (accountAddress, mustExist) => application.getStateId(accountAddress, mustExist)
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

      // App.get_account_data (Acc_start, Acc_end, Max_records)
      // Provides the functionality defined for /get_accounts API
      // Max_records - limits the number of records returned
      if (typeof (application.onGetAccount) === 'function') {
        applicationInterfaceImpl.getAccountData = async (accountStart, accountEnd, maxRecords) => application.getAccountData(accountStart, accountEnd, maxRecords)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }
      // App.set_account_data (Acc_records)
      // Acc_records - as provided by App.get_accounts
      // Stores the records into the Accounts table if the hash of the Acc_data matches State_id
      // Returns a list of failed Acc_id
      if (typeof (application.onGetAccount) === 'function') {
        applicationInterfaceImpl.setAccountData = async (accountRecords) => application.setAccountData(accountRecords)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }

      if (typeof (application.onGetAccount) === 'function') {
        applicationInterfaceImpl.getAccountDataByList = async (addressList) => application.getAccountDataByList(addressList)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }
    } catch (ex) {
      this.fatalLogger.fatal(`Required application interface not implemented. Exception: ${ex}`)
      this.fatalLogger.fatal('getApplicationInterface: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      throw new Error(ex)
    }
    this.mainLogger.debug('End of getApplicationInterfaces()')
    return applicationInterfaceImpl
  }

  getAccountUtilityInterface (application) {
    this.mainLogger.debug('Start of getApplicationInterfaces()')
    let accountUtilityInterface = {}
    try {
      if (application == null) {
        // throw new Error('Invalid Application Instance')
        return null
      }

      // App.set_account_data (Acc_records)
      // Acc_records - as provided by App.get_accounts
      // Stores the records into the Accounts table if the hash of the Acc_data matches State_id
      // Returns a list of failed Acc_id
      if (typeof (application.onGetAccount) === 'function') {
        accountUtilityInterface.setAccountData = async (accountRecords) => application.setAccountData(accountRecords)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }
      if (typeof (application.deleteLocalAccountData) === 'function') {
        accountUtilityInterface.deleteLocalAccountData = async () => application.deleteLocalAccountData()
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }

      if (typeof (this.acceptTransaction) === 'function') {
        accountUtilityInterface.acceptTransaction = async (tx, receipt) => this.acceptTransaction(tx, receipt)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }
      if (typeof (this.tryApplyTransaction) === 'function') {
        accountUtilityInterface.tryApplyTransaction = async (acceptedTX) => this.tryApplyTransaction(acceptedTX)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }
      if (typeof (this.getAccountsStateHash) === 'function') {
        accountUtilityInterface.getAccountsStateHash = async (accountStart, accountEnd, tsStart, tsEnd) => this.getAccountsStateHash(accountStart, accountEnd, tsStart, tsEnd)
      } else {
        // throw new Error('Missing requried interface function. apply()')
      }
    } catch (ex) {
      this.fatalLogger.fatal(`Required application interface not implemented. Exception: ${ex}`)
      this.fatalLogger.fatal('getAccountUtilityInterface: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      throw new Error(ex)
    }
    this.mainLogger.debug('End of getApplicationInterfaces()')
    return accountUtilityInterface
  }

  async start (exitProcOnFail = true) {
    if (this.appProvided === null) throw new Error('Please call Shardus.setup with an App object or null before calling Shardus.start.')
    await this.storage.init()
    this._setupHeartbeat()
    this.crypto = new Crypto(this.config.crypto, this.logger, this.storage)
    await this.crypto.init()
    const { ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay, gossipRecipients, gossipTimeout, maxNodesPerCycle } = this.config
    const ipInfo = this.config.ip
    const p2pConf = { ipInfo, ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay, gossipRecipients, gossipTimeout, maxNodesPerCycle }
    this.p2p = new P2P(p2pConf, this.logger, this.storage, this.crypto, this.network, this.accountUtility)
    await this.p2p.init()

    this.reporter = this.config.reporting.report ? new Reporter(this.config.reporting, this.logger, this.p2p, this, this.profiler) : null
    this.consensus = new Consensus(this.accountUtility, this.config, this.logger, this.crypto, this.p2p, this.storage, null, this.app, this.reporter, this.profiler)

    this._registerRoutes()

    // this.storage.queryAccountStateTable2('0'.repeat(64), 'f'.repeat(64), 0, Date.now())

    let started
    try {
      started = await this.p2p.startup()
      this.consensus.consensusActive = true
      if (this.p2p.dataSync != null) {
        // await this.p2p.dataSync.finalTXCatchup(false)
        await utils.sleep(3000)
        await this.p2p.dataSync.finalTXCatchup(true)
        // should we keep trying to catch up untill it returns false? ... i think so since we will reject and lose TXs for now.
        await utils.sleep(3000)
        await this.p2p.dataSync.enableSyncCheck()
      }
    } catch (e) {
      console.log(e.message + ' at ' + e.stack)
      this.mainLogger.debug('sharuds.start() ' + e.message + ' at ' + e.stack)
      this.fatalLogger.fatal('sharuds.start() ' + e.message + ' at ' + e.stack)
      throw new Error(e)
    }
    if (!started) await this.shutdown(exitProcOnFail)
    if (this.reporter) this.reporter.startReporting()
  }

  async shutdown (exitProcess = true) {
    try {
      await this.exitHandler.exitCleanly(exitProcess)
    } catch (e) {
      throw e
    }
  }

  async getAccountsStateHash (accountStart = '0'.repeat(64), accountEnd = 'f'.repeat(64), tsStart = 0, tsEnd = Date.now()) {
    const accountStates = await this.storage.queryAccountStateTable(accountStart, accountEnd, tsStart, tsEnd, 100000000)
    const stateHash = this.crypto.hash(accountStates)
    return stateHash
  }

  // ---------------------App sync code-----------------------
  _registerSyncEndpoints () {
    //    /get_account_state_hash (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns a single hash of the data from the Account State Table determined by the input parameters; sort by Tx_ts  then Tx_id before taking the hash
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state_hash', async (payload, respond) => {
      let result = {}

      // yikes need to potentially hash only N records at a time and return an array of hashes
      let stateHash = await this.getAccountsStateHash(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd)
      result.stateHash = stateHash
      await respond(result)
    })

    //    /get_account_state (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns data from the Account State Table determined by the input parameters; limits result to 1000 records (as configured)
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state', async (payload, respond) => {
      let result = {}
      // max records set artificially low for better test coverage
      // todo m11: make configs for how many records to query
      let accountStates = await this.storage.queryAccountStateTable(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd, 10)
      result.accountStates = accountStates
      await respond(result)
    })

    // /get_accpeted_transactions (Ts_start, Ts_end)
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns data from the Accepted Tx Table starting with Ts_start; limits result to 500 records (as configured)
    // Updated names: tsStart, tsEnd
    this.p2p.registerInternal('get_accpeted_transactions', async (payload, respond) => {
      let result = {}

      if (!payload.limit) {
        payload.limit = 10
      }
      let transactions = await this.storage.queryAcceptedTransactions(payload.tsStart, payload.tsEnd, payload.limit)
      result.transactions = transactions
      await respond(result)
    })

    //     /get_account_data (Acc_start, Acc_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Returns data from the application Account Table; limits result to 300 records (as configured);
    // For applications with multiple “Account” tables the returned data is grouped by table name.
    // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // Updated names:  accountStart , accountEnd
    this.p2p.registerInternal('get_account_data', async (payload, respond) => {
      let result = {}

      let accountData = await this.app.getAccountData(payload.accountStart, payload.accountEnd, payload.maxRecords)
      result.accountData = accountData
      await respond(result)
    })

    // /get_account_data_by_list (Acc_ids)
    // Acc_ids - array of accounts to get
    // Returns data from the application Account Table for just the given account ids;
    // For applications with multiple “Account” tables the returned data is grouped by table name.
    // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // Updated names:  accountIds, max records
    this.p2p.registerInternal('get_account_data_by_list', async (payload, respond) => {
      let result = {}
      let accountData = await this.app.getAccountDataByList(payload.accountIds)
      result.accountData = accountData
      await respond(result)
    })
  }

  createApplyResponse (txId, txTimestamp) {
    let replyObject = { stateTableResults: [], txId, txTimestamp }
    return replyObject
  }

  applyResponseAddState (resultObject, accountId, txId, txTimestamp, stateBefore, stateAfter, accountCreated) {
    let state = { accountId, txId, txTimestamp, stateBefore, stateAfter }
    if (accountCreated) {
      state.stateBefore = allZeroes64
    }
    resultObject.stateTableResults.push(state)
  }
}

module.exports = Shardus
