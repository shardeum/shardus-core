const Logger = require('../logger')
const ExitHandler = require('../exit-handler')
const P2P = require('../p2p')
const Crypto = require('../crypto')
const Storage = require('../storage')
const Network = require('../network')
const utils = require('../utils')
const Consensus = require('../consensus')
const Reporter = require('../reporter')
const Debug = require('../debug')
const StateManager = require('../state-manager')
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
    this.debug = {}
    this.appProvided = null
    this.app = null
    this.reporter = null
    this.stateManager = null

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

  async acceptTransaction (tx, receipt, gossipTx = false, dontAllowStateTableData = false) {
    if (this.verboseLogs) this.mainLogger.debug(`acceptTransaction start ${tx.txnTimestamp}`)
    this.profiler.profileSectionStart('acceptTx-teststate')
    let { success, hasStateTableData } = await this.testAccountStateTable(tx)
    let timestamp = tx.txnTimestamp
    if (!success) {
      let errorMsg = 'acceptTransaction ' + timestamp + ' failed. has state table data: ' + hasStateTableData
      console.log(errorMsg)
      throw new Error(errorMsg)
    }

    if (dontAllowStateTableData && hasStateTableData) {
      if (this.verboseLogs) this.mainLogger.debug(`acceptTransaction exit because we have state table data ${tx.timestamp}`)
      return
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
    if (this.verboseLogs) {
      for (let stateT of stateTableResults) {
        this.mainLogger.debug('acceptTransaction: writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter))
      }
    }

    await this.storage.addAccountStates(stateTableResults)
    this.profiler.profileSectionEnd('acceptTx-addState')

    // await this.storage.addAccountStates2(stateTableResults)

    this.profiler.profileSectionStart('acceptTx-gossip')
    if (gossipTx) {
      // temporary implementaiton to share transactions
      this.p2p.sendGossipIn('acceptedTx', acceptedTX)
    }
    this.profiler.profileSectionEnd('acceptTx-gossip')

    if (this.verboseLogs) this.mainLogger.debug(`acceptTransaction end ${tx.txnTimestamp}`)
    return true
  }

  async testAccountStateTable (tx) {
    let hasStateTableData = false
    try {
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { sourceKeys, targetKeys } = keysResponse
      let sourceAddress, targetAddress, sourceState, targetState

      let timestamp = tx.txnTimestamp

      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
        // let accountStates = await this.storage.queryAccountStateTable(sourceState, sourceState, timestamp, timestamp, 1)
        let accountStates = await this.storage.searchAccountStateTable(sourceAddress, timestamp)
        if (accountStates.length !== 0) {
          sourceState = await this.app.getStateId(sourceAddress)
          hasStateTableData = true
          // if (accountStates.length === 0) {
          //   if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' missing source account state 1')
          //   if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' missing source account state 1')
          //   return { success: false, hasStateTableData }
          // }

          if (accountStates.length === 0 || accountStates[0].stateBefore !== sourceState) {
            if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' cant apply state 1')
            if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' cant apply state 1 stateId: ' + utils.makeShortHash(sourceState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(sourceAddress))
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
          // if (accountStates.length === 0) {
          //   if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' missing target account state 2')
          //   if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' missing target account state 2')
          //   return { success: false, hasStateTableData }
          // }
          if (accountStates.length !== 0 && accountStates[0].stateBefore !== allZeroes64) {
            targetState = await this.app.getStateId(targetAddress, false)
            if (targetState == null) {
              if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' target state does not exist, thats ok')
              if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' target state does not exist, thats ok')
            } else if (accountStates[0].stateBefore !== targetState) {
              if (this.verboseLogs) console.log('testAccountStateTable ' + timestamp + ' cant apply state 2')
              if (this.verboseLogs) this.mainLogger.debug('DATASYNC: testAccountStateTable ' + timestamp + ' cant apply state 2 stateId: ' + utils.makeShortHash(targetState) + ' stateTable: ' + utils.makeShortHash(accountStates[0].stateBefore) + ' address: ' + utils.makeShortHash(targetAddress))
              return { success: false, hasStateTableData }
            }
          }
        }
      // todo post enterprise, only check this if it is in our address range
      }
    } catch (ex) {
      this.fatalLogger.fatal('testAccountStateTable failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    }

    return { success: true, hasStateTableData }
  }

  // state ids should be checked before applying this transaction because it may have already been applied while we were still syncing data.
  async tryApplyTransaction (acceptedTX) {
    let ourLock = -1
    try {
      let tx = acceptedTX.data
      let receipt = acceptedTX.receipt
      let timestamp = tx.txnTimestamp // TODO m11: need to push this to application method thta cracks the transaction

      // QUEUE delay system...
      ourLock = await this.consensus.queueAndDelay(timestamp, receipt.txHash)

      if (this.verboseLogs) console.log('tryApplyTransaction ' + timestamp)
      if (this.verboseLogs) this.mainLogger.debug('DATASYNC: tryApplyTransaction ' + timestamp)

      let { success, hasStateTableData } = await this.testAccountStateTable(tx)

      if (!success) {
        return false// we failed
      }

      // test reciept state ids. some redundant queries that could be optimized!
      let keysResponse = this.app.getKeyFromTransaction(tx)
      let { sourceKeys, targetKeys } = keysResponse
      let sourceAddress, targetAddress, sourceState, targetState
      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
        sourceState = await this.app.getStateId(sourceAddress)
        if (sourceState !== receipt.stateId) {
          if (this.verboseLogs) console.log('tryApplyTransaction source stateid does not match reciept. ts:' + timestamp + ' stateId: ' + sourceState + ' receipt: ' + receipt.stateId + ' address: ' + sourceAddress)
          if (this.verboseLogs) this.mainLogger.debug('DATASYNC: tryApplyTransaction source stateid does not match reciept. ts:' + timestamp + ' stateId: ' + sourceState + ' receipt: ' + receipt.stateId + ' address: ' + sourceAddress)
          return false
        }
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        targetAddress = targetKeys[0]
        targetState = await this.app.getStateId(targetAddress, false)
        if (targetState !== receipt.targetStateId) {
          if (this.verboseLogs) console.log('tryApplyTransaction target stateid does not match reciept. ts:' + timestamp + ' stateId: ' + targetState + ' receipt: ' + receipt.targetStateId + ' address: ' + targetAddress)
          if (this.verboseLogs) this.mainLogger.debug('DATASYNC: tryApplyTransaction target stateid does not match reciept. ts:' + timestamp + ' stateId: ' + targetState + ' receipt: ' + receipt.targetStateId + ' address: ' + targetAddress)
          return false
        }
      }

      if (this.verboseLogs) console.log('tryApplyTransaction ' + timestamp + ' Applying!')
      if (this.verboseLogs) this.mainLogger.debug('DATASYNC: tryApplyTransaction ' + timestamp + ' Applying!' + ' source: ' + utils.makeShortHash(sourceAddress) + ' target: ' + utils.makeShortHash(targetAddress) + ' srchash_before:' + utils.makeShortHash(sourceState) + ' tgtHash_before: ' + utils.makeShortHash(targetState))
      let { stateTableResults } = await this.app.apply(tx)
      // only write our state table data if we dont already have it in the db
      if (hasStateTableData === false) {
        for (let stateT of stateTableResults) {
          if (this.verboseLogs) console.log('writeStateTable ' + utils.makeShortHash(stateT.accountId))
          if (this.verboseLogs) this.mainLogger.debug('DATASYNC: writeStateTable ' + utils.makeShortHash(stateT.accountId) + ' before: ' + utils.makeShortHash(stateT.stateBefore) + ' after: ' + utils.makeShortHash(stateT.stateAfter))
        }
        await this.storage.addAccountStates(stateTableResults)
      }

      // post validate that state ended up correctly?

      // write the accepted TX to storage
      this.storage.addAcceptedTransactions([acceptedTX])
    } catch (ex) {
      this.fatalLogger.fatal('tryApplyTransaction failed: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      return false
    } finally {
      this.consensus.unlockQueue(ourLock)
    }
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
      if (typeof (application.deleteLocalAccountData) === 'function') {
        applicationInterfaceImpl.deleteLocalAccountData = async () => application.deleteLocalAccountData()
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

  async start (exitProcOnFail = true) {
    if (this.appProvided === null) throw new Error('Please call Shardus.setup with an App object or null before calling Shardus.start.')
    await this.storage.init()
    this._setupHeartbeat()
    this.crypto = new Crypto(this.config.crypto, this.logger, this.storage)
    await this.crypto.init()
    const { ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay, gossipRecipients, gossipTimeout, maxNodesPerCycle } = this.config
    const ipInfo = this.config.ip
    const p2pConf = { ipInfo, ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay, gossipRecipients, gossipTimeout, maxNodesPerCycle }
    this.p2p = new P2P(p2pConf, this.logger, this.storage, this.crypto, this.network, this.app, this)
    await this.p2p.init()
    this.debug = new Debug(this.config.baseDir, this.logger, this.storage, this.network)
    await this.debug.init()

    this.stateManager = this.app ? new StateManager(this.app, this, this.logger, this.storage, this.p2p, this.crypto) : null
    this.reporter = this.config.reporting.report ? new Reporter(this.config.reporting, this.logger, this.p2p, this, this.profiler) : null
    this.consensus = new Consensus(this.app, this, this.config, this.logger, this.crypto, this.p2p, this.storage, this.reporter, this.profiler)

    this._registerRoutes()

    this.p2p.on('failed', () => {
      this.shutdown(exitProcOnFail)
    })

    this.p2p.on('error', (e) => {
      console.log(e.message + ' at ' + e.stack)
      this.mainLogger.debug('shardus.start() ' + e.message + ' at ' + e.stack)
      this.fatalLogger.fatal('shardus.start() ' + e.message + ' at ' + e.stack)
      throw new Error(e)
    })

    await this.p2p.startup()
    if (this.stateManager) await this.stateManager.syncStateData(3)
    await this.p2p.goActive()
    console.log('Server ready!')
    if (this.stateManager) {
      await this.stateManager.finalTXCatchup(false)
      await utils.sleep(3000)
      await this.stateManager.finalTXCatchup(true)
      await utils.sleep(3000)
      this.stateManager.enableSyncCheck()
    }
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
