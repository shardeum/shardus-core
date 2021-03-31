import { EventEmitter } from 'events'
import Log4js from 'log4js'
import path from 'path'
import Consensus from '../consensus'
import Crypto from '../crypto'
import Debug from '../debug'
import ExitHandler from '../exit-handler'
import LoadDetection from '../load-detection'
import Logger, {logFlags} from '../logger'
import * as Network from '../network'
import * as Context from '../p2p/Context'
import * as CycleChain from '../p2p/CycleChain'
import * as GlobalAccounts from '../p2p/GlobalAccounts'
import { reportLost } from '../p2p/Lost'
import * as Self from '../p2p/Self'
import * as Wrapper from '../p2p/Wrapper'
import RateLimiting from '../rate-limiting'
import Reporter from '../reporter'
import * as Snapshot from '../snapshot'
import StateManager from '../state-manager'
import Statistics from '../statistics'
import Storage from '../storage'
import * as utils from '../utils'
import Profiler from '../utils/profiler'
import NestedCounters from '../utils/nestedCounters'
import MemoryReporting from '../utils/memoryReporting'
import ShardusTypes = require('../shardus/shardus-types')
import * as Archivers from '../p2p/Archivers'
import * as AutoScaling from '../p2p/CycleAutoScale'
import { currentCycle, currentQuarter } from '../p2p/CycleCreator'
import { nestedCountersInstance } from '../utils/nestedCounters'
// the following can be removed now since we are not using the old p2p code
//const P2P = require('../p2p')
const allZeroes64 = '0'.repeat(64)
const saveConsoleOutput = require('./saveConsoleOutput')

const defaultConfigs = {
  server: require('../config/server.json'),
  logs: require('../config/logs.json'),
  storage: require('../config/storage.json'),
} as {
  server: ShardusTypes.ShardusConfiguration
  logs: ShardusTypes.LogsConfiguration
  storage: ShardusTypes.StorageConfiguration
}
Context.setDefaultConfigs(defaultConfigs)

interface Shardus {
  io: SocketIO.Server
  profiler: Profiler
  nestedCounters: NestedCounters
  memoryReporting: MemoryReporting
  config: ShardusTypes.ShardusConfiguration
  
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
    this.nestedCounters = new NestedCounters()    
    this.memoryReporting = new MemoryReporting(this)
    this.profiler = new Profiler()
    this.config = config
    Context.setConfig(this.config)
    logFlags.verbose = false
    this.logger = new Logger(config.baseDir, logsConfig)
    Context.setLoggerContext(this.logger)
    Snapshot.initLogger()

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
    Context.setStorageContext(this.storage)
    this.crypto = new Crypto(this.config, this.logger, this.storage)
    Context.setCryptoContext(this.crypto)
    this.network = new Network.NetworkClass(config.network, this.logger)
    Context.setNetworkContext(this.network)

    // Set the old P2P to a Wrapper into the new P2P
    // [TODO] Remove this once everything calls p2p/* modules directly
    this.p2p = Wrapper.p2p
    Context.setP2pContext(this.p2p)

    this.debug = null
    this.consensus = null
    this.appProvided = null
    this.app = null
    this.reporter = null
    this.stateManager = null
    this.statistics = null
    this.loadDetection = null
    this.rateLimiting = null

    if(logFlags.info) {
      this.mainLogger.info(`Server started with pid: ${process.pid}`)
      this.mainLogger.info('===== Server config: =====')
      this.mainLogger.info(JSON.stringify(config, null, 2))
    }
    this._listeners = {}

    this.heartbeatInterval = config.heartbeatInterval
    this.heartbeatTimer = null

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
        this.mainLogger.info('Stopping reporter...')
        this.reporter.stopReporting()
      }
    })
    this.exitHandler.registerAsync('application', async () => {
      if (this.app && this.app.close) {
        this.mainLogger.info('Shutting down the application...')
        await this.app.close() // this needs to be awaited since it is async
      }
    })
    this.exitHandler.registerSync('crypto', () => {
      this.mainLogger.info('Stopping POW generators...')
      this.crypto.stopAllGenerators()
    })
    this.exitHandler.registerSync('cycleCreator', () => {
      // [TODO] - need to make an exitHandler for P2P; otherwise CycleCreator is continuing even after rest of the system cleans up and is ready to exit
      this.mainLogger.info('Shutting down p2p...')
      this.p2p.shutdown()
    })
    this.exitHandler.registerAsync('network', async () => {
      this.mainLogger.info('Shutting down networking...')
      await this.network.shutdown() // this is taking a long time
    })
    this.exitHandler.registerAsync('storage', async () => {
      this.mainLogger.info('Closing Database connections...')
      await this.storage.close()
    })
    /* moved stopping the application to earlier
    this.exitHandler.registerAsync('application', async () => {
      if (this.app && this.app.close) {
        this.mainLogger.info('Shutting down the application...')
        await this.app.close()  // this needs to be awaited since it is async
      }
    })
    */
    this.exitHandler.registerAsync('logger', async () => {
      this.mainLogger.info('Shutting down logs...')
      await this.logger.shutdown()
    })


    this.profiler.registerEndpoints()
    this.nestedCounters.registerEndpoints()
    this.memoryReporting.registerEndpoints()
    this.logger.registerEndpoints(Context)

    this.logger.playbackLogState('constructed', '', '')
  }

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
  //       queueLength: () => this.stateManager ? this.stateManager.transactionQueue.newAcceptedTxQueue.length : 0,
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
    this.io = await this.network.setup(Network.ipInfo) as SocketIO.Server
    Context.setIOContext(this.io)
    let connectedSockets = {}
    this.io.on('connection', (socket: any) => {
      console.log(`Archive server has subscribed to this node with socket id ${socket.id}!`)
      socket.on('ARCHIVER_PUBLIC_KEY', function(ARCHIVER_PUBLIC_KEY) {
        console.log('Archiver has registered its public key', ARCHIVER_PUBLIC_KEY)
        connectedSockets[socket.id] = ARCHIVER_PUBLIC_KEY
      })
      socket.on('UNSUBSCRIBE', function(ARCHIVER_PUBLIC_KEY) {
        console.log(`Archive server has with public key ${ARCHIVER_PUBLIC_KEY} request to unsubscribe`)
        console.log('connectedSockets', connectedSockets)
        Archivers.removeDataRecipient(ARCHIVER_PUBLIC_KEY)
        
      })
    })
    this.network.on('timeout', (node) => {
      console.log('in Shardus got network timeout from', node)
      reportLost(node, 'timeout')
      /** [TODO] Report lost */
    })
    this.network.on('error', (node) => {
      console.log('in Shardus got network error from', node)
      reportLost(node, 'error')
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
            this.stateManager ? this.stateManager.transactionQueue.newAcceptedTxQueue.length : 0,
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
      console.log(`High load detected Cycle ${currentCycle}, Quarter: ${currentQuarter}`)
      nestedCountersInstance.countEvent('loadRelated','highLoad')
      await AutoScaling.requestNetworkUpsize()
    })
    this.loadDetection.on('lowLoad', async () => {
      console.log(`Low load detected Cycle ${currentCycle}, Quarter: ${currentQuarter}`)
      nestedCountersInstance.countEvent('loadRelated','lowLoad')
      await AutoScaling.requestNetworkDownsize()
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

      // Start state snapshotting once you go active with an app
      this.once('active', Snapshot.startSnapshotting)
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

    // this.io.on('disconnect')

    // Register listeners for P2P events
    Self.emitter.on('witnessing', async (publicKey) => {
      this.logger.playbackLogState('witnessing', '', publicKey)
      await Snapshot.startWitnessMode()
    })
    Self.emitter.on('joining', (publicKey) => {
      this.io.emit('DATA', `NODE JOINING ${publicKey}`)
      this.logger.playbackLogState('joining', '', publicKey)
      if (this.reporter) this.reporter.reportJoining(publicKey)
    })
    Self.emitter.on('joined', (nodeId, publicKey) => {
      this.io.emit('DATA', `NODE JOINED ${nodeId}`)
      this.logger.playbackLogState('joined', nodeId, publicKey)
      this.logger.setPlaybackID(nodeId)
      if (this.reporter) this.reporter.reportJoined(nodeId, publicKey)
    })
    Self.emitter.on('initialized', async () => {
      // If network is in safety mode
      const newest = CycleChain.getNewest()
      if (newest && newest.safetyMode === true) {
        // Use snapshot to put old app data into state-manager then go active
        await Snapshot.safetySync()
      } else {
        await this.syncAppData()
      }
    })
    Self.emitter.on('active', (nodeId) => {
      this.io.emit('DATA', `NODE ACTIVE ${nodeId}`)
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
    Self.emitter.on('error', (e) => {
      console.log(e.message + ' at ' + e.stack)
      if (logFlags.debug) this.mainLogger.debug('shardus.start() ' + e.message + ' at ' + e.stack)
      // normally fatal error keys should not be variable ut this seems like an ok exception for now
      this.shardus_fatal(`onError_ex` + e.message + ' at ' + e.stack, 'shardus.start() ' + e.message + ' at ' + e.stack)
      throw new Error(e)
    })
    Self.emitter.on('removed', async () => {
      // Omar - Why are we trying to call the functions in modules directly before exiting.
      //        The modules have already registered shutdown functions with the exitHandler.
      //        We should let exitHandler handle the shutdown process.
      /*
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
*/
      if (this.reporter) {
        this.reporter.stopReporting()
        await this.reporter.reportRemoved(Self.id)
      }
      this.exitHandler.exitCleanly() // exits with status 0 so that PM2 can restart the process
    })
    Self.emitter.on('apoptosized', async (restart) => {
      // Omar - Why are we trying to call the functions in modules directly before exiting.
      //        The modules have already registered shutdown functions with the exitHandler.
      //        We should let exitHandler handle the shutdown process.
      /*
      this.fatalLogger.fatal('Shardus: caught apoptosized event; cleaning up')
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
      this.fatalLogger.fatal(
        'Shardus: caught apoptosized event; finished clean up'
      )
*/
      if (this.reporter) {
        this.reporter.stopReporting()
        await this.reporter.reportRemoved(Self.id)
      }
      if (restart) this.exitHandler.exitCleanly()
      // exits with status 0 so that PM2 can restart the process
      else this.exitHandler.exitUncleanly() // exits with status 0 so that PM2 can restart the process
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
      this.shardus_fatal(`_registerListener_dupe`,
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
    this._registerListener(this.stateManager.eventEmitter, 'txQueued', (txId) =>
      this.statistics.startTimer('txTimeInQueue', txId)
    )
    this._registerListener(this.stateManager.eventEmitter, 'txPopped', (txId) =>
      this.statistics.stopTimer('txTimeInQueue', txId)
    )
    this._registerListener(this.stateManager.eventEmitter, 'txApplied', () =>
      this.statistics.incrementCounter('txApplied')
    )
    this._registerListener(this.stateManager.eventEmitter, 'txProcessed', () =>
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
          boolean,
          boolean
        ]
      ) => this.stateManager.transactionQueue.routeAndQueueAcceptedTransaction(...txArgs)
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
      if (this.stateManager) {
        this.stateManager.appFinishedSyncing = true
      }
      return
    }
    if (this.stateManager) await this.stateManager.accountSync.syncStateData(3)
    // if (this.stateManager) await this.stateManager.accountSync.syncStateDataFast(3) // fast mode
    console.log('syncAppData')
    if (this.p2p.isFirstSeed) {
      await this.p2p.goActive()
      console.log('syncAppData - goActive')
      await this.stateManager.waitForShardCalcs()
      await this.app.sync()
      console.log('syncAppData - sync')
      this.stateManager.appFinishedSyncing = true
    } else {
      await this.stateManager.startCatchUpQueue()
      console.log('syncAppData - startCatchUpQueue')
      await this.app.sync()
      console.log('syncAppData - sync')
      await this.p2p.goActive()
      console.log('syncAppData - goActive')
      this.stateManager.appFinishedSyncing = true
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

      this.stateManager.partitionObjects.startSyncPartitions()
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
  put (tx, set = false, global = false) {
    this.io.emit('DATA', tx)
    let noConsensus = set || global

    if (!this.appProvided)
      throw new Error(
        'Please provide an App object to Shardus.setup before calling Shardus.put'
      )

    if (logFlags.verbose)
      this.mainLogger.debug(`Start of injectTransaction ${JSON.stringify(tx)} set:${set} global:${global}`) // not reducing tx here so we can get the long hashes

    if (!this.stateManager.accountSync.dataSyncMainPhaseComplete) {
      this.statistics.incrementCounter('txRejected')
      nestedCountersInstance.countEvent('rejected','!dataSyncMainPhaseComplete')
      return { success: false, reason: 'Node is still syncing.' }
    }

    if (!this.stateManager.hasCycleShardData()) {
      this.statistics.incrementCounter('txRejected')
      nestedCountersInstance.countEvent('rejected','!hasCycleShardData')
      return {
        success: false,
        reason: 'Not ready to accept transactions, shard calculations pending',
      }
    }

    if (set === false) {
      if (!this.p2p.allowTransactions()) {
        if(global === true && this.p2p.allowSet()){
          // This ok because we are initializing a global at the set time period
        } else {
          if (logFlags.verbose) this.mainLogger.debug(`txRejected ${JSON.stringify(tx)} set:${set} global:${global}`)

          this.statistics.incrementCounter('txRejected')
          nestedCountersInstance.countEvent('rejected','!allowTransactions')
          return {
            success: false,
            reason: 'Network conditions to allow transactions are not met.',
          }
        }
      }
    } else {
      if (!this.p2p.allowSet()) {
        this.statistics.incrementCounter('txRejected')
        nestedCountersInstance.countEvent('rejected','!allowTransactions2')
        return {
          success: false,
          reason: 'Network conditions to allow app init via set',
        }
      }
    }

    if (this.rateLimiting.isOverloaded()) {
      this.statistics.incrementCounter('txRejected')
      nestedCountersInstance.countEvent('loadRelated','txRejected')
      nestedCountersInstance.countEvent('rejected','isOverloaded')
      return { success: false, reason: 'Maximum load exceeded.' }
    }

    if (typeof tx !== 'object') {
      this.statistics.incrementCounter('txRejected')
      nestedCountersInstance.countEvent('rejected','tx !== object')
      return {
        success: false,
        reason: `Invalid Transaction! ${utils.stringifyReduce(tx)}`,
      }
    }

    try {
      // Perform basic validation of the transaction fields
      if (logFlags.verbose)
        this.mainLogger.debug(
          'Performing initial validation of the transaction'
        )
      const initValidationResp = this.app.validateTxnFields(tx)
      if (logFlags.verbose)
        this.mainLogger.debug(
          `InitialValidationResponse: ${utils.stringifyReduce(
            initValidationResp
          )}`
        )

      if(initValidationResp.success !== true){
        return { success: false, reason: `Validation Failed` }
      }

      // Validate the transaction timestamp
      const timestamp = initValidationResp.txnTimestamp
      if (this._isTransactionTimestampExpired(timestamp)) {
        this.shardus_fatal(`put_txExpired`,
          `Transaction Expired: ${utils.stringifyReduce(tx)}`
        )
        this.statistics.incrementCounter('txRejected')
        nestedCountersInstance.countEvent('rejected','_isTransactionTimestampExpired')
        return { success: false, reason: 'Transaction Expired' }
      }

      const shardusTx: any = {}
      shardusTx.receivedTimestamp = Date.now()
      shardusTx.inTransaction = tx
      const txId = this.crypto.hash(tx)

      if (logFlags.verbose)
        this.mainLogger.debug(
          `shardusTx. shortTxID: ${txId} txID: ${utils.makeShortHash(
            txId
          )} TX data: ${utils.stringifyReduce(shardusTx)}`
        )
      this.profiler.profileSectionStart('put')

      const signedShardusTx = this.crypto.sign(shardusTx)

      if (logFlags.verbose) this.mainLogger.debug('Transaction validated')
      this.statistics.incrementCounter('txInjected')
      this.logger.playbackLogNote(
        'tx_injected',
        `${txId}`,
        `Transaction: ${utils.stringifyReduce(tx)}`
      )
      //this.profiler.profileSectionStart('consensusInject')

      this.consensus.inject(signedShardusTx, global, noConsensus).then((txReceipt) => {
      //this.profiler.profileSectionEnd('consensusInject')
        if (logFlags.verbose)
          this.mainLogger.debug(
            `Received Consensus. Receipt: ${utils.stringifyReduce(txReceipt)}`
          )
      })
    } catch (err) {
      this.shardus_fatal(`put_ex_` + err.message,
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

    if (logFlags.verbose)
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

  getCycleMarker() {
    return this.p2p.getCycleMarker()
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
    return this.stateManager.getClosestNodes(hash, count).map((node) => node.id)
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
      appDefinedData: {}
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
      stateId: stateAfter, // duplicate of hash.., really need to go back and add types to this
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
    if (logFlags.debug) this.mainLogger.debug('Start of _getApplicationInterfaces()')
    const applicationInterfaceImpl: any = {}
    try {
      if (application == null) {
        // throw new Error('Invalid Application Instance')
        return null
      }

      if (typeof application.validateTxnFields === 'function') {
        applicationInterfaceImpl.validateTxnFields = (inTx) =>
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

      if (typeof application.transactionReceiptPass === 'function') {
        applicationInterfaceImpl.transactionReceiptPass = async (tx, wrappedStates, applyResponse) => application.transactionReceiptPass(tx, wrappedStates, applyResponse)
      } else {
        applicationInterfaceImpl.transactionReceiptPass = async function (tx, wrappedStates, applyResponse) {
        }
      }

      if (typeof application.transactionReceiptFail === 'function') {
        applicationInterfaceImpl.transactionReceiptFail = async (tx, wrappedStates, applyResponse) => application.transactionReceiptFail(tx, wrappedStates, applyResponse)
      } else {
        applicationInterfaceImpl.transactionReceiptFail = async function (tx, wrappedStates, applyResponse) {
        }
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
        if (logFlags.debug) this.mainLogger.debug('getStateId not used by global server')
      }

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
        applicationInterfaceImpl.calculateAccountHash = (account) =>
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
        applicationInterfaceImpl.setAccountData = async (accountRecords) =>
          application.setAccountData(accountRecords)
      } else {
        throw new Error('Missing requried interface function. setAccountData()')
      }

      // pass array of account copies to this (only looks at the data field) and it will reset the account state
      if (typeof application.resetAccountData === 'function') {
        applicationInterfaceImpl.resetAccountData = async (accountRecords) =>
          application.resetAccountData(accountRecords)
      } else {
        throw new Error(
          'Missing requried interface function. resetAccountData()'
        )
      }

      // pass array of account ids to this and it will delete the accounts
      if (typeof application.deleteAccountData === 'function') {
        applicationInterfaceImpl.deleteAccountData = async (addressList) =>
          application.deleteAccountData(addressList)
      } else {
        throw new Error(
          'Missing requried interface function. deleteAccountData()'
        )
      }

      if (typeof application.getAccountDataByList === 'function') {
        applicationInterfaceImpl.getAccountDataByList = async (addressList) =>
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
        applicationInterfaceImpl.getAccountDebugValue = (wrappedAccount) =>
          application.getAccountDebugValue(wrappedAccount)
      } else {
        applicationInterfaceImpl.getAccountDebugValue = (wrappedAccount) =>
          'getAccountDebugValue() missing on app'
        // throw new Error('Missing requried interface function. deleteLocalAccountData()')
      }

      if (typeof application.canDebugDropTx === 'function') {
        applicationInterfaceImpl.canDebugDropTx = (tx) =>
          application.canDebugDropTx(tx)
      } else {
        applicationInterfaceImpl.canDebugDropTx = (tx) => true
      }

      if (typeof application.sync === 'function') {
        applicationInterfaceImpl.sync = async () => application.sync()
      } else {
        const thisPtr = this
        applicationInterfaceImpl.sync = async function () {
          thisPtr.mainLogger.debug('no app.sync() function defined')
        }
      }

      if (typeof application.dataSummaryInit === 'function') {
        applicationInterfaceImpl.dataSummaryInit = async (blob, accountData) => application.dataSummaryInit(blob, accountData)
      } else {
        applicationInterfaceImpl.dataSummaryInit = async function (blob, accountData) {
          //thisPtr.mainLogger.debug('no app.dataSummaryInit() function defined')
        }
      }
      if (typeof application.dataSummaryUpdate === 'function') {
        applicationInterfaceImpl.dataSummaryUpdate = async (blob, accountDataBefore, accountDataAfter) => application.dataSummaryUpdate(blob, accountDataBefore, accountDataAfter)
      } else {
        applicationInterfaceImpl.dataSummaryUpdate = async function (blob, accountDataBefore, accountDataAfter) {
          //thisPtr.mainLogger.debug('no app.dataSummaryUpdate() function defined')
        }
      }
      if (typeof application.txSummaryUpdate === 'function') {
        applicationInterfaceImpl.txSummaryUpdate = async (blob, tx, wrappedStates) => application.txSummaryUpdate(blob, tx, wrappedStates)
      } else {
        applicationInterfaceImpl.txSummaryUpdate = async function (blob, tx, wrappedStates) {
          //thisPtr.mainLogger.debug('no app.txSummaryUpdate() function defined')
        }
      }

      if (typeof application.getAccountTimestamp === 'function') {
        //getAccountTimestamp(accountAddress, mustExist = true)
        applicationInterfaceImpl.getAccountTimestamp = async (accountAddress, mustExist) => application.getAccountTimestamp(accountAddress, mustExist)
      } else {
        applicationInterfaceImpl.getAccountTimestamp = async function (accountAddress, mustExist) {
          //thisPtr.mainLogger.debug('no app.getAccountTimestamp() function defined')
          return 0
        }
      }
      
      if (typeof application.getTimestampAndHashFromAccount === 'function') {
        applicationInterfaceImpl.getTimestampAndHashFromAccount = (account) => application.getTimestampAndHashFromAccount(account)
      } else {
        applicationInterfaceImpl.getTimestampAndHashFromAccount = function (account) {
          return {timestamp:0, hash:'getTimestampAndHashFromAccount not impl'}
        }
      }
      //txSummaryUpdate: (blob: any, tx: any, wrappedStates: any)

    } catch (ex) {
      this.shardus_fatal(`getAppInterface_ex`,
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
    if (logFlags.debug) this.mainLogger.debug('End of _getApplicationInterfaces()')

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
          const tx = req.body.tx
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
          this.shardus_fatal(`registerExternalPost_ex`,
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
          const tx = req.body.tx
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
          this.shardus_fatal(`registerExternalPost2_ex`,
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
    const logFatalAndExit = (err) => {
      console.log('Encountered a fatal error. Check fatal log for details.')
      this.shardus_fatal(`unhandledRejection_ex_`+ err.stack.substring(0,100), 'unhandledRejection: ' + err.stack)
      // this.exitHandler.exitCleanly()

      this.exitHandler.exitUncleanly()
    }
    process.on('uncaughtException', (err) => {
      logFatalAndExit(err)
    })
    process.on('unhandledRejection', (err) => {
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
    if(logFlags.debug) this.mainLogger
      .debug(`Transaction Timestamp: ${timestamp} CurrNodeTimestamp: ${currNodeTimestamp}
    txnExprationTime: ${txnExprationTime}   TransactionAge: ${txnAge}`)

    // this.mainLogger.debug(`TransactionAge: ${txnAge}`)
    if (txnAge >= txnExprationTime * 1000) {
      this.fatalLogger.error('Transaction Expired')
      transactionExpired = true
    }
    // this.mainLogger.debug(`End of _isTransactionTimestampExpired(${timestamp})`)
    return transactionExpired
  }

  setGlobal(address, value, when, source) {
    GlobalAccounts.setGlobal(address, value, when, source)
  }

  shardus_fatal(key, log, log2=null){
    nestedCountersInstance.countEvent('fatal-log', key)

    if(log2 != null){
      this.fatalLogger.fatal(log, log2)
    } else {
      this.fatalLogger.fatal(log)
    }
    
  }

}

// tslint:disable-next-line: no-default-export
export default Shardus
