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
const Statistics = require('../statistics')
const LoadDetection = require('../load-detection')
const RateLimiting = require('../rate-limiting')
const Profiler = require('../utils/profiler.js')
const allZeroes64 = '0'.repeat(64)
const path = require('path')
const EventEmitter = require('events')
const saveConsoleOutput = require('./saveConsoleOutput')

class Shardus extends EventEmitter {
  constructor ({ server: config, logs: logsConfig, storage: storageConfig }) {
    super()
    this.profiler = new Profiler()
    this.config = config
    this.verboseLogs = false
    this.logger = new Logger(config.baseDir, logsConfig)

    if (logsConfig.saveConsoleOutput) {
      saveConsoleOutput.startSaving(path.join(config.baseDir, logsConfig.dir))
    }

    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.appLogger = this.logger.getLogger('app')
    this.exitHandler = new ExitHandler()
    this.storage = new Storage(config.baseDir, storageConfig, this.logger, this.profiler)
    this.crypto = null
    this.network = new Network(config.network, this.logger)
    this.p2p = null
    this.debug = null
    this.consensus = null
    this.appProvided = null
    this.app = null
    this.reporter = null
    this.stateManager = null
    this.statistics = null
    this.loadDetection = null
    this.rateLimiting = null

    this.mainLogger.log(`Server started with pid: ${process.pid}`)

    this.mainLogger.log(`===== Server config: =====`)
    this.mainLogger.log(JSON.stringify(config, null, 2))

    this._listeners = {}

    this.heartbeatInterval = config.heartbeatInterval
    this.heartbeatTimer = null

    // levelStr not correctly defined in logger type definition, so ignore it
    // @ts-ignore
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
      this._stopHeartbeat()
    })
    this.exitHandler.registerSync('crypto', () => {
      this.crypto.stopAllGenerators()
    })
    this.exitHandler.registerAsync('network', async () => {
      this.mainLogger.info('Shutting down networking...')
      await this.network.shutdown()
    })
    this.exitHandler.registerAsync('shardus', async () => {
      this.mainLogger.info('Writing heartbeat to database before exiting...')
      await this._writeHeartbeat()
    })
    this.exitHandler.registerAsync('storage', async () => {
      this.mainLogger.info('Closing Database connections...')
      await this.storage.close()
    })
    this.exitHandler.registerAsync('application', async () => {
      if (this.app && this.app.close) {
        this.mainLogger.info('Shutting down the application...')
        await this.app.close()
      }
    })
    this.exitHandler.registerAsync('logger', async () => {
      this.mainLogger.info('Shutting down logs...')
      await this.logger.shutdown()
    })

    this.logger.playbackLogState('constructed', '', '')
  }

  /**
   * @typedef {import('./index').App} App
   */

  setup (app) {
    if (app === null) {
      this.appProvided = false
    } else if (app === Object(app)) {
      this.app = this._getApplicationInterface(app)
      this.appProvided = true
      this.logger.playbackLogState('appProvided', '', '')
    } else {
      throw new Error('Please provide an App object or null to Shardus.setup.')
    }
    return this
  }

  async start (exitProcOnFail = true) {
    if (this.appProvided === null) throw new Error('Please call Shardus.setup with an App object or null before calling Shardus.start.')
    await this.storage.init()
    this._setupHeartbeat()
    this.crypto = new Crypto(this.config.crypto, this.logger, this.storage)
    await this.crypto.init()

    const ipInfo = this.config.ip
    const p2pConf = Object.assign({ ipInfo }, this.config.p2p)
    this.p2p = new P2P(p2pConf, this.logger, this.storage, this.crypto)
    await this.p2p.init(this.network)
    this.debug = new Debug(this.config.baseDir, this.network)
    this.debug.addToArchive(this.logger.logDir, './logs')
    this.debug.addToArchive(path.parse(this.storage.storage.storageConfig.options.storage).dir, './db')

    if (this.app) {
      this.statistics = new Statistics(this.config.baseDir, this.config.statistics, {
        counters: ['txInjected', 'txApplied', 'txRejected', 'txExpired', 'txProcessed'],
        watchers: {
          queueLength: () => this.stateManager ? this.stateManager.newAcceptedTxQueue.length : 0,
          serverLoad: () => this.loadDetection ? this.loadDetection.getCurrentLoad() : 0
        },
        timers: ['txTimeInQueue']
      }, this)
      this.debug.addToArchive('./statistics.tsv', './statistics.tsv')

      this.loadDetection = new LoadDetection(this.config.loadDetection, this.statistics)
      this.statistics.on('snapshot', () => this.loadDetection.updateLoad())
      this.loadDetection.on('highLoad', async () => {
        await this.p2p.requestNetworkUpsize()
      })
      this.loadDetection.on('lowLoad', async () => {
        await this.p2p.requestNetworkDownsize()
      })

      this.rateLimiting = new RateLimiting(this.config.rateLimiting, this.loadDetection)

      this.consensus = new Consensus(this.app, this.config, this.logger, this.crypto, this.p2p, this.storage, this.profiler)
      this._createAndLinkStateManager()
      this._attemptCreateAppliedListener()
    }

    this.reporter = this.config.reporting.report ? new Reporter(this.config.reporting, this.logger, this.p2p, this.statistics, this.stateManager, this.profiler, this.loadDetection) : null

    this._registerRoutes()

    this.p2p.on('joining', (publicKey) => {
      this.logger.playbackLogState('joining', '', publicKey)
      if (this.reporter) this.reporter.reportJoining(publicKey)
    })
    this.p2p.on('joined', (nodeId, publicKey) => {
      this.logger.playbackLogState('joined', nodeId, publicKey)
      this.logger.setPlaybackID(nodeId)
      if (this.reporter) this.reporter.reportJoined(nodeId, publicKey)
    })
    this.p2p.on('active', (nodeId) => {
      this.logger.playbackLogState('active', nodeId, '')
      if (this.reporter) {
        this.reporter.reportActive(nodeId)
        this.reporter.startReporting()
      }
      if (this.statistics) this.statistics.startSnapshots()
      this.emit('active', nodeId)
    })
    this.p2p.on('failed', () => {
      this.shutdown(exitProcOnFail)
    })
    this.p2p.on('error', (e) => {
      console.log(e.message + ' at ' + e.stack)
      this.mainLogger.debug('shardus.start() ' + e.message + ' at ' + e.stack)
      this.fatalLogger.fatal('shardus.start() ' + e.message + ' at ' + e.stack)
      throw new Error(e)
    })
    this.p2p.on('initialized', async () => {
      await this.syncAppData()
    })
    this.p2p.on('removed', async () => {
      if (this.statistics) {
        this.statistics.stopSnapshots()
        this.statistics.initialize()
      }
      if (this.reporter) {
        this.reporter.stopReporting()
        await this.reporter.reportRemoved(this.p2p.id)
      }
      if (this.app) {
        await this.app.deleteLocalAccountData()
        this._attemptRemoveAppliedListener()
        this._unlinkStateManager()
        await this.stateManager.cleanup()
        this._createAndLinkStateManager()
        this._attemptCreateAppliedListener()
      }
      await this.p2p.restart()
    })

    await this.p2p.startup()
  }

  _registerListener (emitter, event, callback) {
    if (this._listeners[event]) {
      this.mainLogger.fatal('Shardus can only register one listener per event! EVENT: ', event)
      return
    }
    emitter.on(event, callback)
    this._listeners[event] = [emitter, callback]
  }

  _unregisterListener (event) {
    if (!this._listeners[event]) {
      this.mainLogger.warn(`This event listener doesn't exist! Event: \`${event}\` in Shardus`)
      return
    }
    const entry = this._listeners[event]
    const [emitter, callback] = entry
    emitter.removeListener(event, callback)
    delete this._listeners[event]
  }

  _cleanupListeners () {
    for (const event of Object.keys(this._listeners)) {
      this._unregisterListener(event)
    }
  }

  _attemptCreateAppliedListener () {
    if (!this.statistics || !this.stateManager) return
    this._registerListener(this.stateManager, 'txQueued', txId => this.statistics.startTimer('txTimeInQueue', txId))
    this._registerListener(this.stateManager, 'txPopped', txId => this.statistics.stopTimer('txTimeInQueue', txId))
    this._registerListener(this.stateManager, 'txApplied', () => this.statistics.incrementCounter('txApplied'))
    this._registerListener(this.stateManager, 'txProcessed', () => this.statistics.incrementCounter('txProcessed'))
  }

  _attemptRemoveAppliedListener () {
    if (!this.statistics || !this.stateManager) return
    this._unregisterListener('txQueued')
    this._unregisterListener('txPopped')
    this._unregisterListener('txApplied')
    this._unregisterListener('txProcessed')
  }

  _unlinkStateManager () {
    this._unregisterListener('accepted')
  }

  _createAndLinkStateManager () {
    this.stateManager = new StateManager(this.verboseLogs, this.profiler, this.app, this.consensus, this.logger, this.storage, this.p2p, this.crypto, this.config)
    this._registerListener(this.consensus, 'accepted', (...txArgs) => this.stateManager.queueAcceptedTransaction(...txArgs))

    this.storage.stateManager = this.stateManager
  }

  async syncAppData () {
    if (this.stateManager) await this.stateManager.syncStateData(3)

    if (this.p2p.isFirstSeed) {
      await this.p2p.goActive()
      // await this.stateManager.startCatchUpQueue() // first node skips sync anyhow
      await this.app.sync()
    } else {
      await this.stateManager.startCatchUpQueue()
      await this.app.sync()
      await this.p2p.goActive()
    }
    // Set network joinable to true
    this.p2p.setJoinRequestToggle(true)
    console.log('Server ready!')
    if (this.stateManager) {
      await utils.sleep(3000)
      // Original sync check
      // this.stateManager.enableSyncCheck()

      // Partition check and data repair (new)
      // disable and compare this.stateManager.startSyncPartitions()

      this.stateManager.startSyncPartitions()
    }
  }

  set (tx) {
    return this.put(tx, true)
  }

  log (...data) {
    this.appLogger.debug(...data)
  }

  /**
   * Submit a transaction into the network
   * Returns an object that tells whether a tx was successful or not and the reason why.
   * Throws an error if an application was not provided to shardus.
   *
   * {
   *   success: boolean,
   *   reason: string
   * }
   *
   */
  put (tx, set = false) {
    if (!this.appProvided) throw new Error('Please provide an App object to Shardus.setup before calling Shardus.put')

    if (this.verboseLogs) this.mainLogger.debug(`Start of injectTransaction ${JSON.stringify(tx)}`) // not reducing tx here so we can get the long hashes

    if (!this.stateManager.dataSyncMainPhaseComplete) {
      this.statistics.incrementCounter('txRejected')
      return { success: false, reason: 'Node is still syncing.' }
    }

    if (!this.stateManager.hasCycleShardData()) {
      this.statistics.incrementCounter('txRejected')
      return { success: false, reason: 'Not ready to accept transactions, shard calculations pending' }
    }

    if (set === false) {
      if (!this.p2p.allowTransactions()) {
        this.statistics.incrementCounter('txRejected')
        return { success: false, reason: 'Network conditions to allow transactions are not met.' }
      }
    } else {
      if (!this.p2p.allowSet()) {
        this.statistics.incrementCounter('txRejected')
        return { success: false, reason: 'Network conditions to allow app init via set' }
      }
    }

    if (this.rateLimiting.isOverloaded()) {
      this.statistics.incrementCounter('txRejected')
      return { success: false, reason: 'Maximum load exceeded.' }
    }

    if (typeof tx !== 'object') {
      this.statistics.incrementCounter('txRejected')
      return { success: false, reason: `Invalid Transaction! ${utils.stringifyReduce(tx)}` }
    }

    try {
      // Perform basic validation of the transaction fields
      if (this.verboseLogs) this.mainLogger.debug(`Performing initial validation of the transaction`)
      const initValidationResp = this.app.validateTxnFields(tx)
      if (this.verboseLogs) this.mainLogger.debug(`InitialValidationResponse: ${utils.stringifyReduce(initValidationResp)}`)

      // Validate the transaction timestamp
      const timestamp = initValidationResp.txnTimestamp
      if (this._isTransactionTimestampExpired(timestamp)) {
        this.fatalLogger.fatal(`Transaction Expired: ${utils.stringifyReduce(tx)}`)
        this.statistics.incrementCounter('txExpired')
        return { success: false, reason: 'Transaction Expired' }
      }

      const shardusTx = {}
      shardusTx.receivedTimestamp = Date.now()
      shardusTx.inTransaction = tx
      const txId = this.crypto.hash(tx)

      if (this.verboseLogs) this.mainLogger.debug(`shardusTx. shortTxID: ${txId} txID: ${utils.makeShortHash(txId)} TX data: ${utils.stringifyReduce(shardusTx)}`)
      this.profiler.profileSectionStart('put')

      const signedShardusTx = this.crypto.sign(shardusTx)

      if (this.verboseLogs) this.mainLogger.debug('Transaction validated')
      this.statistics.incrementCounter('txInjected')
      this.logger.playbackLogNote('tx_injected', `${txId}`, `Transaction: ${utils.stringifyReduce(tx)}`)
      this.profiler.profileSectionStart('consensusInject')

      this.consensus.inject(signedShardusTx)
        .then(txReceipt => {
          this.profiler.profileSectionEnd('consensusInject')
          if (this.verboseLogs) this.mainLogger.debug(`Received Consensus. Receipt: ${utils.stringifyReduce(txReceipt)}`)
        })
    } catch (err) {
      this.fatalLogger.fatal(`Put: Failed to process transaction. Exception: ${err}`)
      this.fatalLogger.fatal('Put: ' + err.name + ': ' + err.message + ' at ' + err.stack)
      return { success: false, reason: `Failed to process transaction: ${utils.stringifyReduce(tx)} ${err}` }
    } finally {
      this.profiler.profileSectionEnd('put')
    }

    if (this.verboseLogs) this.mainLogger.debug(`End of injectTransaction ${utils.stringifyReduce(tx)}`)

    return { success: true, reason: 'Transaction queued, poll for results.' }
  }

  // Returns info about this node
  getNodeId () {
    return this.p2p.getNodeId()
  }

  // Returns node info given a node id
  getNode (id) {
    return this.p2p.state.getNode(id)
  }

  getLatestCycles (amount = 1) {
    return this.p2p.getLatestCycles(amount)
  }

  /**
 * @typedef {import('../shardus/index').Node} Node
 */
  /**
   * getClosestNodes finds the closes nodes to a certain hash value
   * @param {string} hash any hash address (256bit 64 characters)
   * @param {number} count how many nodes to return
   * @returns {string[]} returns a list of nodes ids that are closest. roughly in order of closeness
   */
  getClosestNodes (hash, count = 1) {
    return this.stateManager.getClosestNodes(hash, count).map((node) => node.id)
  }

  getClosestNodesGlobal (hash, count) {
    return this.stateManager.getClosestNodesGlobal(hash, count)
  }

  /**
   * isNodeInDistance
   * @param {string} hash any hash address (256bit 64 characters)
   * @param {string} nodeId id of a node
   * @param {number} distance how far away can this node be to the home node of the hash
   * @returns {boolean} is the node in the distance to the target
   */
  isNodeInDistance (hash, nodeId, distance) {
    return this.stateManager.isNodeInDistance(hash, nodeId, distance)
  }

  // USED BY SIMPLECOINAPP
  createApplyResponse (txId, txTimestamp) {
    let replyObject = { stateTableResults: [], txId, txTimestamp, accountData: [] }
    return replyObject
  }

  // USED BY SIMPLECOINAPP
  applyResponseAddState (resultObject, accountData, localCache, accountId, txId, txTimestamp, stateBefore, stateAfter, accountCreated) {
    let state = { accountId, txId, txTimestamp, stateBefore, stateAfter }
    if (accountCreated) {
      state.stateBefore = allZeroes64
    }
    resultObject.stateTableResults.push(state)
    resultObject.accountData.push({ accountId, data: accountData, txId, timestamp: txTimestamp, hash: stateAfter, localCache: localCache })
  }

  // USED BY SIMPLECOINAPP
  async resetAppRelatedState () {
    await this.storage.clearAppRelatedState()
  }

  // USED BY SIMPLECOINAPP
  async getLocalOrRemoteAccount (address) {
    if (this.p2p.allowTransactions()) {
      return this.stateManager.getLocalOrRemoteAccount(address)
    } else {
      return null
    }
  }

  async getRemoteAccount (address) {
    return this.stateManager.getRemoteAccount(address)
  }

  createWrappedResponse (accountId, accountCreated, hash, timestamp, fullData) {
    // create and return the response object, it will default to full data.
    return { accountId: accountId, accountCreated, isPartial: false, stateId: hash, timestamp: timestamp, data: fullData }
  }

  setPartialData (response, partialData, userTag) {
    // if the account was just created we have to do something special and ignore partial data
    if (response.accountCreated) {
      response.localCache = response.data
      return
    }
    response.isPartial = true
    // otherwise we will convert this response to be using partial data
    response.localCache = response.data
    response.data = partialData
    response.userTag = userTag
  }

  genericApplyPartialUpate (fullObject, updatedPartialObject) {
    let dataKeys = Object.keys(updatedPartialObject)
    for (let key of dataKeys) {
      fullObject[key] = updatedPartialObject[key]
    }
  }

  isActive () {
    return this.p2p.isActive()
  }

  async shutdown (exitProcess = true) {
    try {
      await this.exitHandler.exitCleanly(exitProcess)
    } catch (e) {
      throw e
    }
  }

  /**
   * @param {App} application
   * @returns {App}
   */
  _getApplicationInterface (application) {
    this.mainLogger.debug('Start of _getApplicationInterfaces()')
    let applicationInterfaceImpl = {}
    try {
      if (application == null) {
        // throw new Error('Invalid Application Instance')
        return null
      }

      if (typeof (application.validateTxnFields) === 'function') {
        applicationInterfaceImpl.validateTxnFields = (inTx) => application.validateTxnFields(inTx)
      } else {
        throw new Error('Missing requried interface function. validateTxnFields()')
      }

      if (typeof (application.apply) === 'function') {
        applicationInterfaceImpl.apply = async (inTx, wrappedStates) => application.apply(inTx, wrappedStates)
      } else {
        throw new Error('Missing requried interface function. apply()')
      }

      if (typeof (application.updateAccountFull) === 'function') {
        applicationInterfaceImpl.updateAccountFull = async (wrappedStates, localCache, applyResponse) => application.updateAccountFull(wrappedStates, localCache, applyResponse)
      } else {
        throw new Error('Missing requried interface function. updateAccountFull()')
      }

      if (typeof (application.updateAccountPartial) === 'function') {
        applicationInterfaceImpl.updateAccountPartial = async (wrappedStates, localCache, applyResponse) => application.updateAccountPartial(wrappedStates, localCache, applyResponse)
      } else {
        throw new Error('Missing requried interface function. updateAccountPartial()')
      }

      if (typeof (application.getRelevantData) === 'function') {
        applicationInterfaceImpl.getRelevantData = async (accountId, tx) => application.getRelevantData(accountId, tx)
      } else {
        throw new Error('Missing requried interface function. getRelevantData()')
      }

      if (typeof (application.getKeyFromTransaction) === 'function') {
        applicationInterfaceImpl.getKeyFromTransaction = application.getKeyFromTransaction
      } else {
        throw new Error('Missing requried interface function. getKeysFromTransaction()')
      }

      if (typeof (application.getStateId) === 'function') {
        applicationInterfaceImpl.getStateId = async (accountAddress, mustExist) => application.getStateId(accountAddress, mustExist)
      } else {
        // throw new Error('Missing requried interface function. getStateId()')
        this.mainLogger.debug('getStateId not used by global server')
      }

      // opitonal methods
      if (typeof (application.close) === 'function') {
        applicationInterfaceImpl.close = async () => application.close()
      } else {
        throw new Error('Missing requried interface function. close()')
      }

      // unused at the moment
      // if (typeof (application.handleHttpRequest) === 'function') {
      //   applicationInterfaceImpl.handleHttpRequest = async (httpMethod, uri, req, res) => application.handleHttpRequest(httpMethod, uri, req, res)
      // } else {
      //   // throw new Error('Missing requried interface function. apply()')
      // }

      // // TEMP endpoints for workaround. delete this later.
      // if (typeof (application.onAccounts) === 'function') {
      //   applicationInterfaceImpl.onAccounts = async (req, res) => application.onAccounts(req, res)
      // } else {
      //   // throw new Error('Missing requried interface function. apply()')
      // }

      // if (typeof (application.onGetAccount) === 'function') {
      //   applicationInterfaceImpl.onGetAccount = async (req, res) => application.onGetAccount(req, res)
      // } else {
      //   // throw new Error('Missing requried interface function. apply()')
      // }

      // App.get_account_data (Acc_start, Acc_end, Max_records)
      // Provides the functionality defined for /get_accounts API
      // Max_records - limits the number of records returned
      if (typeof (application.getAccountData) === 'function') {
        applicationInterfaceImpl.getAccountData = async (accountStart, accountEnd, maxRecords) => application.getAccountData(accountStart, accountEnd, maxRecords)
      } else {
        throw new Error('Missing requried interface function. getAccountData()')
      }

      if (typeof (application.getAccountDataByRange) === 'function') {
        applicationInterfaceImpl.getAccountDataByRange = async (accountStart, accountEnd, tsStart, tsEnd, maxRecords) => application.getAccountDataByRange(accountStart, accountEnd, tsStart, tsEnd, maxRecords)
      } else {
        throw new Error('Missing requried interface function. getAccountDataByRange()')
      }

      if (typeof (application.calculateAccountHash) === 'function') {
        applicationInterfaceImpl.calculateAccountHash = (account) => application.calculateAccountHash(account)
      } else {
        throw new Error('Missing requried interface function. calculateAccountHash()')
      }

      // App.set_account_data (Acc_records)
      // Acc_records - as provided by App.get_accounts
      // Stores the records into the Accounts table if the hash of the Acc_data matches State_id
      // Returns a list of failed Acc_id
      if (typeof (application.setAccountData) === 'function') {
        applicationInterfaceImpl.setAccountData = async (accountRecords) => application.setAccountData(accountRecords)
      } else {
        throw new Error('Missing requried interface function. setAccountData()')
      }

      // pass array of account copies to this (only looks at the data field) and it will reset the account state
      if (typeof (application.resetAccountData) === 'function') {
        applicationInterfaceImpl.resetAccountData = async (accountRecords) => application.resetAccountData(accountRecords)
      } else {
        throw new Error('Missing requried interface function. resetAccountData()')
      }

      // pass array of account ids to this and it will delete the accounts
      if (typeof (application.deleteAccountData) === 'function') {
        applicationInterfaceImpl.deleteAccountData = async (addressList) => application.deleteAccountData(addressList)
      } else {
        throw new Error('Missing requried interface function. deleteAccountData()')
      }

      if (typeof (application.getAccountDataByList) === 'function') {
        applicationInterfaceImpl.getAccountDataByList = async (addressList) => application.getAccountDataByList(addressList)
      } else {
        throw new Error('Missing requried interface function. getAccountDataByList()')
      }
      if (typeof (application.deleteLocalAccountData) === 'function') {
        applicationInterfaceImpl.deleteLocalAccountData = async () => application.deleteLocalAccountData()
      } else {
        throw new Error('Missing requried interface function. deleteLocalAccountData()')
      }
      if (typeof (application.getAccountDebugValue) === 'function') {
        applicationInterfaceImpl.getAccountDebugValue = (wrappedAccount) => application.getAccountDebugValue(wrappedAccount)
      } else {
        applicationInterfaceImpl.getAccountDebugValue = (wrappedAccount) => 'getAccountDebugValue() missing on app'
        // throw new Error('Missing requried interface function. deleteLocalAccountData()')
      }

      if (typeof (application.canDebugDropTx) === 'function') {
        applicationInterfaceImpl.canDebugDropTx = (tx) => application.canDebugDropTx(tx)
      } else {
        applicationInterfaceImpl.canDebugDropTx = (tx) => true
      }

      if (typeof (application.sync) === 'function') {
        applicationInterfaceImpl.sync = async () => application.sync()
      } else {
        let thisPtr = this
        applicationInterfaceImpl.sync = async function () { thisPtr.mainLogger.debug('no app.sync() function defined') }
      }
    } catch (ex) {
      this.fatalLogger.fatal(`Required application interface not implemented. Exception: ${ex}`)
      this.fatalLogger.fatal('_getApplicationInterface: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      throw new Error(ex)
    }
    this.mainLogger.debug('End of _getApplicationInterfaces()')

    // hack to force this to the correct answer.. not sure why other type correction methods did not work..
    return /** @type {App} */(/** @type {unknown} */(applicationInterfaceImpl))
    // return applicationInterfaceImpl
  }

  _registerRoutes () {
    // DEBUG routes
    // TODO: Remove eventually, or at least route guard these
    this.network.registerExternalPost('exit', async (req, res) => {
      res.json({ success: true })
      await this.shutdown()
    })

    this.network.registerExternalGet('config', async (req, res) => {
      res.json({ config: this.config })
    })
  }

  registerExceptionHandler () {
    const logFatalAndExit = (err) => {
      console.log('Encountered a fatal error. Check fatal log for details.')
      this.fatalLogger.fatal('unhandledRejection: ' + err.stack)
      this.exitHandler.exitCleanly()
    }
    process.on('uncaughtException', (err) => {
      logFatalAndExit(err)
    })
    process.on('unhandledRejection', (err) => {
      logFatalAndExit(err)
    })
  }

  async _writeHeartbeat () {
    const timestamp = utils.getTime('s')
    await this.storage.setProperty('heartbeat', timestamp)
  }

  _setupHeartbeat () {
    this.heartbeatTimer = setInterval(async () => {
      await this._writeHeartbeat()
    }, this.heartbeatInterval * 1000)
  }

  _stopHeartbeat () {
    this.mainLogger.info('Stopping heartbeat...')
    clearInterval(this.heartbeatTimer)
  }

  _isTransactionTimestampExpired (timestamp) {
    // this.mainLogger.debug(`Start of _isTransactionTimestampExpired(${timestamp})`)
    let transactionExpired = false
    const txnExprationTime = this.config.transactionExpireTime
    const currNodeTimestamp = Date.now()

    const txnAge = currNodeTimestamp - timestamp
    this.mainLogger.debug(`Transaction Timestamp: ${timestamp} CurrNodeTimestamp: ${currNodeTimestamp}
    txnExprationTime: ${txnExprationTime}   TransactionAge: ${txnAge}`)

    // this.mainLogger.debug(`TransactionAge: ${txnAge}`)
    if (txnAge >= (txnExprationTime * 1000)) {
      this.fatalLogger.error(`Transaction Expired`)
      transactionExpired = true
    }
    // this.mainLogger.debug(`End of _isTransactionTimestampExpired(${timestamp})`)
    return transactionExpired
  }
}

module.exports = Shardus
