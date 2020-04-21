import { EventEmitter } from 'events'
import Log4js from 'log4js'
import path from 'path'
import Consensus from '../consensus'
import Crypto from '../crypto'
import Debug from '../debug'
import ExitHandler from '../exit-handler'
import LoadDetection from '../load-detection'
import Logger from '../logger'
import * as Network from '../network'
import * as Active from '../p2p/Active'
import * as Context from '../p2p/Context'
import * as GlobalAccounts from '../p2p/GlobalAccounts'
import * as Self from '../p2p/Self'
import RateLimiting from '../rate-limiting'
import Reporter from '../reporter'
import StateManager from '../state-manager'
import Statistics from '../statistics'
import Storage from '../storage'
import * as Wrapper from '../p2p/Wrapper'
import * as utils from '../utils'
import Profiler from '../utils/profiler'
import ShardusTypes = require('../shardus/shardus-types')
const P2P = require('../p2p')
const allZeroes64 = '0'.repeat(64)
const saveConsoleOutput = require('./saveConsoleOutput')

interface Shardus {
  profiler: Profiler
  config: ShardusTypes.ShardusConfiguration
  verboseLogs: boolean
  logger: Logger
  mainLogger: Log4js.Logger
  fatalLogger: Log4js.Logger
  appLogger: Log4js.Logger
  exitHandler: any
  storage: Storage
  crypto: Crypto
  network: Network.NetworkClass
  p2p: any
  debug: Debug
  consensus: Consensus
  appProvided: boolean
  app: ShardusTypes.App
  reporter: Reporter
  stateManager: StateManager
  statistics: Statistics
  loadDetection: LoadDetection
  rateLimiting: RateLimiting
  heartbeatInterval: number
  heartbeatTimer: NodeJS.Timeout
  registerExternalGet: any
  registerExternalPost: any
  registerExternalPut: any
  registerExternalDelete: any
  registerExternalPatch: any
  _listeners: any
}

/**
 * The main module that is used by the app developer to interact with the shardus api
 */
class Shardus extends EventEmitter {
  constructor({
    server: config,
    logs: logsConfig,
    storage: storageConfig,
  }: {
    server: ShardusTypes.ShardusConfiguration
    logs: ShardusTypes.LogsConfiguration
    storage: ShardusTypes.StorageConfiguration
  }) {
    super()
    this.profiler = new Profiler()
    this.config = config
    Context.setConfig(this.config)
    this.verboseLogs = false
    this.logger = new Logger(config.baseDir, logsConfig)
    Context.setLoggerContext(this.logger)

    if (logsConfig.saveConsoleOutput) {
      saveConsoleOutput.startSaving(path.join(config.baseDir, logsConfig.dir))
    }

    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.appLogger = this.logger.getLogger('app')
    this.exitHandler = new ExitHandler()
    this.storage = new Storage(
      config.baseDir,
      storageConfig,
      this.logger,
      this.profiler
    )
    this.crypto = new Crypto(this.config, this.logger, this.storage)
    Context.setCryptoContext(this.crypto)
    this.network = new Network.NetworkClass(config.network, this.logger)
    Context.setNetworkContext(this.network)

    // Set the old P2P to a Wrapper into the new P2P
    // [TODO] Remove this once everything calls p2p/* modules directly
    this.p2p = Wrapper.p2p

    this.debug = null
    this.consensus = null
    this.appProvided = null
    this.app = null
    this.reporter = null
    this.stateManager = null
    this.statistics = null
    this.loadDetection = null
    this.rateLimiting = null

    this.mainLogger.info(`Server started with pid: ${process.pid}`)

    this.mainLogger.info(`===== Server config: =====`)
    this.mainLogger.info(JSON.stringify(config, null, 2))

    this._listeners = {}

    this.heartbeatInterval = config.heartbeatInterval
    this.heartbeatTimer = null

    // levelStr not correctly defined in logger type definition, so ignore it
    // @ts-ignore
    if (this.mainLogger && ['TRACE'].includes(this.mainLogger.level.levelStr)) {
      this.verboseLogs = true
    }

    // alias the network register calls so that an app can get to them
    this.registerExternalGet = (route, handler) =>
      this.network.registerExternalGet(route, handler)
    this.registerExternalPost = (route, handler) =>
      this.network.registerExternalPost(route, handler)
    this.registerExternalPut = (route, handler) =>
      this.network.registerExternalPut(route, handler)
    this.registerExternalDelete = (route, handler) =>
      this.network.registerExternalDelete(route, handler)
    this.registerExternalPatch = (route, handler) =>
      this.network.registerExternalPatch(route, handler)

    this.exitHandler.addSigListeners()
    this.exitHandler.registerSync('reporter', () => {
      if (this.reporter) {
        this.reporter.stopReporting()
      }
    })
    this.exitHandler.registerSync('crypto', () => {
      this.crypto.stopAllGenerators()
    })
    this.exitHandler.registerAsync('network', async () => {
      this.mainLogger.info('Shutting down networking...')
      await this.network.shutdown()
    })
    this.exitHandler.registerAsync('storage', async () => {
      this.mainLogger.info('Closing Database connections...')
      await this.storage.close()
    })
    this.exitHandler.registerAsync('application', async () => {
      if (this.app && this.app.close) {
        this.mainLogger.info('Shutting down the application...')
        this.app.close()
      }
    })
    this.exitHandler.registerAsync('logger', async () => {
      this.mainLogger.info('Shutting down logs...')
      await this.logger.shutdown()
    })

    this.logger.playbackLogState('constructed', '', '')
  }

  // constructor ({ server: config, logs: logsConfig, storage: storageConfig }: {
  //   server: ShardusTypes.ShardusConfiguration
  //   logs: ShardusTypes.LogsConfiguration
  //   storage: ShardusTypes.StorageConfiguration
  // }) {
  //   super()
  //   this.profiler = new Profiler()
  //   this.config = config
  //   this.verboseLogs = false
  //   this.logger = new Logger(config.baseDir, logsConfig)
  //   setLoggerContext(this.logger)

  //   if (logsConfig.saveConsoleOutput) {
  //     saveConsoleOutput.startSaving(path.join(config.baseDir, logsConfig.dir))
  //   }

  //   this.mainLogger = this.logger.getLogger('main')
  //   this.fatalLogger = this.logger.getLogger('fatal')
  //   this.appLogger = this.logger.getLogger('app')
  //   this.exitHandler = new ExitHandler()
  //   this.storage = new Storage(config.baseDir, storageConfig, this.logger, this.profiler)
  //   this.crypto = null
  //   this.network = new Network(config.network, this.logger)
  //   setNetworkContext(this.network)
  //   this.p2p = null
  //   this.debug = null
  //   this.consensus = null
  //   this.appProvided = null
  //   this.app = null
  //   this.reporter = null
  //   this.stateManager = null
  //   this.statistics = null
  //   this.loadDetection = null
  //   this.rateLimiting = null

  //   this.mainLogger.info(`Server started with pid: ${process.pid}`)

  //   this.mainLogger.info(`===== Server config: =====`)
  //   this.mainLogger.info(JSON.stringify(config, null, 2))

  //   this._listeners = {}

  //   this.heartbeatInterval = config.heartbeatInterval
  //   this.heartbeatTimer = null

  //   // levelStr not correctly defined in logger type definition, so ignore it
  //   // @ts-ignore
  //   if (this.mainLogger && ['TRACE'].includes(this.mainLogger.level.levelStr)) {
  //     this.verboseLogs = true
  //   }

  //   // alias the network register calls so that an app can get to them
  //   this.registerExternalGet = (route, handler) => this.network.registerExternalGet(route, handler)
  //   this.registerExternalPost = (route, handler) => this.network.registerExternalPost(route, handler)
  //   this.registerExternalPut = (route, handler) => this.network.registerExternalPut(route, handler)
  //   this.registerExternalDelete = (route, handler) => this.network.registerExternalDelete(route, handler)
  //   this.registerExternalPatch = (route, handler) => this.network.registerExternalPatch(route, handler)

  //   this.exitHandler.addSigListeners()
  //   this.exitHandler.registerSync('reporter', () => {
  //     if (this.reporter) {
  //       this.reporter.stopReporting()
  //     }
  //   })
  //   this.exitHandler.registerSync('p2p', () => {
  //     if (this.p2p) {
  //       this.p2p.cleanupSync()
  //     }
  //   })
  //   this.exitHandler.registerSync('shardus', () => {
  //     this._stopHeartbeat()
  //   })
  //   this.exitHandler.registerSync('crypto', () => {
  //     this.crypto.stopAllGenerators()
  //   })
  //   this.exitHandler.registerAsync('network', async () => {
  //     this.mainLogger.info('Shutting down networking...')
  //     await this.network.shutdown()
  //   })
  //   this.exitHandler.registerAsync('shardus', async () => {
  //     this.mainLogger.info('Writing heartbeat to database before exiting...')
  //     await this._writeHeartbeat()
  //   })
  //   this.exitHandler.registerAsync('storage', async () => {
  //     this.mainLogger.info('Closing Database connections...')
  //     await this.storage.close()
  //   })
  //   this.exitHandler.registerAsync('application', async () => {
  //     if (this.app && this.app.close) {
  //       this.mainLogger.info('Shutting down the application...')
  //       await this.app.close()
  //     }
  //   })
  //   this.exitHandler.registerAsync('logger', async () => {
  //     this.mainLogger.info('Shutting down logs...')
  //     await this.logger.shutdown()
  //   })

  //   this.logger.playbackLogState('constructed', '', '')
  // }

  /**
   * This function is what the app developer uses to setup all the SDK functions used by shardus
   * @typedef {import('./index').App} App
   */
  setup(app) {
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

  /**
   * Calling this function will start the network
   * @param {*} exitProcOnFail Exit the process if an error occurs
   */
  // async start_OLD (exitProcOnFail = true) {
  //   if (this.appProvided === null) throw new Error('Please call Shardus.setup with an App object or null before calling Shardus.start.')
  //   await this.storage.init()
  //   this._setupHeartbeat()
  //   this.crypto = new Crypto(this.config, this.logger, this.storage)
  //   Context.setCryptoContext(this.crypto)
  //   await this.crypto.init()

  //   const ipInfo = this.config.ip
  //   const p2pConf = Object.assign({ ipInfo }, this.config.p2p)
  //   this.p2p = new P2P(p2pConf, this.logger, this.storage, this.crypto)
  //   Context.setP2pContext(this.p2p)
  //   await this.p2p.init(this.network)
  //   this.debug = new Debug(this.config.baseDir, this.network)
  //   this.debug.addToArchive(this.logger.logDir, './logs')
  //   this.debug.addToArchive(path.parse(this.storage.storage.storageConfig.options.storage).dir, './db')

  //   this.statistics = new Statistics(this.config.baseDir, this.config.statistics, {
  //     counters: ['txInjected', 'txApplied', 'txRejected', 'txExpired', 'txProcessed'],
  //     watchers: {
  //       queueLength: () => this.stateManager ? this.stateManager.newAcceptedTxQueue.length : 0,
  //       serverLoad: () => this.loadDetection ? this.loadDetection.getCurrentLoad() : 0
  //     },
  //     timers: ['txTimeInQueue']
  //   }, this)
  //   this.debug.addToArchive('./statistics.tsv', './statistics.tsv')

  //   this.loadDetection = new LoadDetection(this.config.loadDetection, this.statistics)
  //   this.statistics.on('snapshot', () => this.loadDetection.updateLoad())
  //   this.loadDetection.on('highLoad', async () => {
  //     await this.p2p.requestNetworkUpsize()
  //   })
  //   this.loadDetection.on('lowLoad', async () => {
  //     await this.p2p.requestNetworkDownsize()
  //   })

  //   this.rateLimiting = new RateLimiting(this.config.rateLimiting, this.loadDetection)

  //   this.consensus = new Consensus(this.app, this.config, this.logger, this.crypto, this.p2p, this.storage, this.profiler)

  //   if (this.app) {
  //     this._createAndLinkStateManager()
  //     this._attemptCreateAppliedListener()
  //   }

  //   this.reporter = this.config.reporting.report ? new Reporter(this.config.reporting, this.logger, this.p2p, this.statistics, this.stateManager, this.profiler, this.loadDetection) : null

  //   this._registerRoutes()

  //   this.p2p.on('joining', (publicKey) => {
  //     this.logger.playbackLogState('joining', '', publicKey)
  //     if (this.reporter) this.reporter.reportJoining(publicKey)
  //   })
  //   this.p2p.on('joined', (nodeId, publicKey) => {
  //     this.logger.playbackLogState('joined', nodeId, publicKey)
  //     this.logger.setPlaybackID(nodeId)
  //     if (this.reporter) this.reporter.reportJoined(nodeId, publicKey)
  //   })
  //   this.p2p.on('initialized', async () => {
  //     await this.syncAppData()
  //     this.p2p.goActive()
  //   })
  //   this.p2p.on('active', (nodeId) => {
  //     this.logger.playbackLogState('active', nodeId, '')
  //     if (this.reporter) {
  //       this.reporter.reportActive(nodeId)
  //       this.reporter.startReporting()
  //     }
  //     if (this.statistics) this.statistics.startSnapshots()
  //     this.emit('active', nodeId)
  //   })
  //   this.p2p.on('failed', () => {
  //     this.shutdown(exitProcOnFail)
  //   })
  //   this.p2p.on('error', (e) => {
  //     console.log(e.message + ' at ' + e.stack)
  //     this.mainLogger.debug('shardus.start() ' + e.message + ' at ' + e.stack)
  //     this.fatalLogger.fatal('shardus.start() ' + e.message + ' at ' + e.stack)
  //     throw new Error(e)
  //   })
  //   this.p2p.on('removed', async () => {
  //     if (this.statistics) {
  //       this.statistics.stopSnapshots()
  //       this.statistics.initialize()
  //     }
  //     if (this.reporter) {
  //       this.reporter.stopReporting()
  //       await this.reporter.reportRemoved(this.p2p.id)
  //     }
  //     if (this.app) {
  //       await this.app.deleteLocalAccountData()
  //       this._attemptRemoveAppliedListener()
  //       this._unlinkStateManager()
  //       await this.stateManager.cleanup()
  //       // Dont start a new state manager. pm2 will do a full restart if needed.
  //       // this._createAndLinkStateManager()
  //       // this._attemptCreateAppliedListener()
  //     }
  //     await this.p2p.restart()
  //   })

  //   Context.setShardusContext(this)

  //   await Self.init(this.config)
  //   await Self.startup()
  // }

  async start() {
    // Check network up & time synced
    await Network.init()
    await Network.checkTimeSynced(this.config.p2p.timeServers)

    // Setup network
    await this.network.setup(Network.ipInfo)
    this.network.on('timeout', () => {
      /** [TODO] Report lost */
    })
    this.network.on('error', () => {
      /** [TODO] Report lost */
    })

    // Setup storage
    await this.storage.init()

    // Setup crypto
    await this.crypto.init()

    // Setup other modules
    this.debug = new Debug(this.config.baseDir, this.network)
    this.debug.addToArchive(this.logger.logDir, './logs')
    this.debug.addToArchive(
      path.parse(this.storage.storage.storageConfig.options.storage).dir,
      './db'
    )

    this.statistics = new Statistics(
      this.config.baseDir,
      this.config.statistics,
      {
        counters: [
          'txInjected',
          'txApplied',
          'txRejected',
          'txExpired',
          'txProcessed',
        ],
        watchers: {
          queueLength: () =>
            this.stateManager ? this.stateManager.newAcceptedTxQueue.length : 0,
          serverLoad: () =>
            this.loadDetection ? this.loadDetection.getCurrentLoad() : 0,
        },
        timers: ['txTimeInQueue'],
      },
      this
    )
    this.debug.addToArchive('./statistics.tsv', './statistics.tsv')

    this.loadDetection = new LoadDetection(
      this.config.loadDetection,
      this.statistics
    )
    this.loadDetection.on('highLoad', async () => {
      /** [TODO] Autoscaling scale up */
    })
    this.loadDetection.on('lowLoad', async () => {
      /** [TODO] Autoscaling scale down */
    })

    this.statistics.on('snapshot', () => this.loadDetection.updateLoad())

    this.rateLimiting = new RateLimiting(
      this.config.rateLimiting,
      this.loadDetection
    )

    this.consensus = new Consensus(
      this.app,
      this.config,
      this.logger,
      this.crypto,
      this.storage,
      this.profiler
    )

    if (this.app) {
      this._createAndLinkStateManager()
      this._attemptCreateAppliedListener()
    }

    this.reporter = this.config.reporting.report
      ? new Reporter(
          this.config.reporting,
          this.logger,
          this.statistics,
          this.stateManager,
          this.profiler,
          this.loadDetection
        )
      : null

    this._registerRoutes()

    // Register listeners for P2P events
    Self.emitter.on('joining', publicKey => {
      this.logger.playbackLogState('joining', '', publicKey)
      if (this.reporter) this.reporter.reportJoining(publicKey)
    })
    Self.emitter.on('joined', (nodeId, publicKey) => {
      this.logger.playbackLogState('joined', nodeId, publicKey)
      this.logger.setPlaybackID(nodeId)
      if (this.reporter) this.reporter.reportJoined(nodeId, publicKey)
    })
    Self.emitter.on('initialized', async () => {
      // [TODO] Enable once CycleCreator is fully operational
      await this.syncAppData()
    })
    Self.emitter.on('active', nodeId => {
      this.logger.playbackLogState('active', nodeId, '')
      if (this.reporter) {
        this.reporter.reportActive(nodeId)
        this.reporter.startReporting()
      }
      if (this.statistics) this.statistics.startSnapshots()
      this.emit('active', nodeId)
    })
    Self.emitter.on('failed', () => {
      this.shutdown(true)
    })
    Self.emitter.on('error', e => {
      console.log(e.message + ' at ' + e.stack)
      this.mainLogger.debug('shardus.start() ' + e.message + ' at ' + e.stack)
      this.fatalLogger.fatal('shardus.start() ' + e.message + ' at ' + e.stack)
      throw new Error(e)
    })
    Self.emitter.on('removed', async () => {
      if (this.statistics) {
        this.statistics.stopSnapshots()
        this.statistics.initialize()
      }
      if (this.reporter) {
        this.reporter.stopReporting()
        await this.reporter.reportRemoved(Self.id)
      }
      if (this.app) {
        this.app.deleteLocalAccountData()
        this._attemptRemoveAppliedListener()
        this._unlinkStateManager()
        await this.stateManager.cleanup()
      }

      // Shutdown cleanly
      process.exit()
    })

    Context.setShardusContext(this)

    // Init new P2P
    Self.init()

    // Start P2P
    await Self.startup()
  }

  /**
   * Function used to register event listeners
   * @param {*} emitter Socket emitter to be called
   * @param {*} event Event name to be registered
   * @param {*} callback Callback function to be executed on event
   */
  _registerListener(emitter, event, callback) {
    if (this._listeners[event]) {
      this.mainLogger.fatal(
        'Shardus can only register one listener per event! EVENT: ',
        event
      )
      return
    }
    emitter.on(event, callback)
    this._listeners[event] = [emitter, callback]
  }

  /**
   * Function used to register event listeners
   * @param {*} event Name of the event to be unregistered
   */
  _unregisterListener(event) {
    if (!this._listeners[event]) {
      this.mainLogger.warn(
        `This event listener doesn't exist! Event: \`${event}\` in Shardus`
      )
      return
    }
    const entry = this._listeners[event]
    const [emitter, callback] = entry
    emitter.removeListener(event, callback)
    delete this._listeners[event]
  }

  /**
   * Function to unregister all event listeners
   */
  _cleanupListeners() {
    for (const event of Object.keys(this._listeners)) {
      this._unregisterListener(event)
    }
  }

  /**
   * Function used to register listeners for transaction related events
   */
  _attemptCreateAppliedListener() {
    if (!this.statistics || !this.stateManager) return
    this._registerListener(this.stateManager, 'txQueued', txId =>
      this.statistics.startTimer('txTimeInQueue', txId)
    )
    this._registerListener(this.stateManager, 'txPopped', txId =>
      this.statistics.stopTimer('txTimeInQueue', txId)
    )
    this._registerListener(this.stateManager, 'txApplied', () =>
      this.statistics.incrementCounter('txApplied')
    )
    this._registerListener(this.stateManager, 'txProcessed', () =>
      this.statistics.incrementCounter('txProcessed')
    )
  }

  /**
   * Function to unregister all transaction related events
   */
  _attemptRemoveAppliedListener() {
    if (!this.statistics || !this.stateManager) return
    this._unregisterListener('txQueued')
    this._unregisterListener('txPopped')
    this._unregisterListener('txApplied')
    this._unregisterListener('txProcessed')
  }

  /**
   * function to unregister listener for the "accepted" event
   */
  _unlinkStateManager() {
    this._unregisterListener('accepted')
  }

  /**
   * Creates an instance of the StateManager module and registers the "accepted" event listener for queueing transactions
   */
  _createAndLinkStateManager() {
    this.stateManager = new StateManager(
      this.verboseLogs,
      this.profiler,
      this.app,
      this.consensus,
      this.logger,
      this.storage,
      this.p2p,
      this.crypto,
      this.config
    )
    // manually spelling out parameters here for readablity
    this._registerListener(
      this.consensus,
      'accepted',
      (
        ...txArgs: [
          ShardusTypes.AcceptedTx,
          boolean,
          ShardusTypes.Node,
          boolean
        ]
      ) => this.stateManager.queueAcceptedTransaction(...txArgs)
    )

    this.storage.stateManager = this.stateManager
    Context.setStateManagerContext(this.stateManager)
  }

  /**
   * Function used to allow shardus to sync data specific to an app if it should be required
   */
  async syncAppData() {
    if (!this.app) {
      await this.p2p.goActive()
      return
    }
    if (this.stateManager) await this.stateManager.syncStateData(3)
    console.log('syncAppData')
    if (this.p2p.isFirstSeed) {
      await this.p2p.goActive()
      console.log('syncAppData - goActive')
      // await this.stateManager.startCatchUpQueue() // first node skips sync anyhow
      await this.app.sync()
      console.log('syncAppData - sync')
    } else {
      await this.stateManager.startCatchUpQueue()
      console.log('syncAppData - startCatchUpQueue')
      await this.app.sync()
      console.log('syncAppData - sync')
      await this.p2p.goActive()
      console.log('syncAppData - goActive')
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

  /**
   * Calls the "put" function with the "set" boolean parameter set to true
   * @param {*} tx The transaction data
   */
  set(tx: any) {
    return this.put(tx, true, false)
  }

  /**
   * Allows the application to log specific data to an app.log file
   * @param  {...any} data The data to be logged in app.log file
   */
  log(...data: any[]) {
    this.appLogger.debug(new Date(), ...data)
  }

  /**
   * Submits a transaction to the network
   * Returns an object that tells whether a tx was successful or not and the reason why via the
   * validateTxnFields application SDK function.
   * Throws an error if an application was not provided to shardus.
   *
   * {
   *   success: boolean,
   *   reason: string
   * }
   *
   */
  put(tx, set = false, global = false) {
    if (!this.appProvided)
      throw new Error(
        'Please provide an App object to Shardus.setup before calling Shardus.put'
      )

    if (this.verboseLogs)
      this.mainLogger.debug(`Start of injectTransaction ${JSON.stringify(tx)}`) // not reducing tx here so we can get the long hashes

    if (!this.stateManager.dataSyncMainPhaseComplete) {
      this.statistics.incrementCounter('txRejected')
      return { success: false, reason: 'Node is still syncing.' }
    }

    if (!this.stateManager.hasCycleShardData()) {
      this.statistics.incrementCounter('txRejected')
      return {
        success: false,
        reason: 'Not ready to accept transactions, shard calculations pending',
      }
    }

    if (set === false) {
      if (!this.p2p.allowTransactions()) {
        this.statistics.incrementCounter('txRejected')
        return {
          success: false,
          reason: 'Network conditions to allow transactions are not met.',
        }
      }
    } else {
      if (!this.p2p.allowSet()) {
        this.statistics.incrementCounter('txRejected')
        return {
          success: false,
          reason: 'Network conditions to allow app init via set',
        }
      }
    }

    if (this.rateLimiting.isOverloaded()) {
      this.statistics.incrementCounter('txRejected')
      return { success: false, reason: 'Maximum load exceeded.' }
    }

    if (typeof tx !== 'object') {
      this.statistics.incrementCounter('txRejected')
      return {
        success: false,
        reason: `Invalid Transaction! ${utils.stringifyReduce(tx)}`,
      }
    }

    try {
      // Perform basic validation of the transaction fields
      if (this.verboseLogs)
        this.mainLogger.debug(
          `Performing initial validation of the transaction`
        )
      const initValidationResp = this.app.validateTxnFields(tx)
      if (this.verboseLogs)
        this.mainLogger.debug(
          `InitialValidationResponse: ${utils.stringifyReduce(
            initValidationResp
          )}`
        )

      // Validate the transaction timestamp
      const timestamp = initValidationResp.txnTimestamp
      if (this._isTransactionTimestampExpired(timestamp)) {
        this.fatalLogger.fatal(
          `Transaction Expired: ${utils.stringifyReduce(tx)}`
        )
        this.statistics.incrementCounter('txExpired')
        return { success: false, reason: 'Transaction Expired' }
      }

      const shardusTx: any = {}
      shardusTx.receivedTimestamp = Date.now()
      shardusTx.inTransaction = tx
      const txId = this.crypto.hash(tx)

      if (this.verboseLogs)
        this.mainLogger.debug(
          `shardusTx. shortTxID: ${txId} txID: ${utils.makeShortHash(
            txId
          )} TX data: ${utils.stringifyReduce(shardusTx)}`
        )
      this.profiler.profileSectionStart('put')

      const signedShardusTx = this.crypto.sign(shardusTx)

      if (this.verboseLogs) this.mainLogger.debug('Transaction validated')
      this.statistics.incrementCounter('txInjected')
      this.logger.playbackLogNote(
        'tx_injected',
        `${txId}`,
        `Transaction: ${utils.stringifyReduce(tx)}`
      )
      this.profiler.profileSectionStart('consensusInject')

      this.consensus.inject(signedShardusTx, global).then(txReceipt => {
        this.profiler.profileSectionEnd('consensusInject')
        if (this.verboseLogs)
          this.mainLogger.debug(
            `Received Consensus. Receipt: ${utils.stringifyReduce(txReceipt)}`
          )
      })
    } catch (err) {
      this.fatalLogger.fatal(
        `Put: Failed to process transaction. Exception: ${err}`
      )
      this.fatalLogger.fatal(
        'Put: ' + err.name + ': ' + err.message + ' at ' + err.stack
      )
      return {
        success: false,
        reason: `Failed to process transaction: ${utils.stringifyReduce(
          tx
        )} ${err}`,
      }
    } finally {
      this.profiler.profileSectionEnd('put')
    }

    if (this.verboseLogs)
      this.mainLogger.debug(
        `End of injectTransaction ${utils.stringifyReduce(tx)}`
      )

    return { success: true, reason: 'Transaction queued, poll for results.' }
  }

  /**
   * Returns the nodeId for this node
   */
  getNodeId() {
    return this.p2p.getNodeId()
  }

  /**
   * Returns node info given a node id
   * @param {*} id The nodeId of this node
   */
  getNode(id) {
    return this.p2p.state.getNode(id)
  }

  /**
   * Returns an array of cycles in the cycleChain history starting from the current cycle
   * @param {*} amount The number cycles to fetch from the recent cycle history
   */
  getLatestCycles(amount = 1) {
    return this.p2p.getLatestCycles(amount)
  }

  /**
   * @typedef {import('../shardus/index.js').Node} Node
   */
  /**
   * getClosestNodes finds the closes nodes to a certain hash value
   * @param {string} hash any hash address (256bit 64 characters)
   * @param {number} count how many nodes to return
   * @returns {string[]} returns a list of nodes ids that are closest. roughly in order of closeness
   */
  getClosestNodes(hash, count = 1) {
    return this.stateManager.getClosestNodes(hash, count).map(node => node.id)
  }

  getClosestNodesGlobal(hash, count) {
    return this.stateManager.getClosestNodesGlobal(hash, count)
  }

  /**
   * isNodeInDistance
   * @param {string} hash any hash address (256bit 64 characters)
   * @param {string} nodeId id of a node
   * @param {number} distance how far away can this node be to the home node of the hash
   * @returns {boolean} is the node in the distance to the target
   */
  isNodeInDistance(hash: string, nodeId: string, distance: number) {
    //@ts-ignore
    return this.stateManager.isNodeInDistance(hash, nodeId, distance)
  }

  // USED BY SIMPLECOINAPP
  createApplyResponse(txId, txTimestamp) {
    const replyObject = {
      stateTableResults: [],
      txId,
      txTimestamp,
      accountData: [],
    }
    return replyObject
  }

  // USED BY SIMPLECOINAPP
  applyResponseAddState(
    resultObject,
    accountData,
    localCache,
    accountId,
    txId,
    txTimestamp,
    stateBefore,
    stateAfter,
    accountCreated
  ) {
    const state = { accountId, txId, txTimestamp, stateBefore, stateAfter }
    if (accountCreated) {
      state.stateBefore = allZeroes64
    }
    resultObject.stateTableResults.push(state)
    resultObject.accountData.push({
      accountId,
      data: accountData,
      txId,
      timestamp: txTimestamp,
      hash: stateAfter,
      localCache,
    })
  }

  // USED BY SIMPLECOINAPP
  async resetAppRelatedState() {
    await this.storage.clearAppRelatedState()
  }

  // USED BY SIMPLECOINAPP
  async getLocalOrRemoteAccount(address) {
    if (this.p2p.allowTransactions()) {
      return this.stateManager.getLocalOrRemoteAccount(address)
    } else {
      return null
    }
  }

  /**
   * This function is used to query data from an account that is guaranteed to be in a remote shard
   * @param {*} address The address / publicKey of the account in which to query
   */
  async getRemoteAccount(address) {
    return this.stateManager.getRemoteAccount(address)
  }

  /**
   * Creates a wrapped response for formatting required by shardus
   * @param {*} accountId
   * @param {*} accountCreated
   * @param {*} hash
   * @param {*} timestamp
   * @param {*} fullData
   */
  createWrappedResponse(accountId, accountCreated, hash, timestamp, fullData) {
    // create and return the response object, it will default to full data.
    return {
      accountId,
      accountCreated,
      isPartial: false,
      stateId: hash,
      timestamp,
      data: fullData,
    }
  }

  /**
   * setPartialData
   * @param {Shardus.WrappedResponse} response
   * @param {any} partialData
   * @param {any} userTag
   */
  setPartialData(response, partialData, userTag) {
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

  genericApplyPartialUpate(fullObject, updatedPartialObject) {
    const dataKeys = Object.keys(updatedPartialObject)
    for (const key of dataKeys) {
      fullObject[key] = updatedPartialObject[key]
    }
  }

  /**
   * Checks if this node is active in the network
   */
  isActive() {
    return this.p2p.isActive()
  }

  /**
   * Shutdown this node in the network
   * @param {boolean} exitProcess Exit the process when shutting down
   */
  async shutdown(exitProcess = true) {
    try {
      await this.exitHandler.exitCleanly(exitProcess)
      // consider if we want this.  it can help for debugging:
      // await this.exitHandler.exitUncleanly()
    } catch (e) {
      throw e
    }
  }

  /**
   * Grab the SDK interface provided by the application for shardus
   * @param {App} application
   * @returns {App}
   */
  _getApplicationInterface(application) {
    this.mainLogger.debug('Start of _getApplicationInterfaces()')
    const applicationInterfaceImpl: any = {}
    try {
      if (application == null) {
        // throw new Error('Invalid Application Instance')
        return null
      }

      if (typeof application.validateTxnFields === 'function') {
        applicationInterfaceImpl.validateTxnFields = inTx =>
          application.validateTxnFields(inTx)
      } else {
        throw new Error(
          'Missing requried interface function. validateTxnFields()'
        )
      }

      if (typeof application.apply === 'function') {
        applicationInterfaceImpl.apply = (inTx, wrappedStates) =>
          application.apply(inTx, wrappedStates)
      } else {
        throw new Error('Missing requried interface function. apply()')
      }

      if (typeof application.updateAccountFull === 'function') {
        applicationInterfaceImpl.updateAccountFull = async (
          wrappedStates,
          localCache,
          applyResponse
        ) =>
          application.updateAccountFull(
            wrappedStates,
            localCache,
            applyResponse
          )
      } else {
        throw new Error(
          'Missing requried interface function. updateAccountFull()'
        )
      }

      if (typeof application.updateAccountPartial === 'function') {
        applicationInterfaceImpl.updateAccountPartial = async (
          wrappedStates,
          localCache,
          applyResponse
        ) =>
          application.updateAccountPartial(
            wrappedStates,
            localCache,
            applyResponse
          )
      } else {
        throw new Error(
          'Missing requried interface function. updateAccountPartial()'
        )
      }

      if (typeof application.getRelevantData === 'function') {
        applicationInterfaceImpl.getRelevantData = async (accountId, tx) =>
          application.getRelevantData(accountId, tx)
      } else {
        throw new Error(
          'Missing requried interface function. getRelevantData()'
        )
      }

      if (typeof application.getKeyFromTransaction === 'function') {
        applicationInterfaceImpl.getKeyFromTransaction =
          application.getKeyFromTransaction
      } else {
        throw new Error(
          'Missing requried interface function. getKeysFromTransaction()'
        )
      }

      if (typeof application.getStateId === 'function') {
        applicationInterfaceImpl.getStateId = async (
          accountAddress,
          mustExist
        ) => application.getStateId(accountAddress, mustExist)
      } else {
        // throw new Error('Missing requried interface function. getStateId()')
        this.mainLogger.debug('getStateId not used by global server')
      }

      // opitonal methods
      if (typeof application.close === 'function') {
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
      if (typeof application.getAccountData === 'function') {
        applicationInterfaceImpl.getAccountData = async (
          accountStart,
          accountEnd,
          maxRecords
        ) => application.getAccountData(accountStart, accountEnd, maxRecords)
      } else {
        throw new Error('Missing requried interface function. getAccountData()')
      }

      if (typeof application.getAccountDataByRange === 'function') {
        applicationInterfaceImpl.getAccountDataByRange = async (
          accountStart,
          accountEnd,
          tsStart,
          tsEnd,
          maxRecords
        ) =>
          application.getAccountDataByRange(
            accountStart,
            accountEnd,
            tsStart,
            tsEnd,
            maxRecords
          )
      } else {
        throw new Error(
          'Missing requried interface function. getAccountDataByRange()'
        )
      }

      if (typeof application.calculateAccountHash === 'function') {
        applicationInterfaceImpl.calculateAccountHash = account =>
          application.calculateAccountHash(account)
      } else {
        throw new Error(
          'Missing requried interface function. calculateAccountHash()'
        )
      }

      // App.set_account_data (Acc_records)
      // Acc_records - as provided by App.get_accounts
      // Stores the records into the Accounts table if the hash of the Acc_data matches State_id
      // Returns a list of failed Acc_id
      if (typeof application.setAccountData === 'function') {
        applicationInterfaceImpl.setAccountData = async accountRecords =>
          application.setAccountData(accountRecords)
      } else {
        throw new Error('Missing requried interface function. setAccountData()')
      }

      // pass array of account copies to this (only looks at the data field) and it will reset the account state
      if (typeof application.resetAccountData === 'function') {
        applicationInterfaceImpl.resetAccountData = async accountRecords =>
          application.resetAccountData(accountRecords)
      } else {
        throw new Error(
          'Missing requried interface function. resetAccountData()'
        )
      }

      // pass array of account ids to this and it will delete the accounts
      if (typeof application.deleteAccountData === 'function') {
        applicationInterfaceImpl.deleteAccountData = async addressList =>
          application.deleteAccountData(addressList)
      } else {
        throw new Error(
          'Missing requried interface function. deleteAccountData()'
        )
      }

      if (typeof application.getAccountDataByList === 'function') {
        applicationInterfaceImpl.getAccountDataByList = async addressList =>
          application.getAccountDataByList(addressList)
      } else {
        throw new Error(
          'Missing requried interface function. getAccountDataByList()'
        )
      }
      if (typeof application.deleteLocalAccountData === 'function') {
        applicationInterfaceImpl.deleteLocalAccountData = async () =>
          application.deleteLocalAccountData()
      } else {
        throw new Error(
          'Missing requried interface function. deleteLocalAccountData()'
        )
      }
      if (typeof application.getAccountDebugValue === 'function') {
        applicationInterfaceImpl.getAccountDebugValue = wrappedAccount =>
          application.getAccountDebugValue(wrappedAccount)
      } else {
        applicationInterfaceImpl.getAccountDebugValue = wrappedAccount =>
          'getAccountDebugValue() missing on app'
        // throw new Error('Missing requried interface function. deleteLocalAccountData()')
      }

      if (typeof application.canDebugDropTx === 'function') {
        applicationInterfaceImpl.canDebugDropTx = tx =>
          application.canDebugDropTx(tx)
      } else {
        applicationInterfaceImpl.canDebugDropTx = tx => true
      }

      if (typeof application.sync === 'function') {
        applicationInterfaceImpl.sync = async () => application.sync()
      } else {
        const thisPtr = this
        applicationInterfaceImpl.sync = async function() {
          thisPtr.mainLogger.debug('no app.sync() function defined')
        }
      }
    } catch (ex) {
      this.fatalLogger.fatal(
        `Required application interface not implemented. Exception: ${ex}`
      )
      this.fatalLogger.fatal(
        '_getApplicationInterface: ' +
          ex.name +
          ': ' +
          ex.message +
          ' at ' +
          ex.stack
      )
      throw new Error(ex)
    }
    this.mainLogger.debug('End of _getApplicationInterfaces()')

    // hack to force this to the correct answer.. not sure why other type correction methods did not work..
    return /** @type {App} */ /** @type {unknown} */ applicationInterfaceImpl
    // return applicationInterfaceImpl
  }

  /**
   * Register the exit and config routes
   */
  _registerRoutes() {
    // DEBUG routes
    // TODO: Remove eventually, or at least route guard these
    this.network.registerExternalPost('exit', async (req, res) => {
      res.json({ success: true })
      await this.shutdown()
    })

    this.network.registerExternalGet('config', async (req, res) => {
      res.json({ config: this.config })
    })
    // FOR internal testing. NEEDS to be removed for security purposes
    this.network.registerExternalPost(
      'testGlobalAccountTX',
      async (req, res) => {
        try {
          this.mainLogger.debug(
            `testGlobalAccountTX: req:${utils.stringifyReduce(req.body)}`
          )
          let tx = req.body.tx
          this.put(tx, false, true)
          res.json({ success: true })
        } catch (ex) {
          this.mainLogger.debug(
            'testGlobalAccountTX:' +
              ex.name +
              ': ' +
              ex.message +
              ' at ' +
              ex.stack
          )
          this.fatalLogger.fatal(
            'testGlobalAccountTX:' +
              ex.name +
              ': ' +
              ex.message +
              ' at ' +
              ex.stack
          )
        }
      }
    )

    this.network.registerExternalPost(
      'testGlobalAccountTXSet',
      async (req, res) => {
        try {
          this.mainLogger.debug(
            `testGlobalAccountTXSet: req:${utils.stringifyReduce(req.body)}`
          )
          let tx = req.body.tx
          this.put(tx, true, true)
          res.json({ success: true })
        } catch (ex) {
          this.mainLogger.debug(
            'testGlobalAccountTXSet:' +
              ex.name +
              ': ' +
              ex.message +
              ' at ' +
              ex.stack
          )
          this.fatalLogger.fatal(
            'testGlobalAccountTXSet:' +
              ex.name +
              ': ' +
              ex.message +
              ' at ' +
              ex.stack
          )
        }
      }
    )
  }

  /**
   * Registers exception handlers for "uncaughtException" and "unhandledRejection"
   */
  registerExceptionHandler() {
    const logFatalAndExit = err => {
      console.log('Encountered a fatal error. Check fatal log for details.')
      this.fatalLogger.fatal('unhandledRejection: ' + err.stack)
      // this.exitHandler.exitCleanly()

      this.exitHandler.exitUncleanly()
    }
    process.on('uncaughtException', err => {
      logFatalAndExit(err)
    })
    process.on('unhandledRejection', err => {
      logFatalAndExit(err)
    })
  }

  /**
   * Records a timestamp in a heartbeat to the storage module
   */
  async _writeHeartbeat() {
    const timestamp = utils.getTime('s')
    await this.storage.setProperty('heartbeat', timestamp)
  }

  /**
   * Sets up the heartbeat interval for keeping track of time alive
   */
  _setupHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      await this._writeHeartbeat()
    }, this.heartbeatInterval * 1000)
  }

  /**
   * Stops the heartbeat interval
   */
  _stopHeartbeat() {
    this.mainLogger.info('Stopping heartbeat...')
    clearInterval(this.heartbeatTimer)
  }

  /**
   * Checks a transaction timestamp for expiration
   * @param {number} timestamp
   */
  _isTransactionTimestampExpired(timestamp) {
    // this.mainLogger.debug(`Start of _isTransactionTimestampExpired(${timestamp})`)
    let transactionExpired = false
    const txnExprationTime = this.config.transactionExpireTime
    const currNodeTimestamp = Date.now()

    const txnAge = currNodeTimestamp - timestamp
    this.mainLogger
      .debug(`Transaction Timestamp: ${timestamp} CurrNodeTimestamp: ${currNodeTimestamp}
    txnExprationTime: ${txnExprationTime}   TransactionAge: ${txnAge}`)

    // this.mainLogger.debug(`TransactionAge: ${txnAge}`)
    if (txnAge >= txnExprationTime * 1000) {
      this.fatalLogger.error(`Transaction Expired`)
      transactionExpired = true
    }
    // this.mainLogger.debug(`End of _isTransactionTimestampExpired(${timestamp})`)
    return transactionExpired
  }

  setGlobal(address, value, when, source) {
    GlobalAccounts.setGlobal(address, value, when, source)
  }
}

// tslint:disable-next-line: no-default-export
export default Shardus
