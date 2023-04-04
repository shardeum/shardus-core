import { NodeStatus } from '@shardus/types/build/src/p2p/P2PTypes'
import { EventEmitter } from 'events'
import { Handler } from 'express'
import Log4js from 'log4js'
import path from 'path'
import SHARDUS_CONFIG from '../config'
import Crypto from '../crypto'
import Debug, { getDevPublicKey } from '../debug'
import ExitHandler from '../exit-handler'
import LoadDetection from '../load-detection'
import Logger, { logFlags, LogFlags } from '../logger'
import * as Network from '../network'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import { isApopMarkedNode } from '../p2p/Apoptosis'
import * as Archivers from '../p2p/Archivers'
import * as Context from '../p2p/Context'
import * as AutoScaling from '../p2p/CycleAutoScale'
import * as CycleChain from '../p2p/CycleChain'
import { netConfig } from '../p2p/CycleCreator'
import * as GlobalAccounts from '../p2p/GlobalAccounts'
import { reportLost } from '../p2p/Lost'
import * as Self from '../p2p/Self'
import * as Wrapper from '../p2p/Wrapper'
import RateLimiting from '../rate-limiting'
import Reporter from '../reporter'
import * as ShardusTypes from '../shardus/shardus-types'
import { WrappedData } from '../shardus/shardus-types'
import * as Snapshot from '../snapshot'
import StateManager from '../state-manager'
import { QueueCountsResult } from '../state-manager/state-manager-types'
import Statistics from '../statistics'
import Storage from '../storage'
import * as utils from '../utils'
import { groupResolvePromises, inRangeOfCurrentTime } from '../utils'
import MemoryReporting from '../utils/memoryReporting'
import NestedCounters, { nestedCountersInstance } from '../utils/nestedCounters'
import Profiler, { profilerInstance } from '../utils/profiler'
import { startSaving } from './saveConsoleOutput'

// the following can be removed now since we are not using the old p2p code
//const P2P = require('../p2p')
const allZeroes64 = '0'.repeat(64)

const defaultConfigs: ShardusTypes.StrictShardusConfiguration = SHARDUS_CONFIG

Context.setDefaultConfigs(defaultConfigs)

type RouteHandlerRegister = (route: string, authHandler: Handler, responseHandler?: Handler) => void

//todo make this a config parameter set by the dapp
const changeListGlobalAccount = '0'.repeat(64)

interface Shardus {
  io: SocketIO.Server
  profiler: Profiler
  nestedCounters: NestedCounters
  memoryReporting: MemoryReporting
  config: ShardusTypes.StrictServerConfiguration

  logger: Logger
  mainLogger: Log4js.Logger
  fatalLogger: Log4js.Logger
  appLogger: Log4js.Logger
  exitHandler: any
  storage: Storage
  crypto: Crypto
  network: Network.NetworkClass
  p2p: Wrapper.P2P
  debug: Debug
  appProvided: boolean
  app: ShardusTypes.App
  reporter: Reporter
  stateManager: StateManager
  statistics: Statistics
  loadDetection: LoadDetection
  rateLimiting: RateLimiting
  heartbeatInterval: number
  heartbeatTimer: NodeJS.Timeout
  registerExternalGet: RouteHandlerRegister
  registerExternalPost: RouteHandlerRegister
  registerExternalPut: RouteHandlerRegister
  registerExternalDelete: RouteHandlerRegister
  registerExternalPatch: RouteHandlerRegister
  _listeners: any
  appliedConfigChanges: Set<number>
}

/**
 * The main module that is used by the app developer to interact with the shardus api
 */
class Shardus extends EventEmitter {
  constructor(
    { server: config, logs: logsConfig, storage: storageConfig }: ShardusTypes.StrictShardusConfiguration,
    opts?: { customStringifier?: (val: any) => string }
  ) {
    super()
    this.nestedCounters = nestedCountersInstance
    this.memoryReporting = new MemoryReporting(this)
    this.profiler = new Profiler()
    this.config = config
    Context.setConfig(this.config)
    logFlags.verbose = false

    let startInFatalsLogMode = config && config.debug && config.debug.startInFatalsLogMode ? true : false
    let startInErrorsLogMode = config && config.debug && config.debug.startInErrorLogMode ? true : false

    let dynamicLogMode = ''
    if (startInFatalsLogMode === true) {
      dynamicLogMode = 'fatal'
    } else if (startInErrorsLogMode === true) {
      dynamicLogMode = 'error'
    }

    this.logger = new Logger(config.baseDir, logsConfig, dynamicLogMode)
    Context.setLoggerContext(this.logger)
    Snapshot.initLogger()

    const logDir = path.join(config.baseDir, logsConfig.dir)
    if (logsConfig.saveConsoleOutput) {
      startSaving(logDir)
    }

    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.appLogger = this.logger.getLogger('app')
    this.exitHandler = new ExitHandler(logDir, this.memoryReporting, this.nestedCounters)
    this.storage = new Storage(config.baseDir, storageConfig, config, this.logger, this.profiler)
    Context.setStorageContext(this.storage)
    this.crypto = new Crypto(config.baseDir, this.config, this.logger, this.storage)
    Context.setCryptoContext(this.crypto)
    this.network = new Network.NetworkClass(config, this.logger, opts?.customStringifier)
    Context.setNetworkContext(this.network)

    // Set the old P2P to a Wrapper into the new P2P
    // [TODO] Remove this once everything calls p2p/* modules directly
    this.p2p = Wrapper.p2p
    Context.setP2pContext(this.p2p)

    this.debug = null
    this.appProvided = null
    this.app = null
    this.reporter = null
    this.stateManager = null
    this.statistics = null
    this.loadDetection = null
    this.rateLimiting = null

    this.appliedConfigChanges = new Set()
    this.appliedConfigChanges.add(1) //ignore the first change in the list.

    if (logFlags.info) {
      this.mainLogger.info(`Server started with pid: ${process.pid}`)
      this.mainLogger.info('===== Server config: =====')
      this.mainLogger.info(JSON.stringify(config, null, 2))
    }

    // error log and console log on unacceptable minNodesToAllowTxs value
    // if (this.config.p2p.minNodesToAllowTxs < 20) {
    //   const minNodesToAllowTxs = this.config.p2p.minNodesToAllowTxs
    //   // debug mode and detected non-ideal value
    //   console.log(
    //     '[X] Minimum node required to allow transaction is set to a number less than 20 which is not ideal and secure for production'
    //   )
    //   if (this.config.mode === 'debug' && logFlags.error) {
    //     this.mainLogger.error(
    //       `Unacceptable \`minNodesToAllowTxs\` value detected: ${minNodesToAllowTxs} (< 20)`
    //     )
    //   }
    //   // production mode and detected non-ideal value
    //   else if (this.config.mode !== 'debug' && logFlags.error) {
    //     this.mainLogger.error(
    //       `Unacceptable \`minNodesToAllowTxs\` value detected: ${minNodesToAllowTxs} (< 20)`
    //     )
    //   }
    //   // for now they'd have the same error log
    //   // this is not as error per technical definition rather logical error
    // }

    this._listeners = {}

    this.heartbeatInterval = config.heartbeatInterval
    this.heartbeatTimer = null

    // alias the network register calls so that an app can get to them
    this.registerExternalGet = (route, authHandler, handler) =>
      this.network.registerExternalGet(route, authHandler, handler)
    this.registerExternalPost = (route, authHandler, handler) =>
      this.network.registerExternalPost(route, authHandler, handler)
    this.registerExternalPut = (route, authHandler, handler) =>
      this.network.registerExternalPut(route, authHandler, handler)
    this.registerExternalDelete = (route, authHandler, handler) =>
      this.network.registerExternalDelete(route, authHandler, handler)
    this.registerExternalPatch = (route, authHandler, handler) =>
      this.network.registerExternalPatch(route, authHandler, handler)

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
  setup(app: ShardusTypes.App) {
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

    try {
      this.io = (await this.network.setup(Network.ipInfo)) as SocketIO.Server
      Context.setIOContext(this.io)
      let maxArchiversSupport = 2 // Make this as part of the network config
      this.io.on('connection', (socket: any) => {
        if (this.config.features.archiverDataSubscriptionsUpdate) {
          console.log(`Archive server has subscribed to this node with socket id ${socket.id}!`)
          socket.on('ARCHIVER_PUBLIC_KEY', function (ARCHIVER_PUBLIC_KEY) {
            console.log('Archiver has registered its public key', ARCHIVER_PUBLIC_KEY)
            if (Archivers.recipients.get(ARCHIVER_PUBLIC_KEY)) {
              if (Archivers.connectedSockets[ARCHIVER_PUBLIC_KEY]) {
                Archivers.removeArchiverConnection(ARCHIVER_PUBLIC_KEY)
              }
              Archivers.addArchiverConnection(ARCHIVER_PUBLIC_KEY, socket.id)
            } else {
              socket.disconnect()
              console.log(
                'Archiver is not found in the recipients list and kill the socket connection',
                ARCHIVER_PUBLIC_KEY
              )
            }
          })
          socket.on('UNSUBSCRIBE', function (ARCHIVER_PUBLIC_KEY) {
            console.log(`Archive server has with public key ${ARCHIVER_PUBLIC_KEY} request to unsubscribe`)
            Archivers.removeArchiverConnection(ARCHIVER_PUBLIC_KEY)
          })
        } else {
          console.log(`Archive server has subscribed to this node with socket id ${socket.id}!`)
          socket.on('ARCHIVER_PUBLIC_KEY', function (ARCHIVER_PUBLIC_KEY) {
            console.log('Archiver has registered its public key', ARCHIVER_PUBLIC_KEY)
            for (const [key, value] of Object.entries(Archivers.connectedSockets)) {
              if (key === ARCHIVER_PUBLIC_KEY) {
                Archivers.removeArchiverConnection(ARCHIVER_PUBLIC_KEY)
              }
            }
            if (Object.keys(Archivers.connectedSockets).length >= maxArchiversSupport) {
              console.log(`There are already ${maxArchiversSupport} archivers connected for data transfer!`)
              socket.disconnect()
              return
            }
            Archivers.addArchiverConnection(ARCHIVER_PUBLIC_KEY, socket.id)
          })
          socket.on('UNSUBSCRIBE', function (ARCHIVER_PUBLIC_KEY) {
            console.log(`Archive server has with public key ${ARCHIVER_PUBLIC_KEY} request to unsubscribe`)
            Archivers.removeDataRecipient(ARCHIVER_PUBLIC_KEY)
            Archivers.removeArchiverConnection(ARCHIVER_PUBLIC_KEY)
          })
        }
      })
    } catch (e) {
      this.mainLogger.error('Socket connection break', e)
    }
    this.network.on('timeout', (node) => {
      console.log('in Shardus got network timeout from', node)
      const result = isApopMarkedNode(node.id)
      if (result) {
        return
      }
      reportLost(node, 'timeout')
      /** [TODO] Report lost */
      nestedCountersInstance.countEvent('lostNodes', 'timeout')

      nestedCountersInstance.countRareEvent('lostNodes', `timeout  ${node.internalIp}:${node.internalPort}`)
      if (this.network.statisticsInstance) this.network.statisticsInstance.incrementCounter('lostNodeTimeout')
    })
    this.network.on('error', (node) => {
      console.log('in Shardus got network error from', node)
      reportLost(node, 'error')
      /** [TODO] Report lost */
      nestedCountersInstance.countEvent('lostNodes', 'error')
    })

    // Setup storage
    await this.storage.init()

    // Setup crypto
    await this.crypto.init()

    // Setup other modules
    this.debug = new Debug(this.config.baseDir, this.network)
    this.debug.addToArchive(this.logger.logDir, './logs')
    this.debug.addToArchive(path.parse(this.storage.storage.storageConfig.options.storage).dir, './db')

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
          'networkTimeout',
          'lostNodeTimeout',
        ],
        watchers: {
          queueLength: () =>
            this.stateManager ? this.stateManager.transactionQueue._transactionQueue.length : 0,
          executeQueueLength: () =>
            this.stateManager ? this.stateManager.transactionQueue.getExecuteQueueLength() : 0,
          serverLoad: () => (this.loadDetection ? this.loadDetection.getCurrentLoad() : 0),
        },
        timers: ['txTimeInQueue'],
        manualStats: ['netInternalDuty', 'netExternalDuty', 'cpuPercent'],
        ringOverrides: { cpuPercent: 60 },
      },
      this
    )
    this.debug.addToArchive('./statistics.tsv', './statistics.tsv')

    this.profiler.setStatisticsInstance(this.statistics)
    this.network.setStatisticsInstance(this.statistics)

    this.statistics

    this.loadDetection = new LoadDetection(this.config.loadDetection, this.statistics)
    this.loadDetection.on('highLoad', () => {
      // console.log(`High load detected Cycle ${currentCycle}, Quarter: ${currentQuarter}`)
      nestedCountersInstance.countEvent('loadRelated', 'highLoad')
      AutoScaling.requestNetworkUpsize()
    })
    this.loadDetection.on('lowLoad', () => {
      // console.log(`Low load detected Cycle ${currentCycle}, Quarter: ${currentQuarter}`)
      nestedCountersInstance.countEvent('loadRelated', 'lowLoad')
      AutoScaling.requestNetworkDownsize()
    })

    this.statistics.on('snapshot', () => this.loadDetection.updateLoad())

    this.rateLimiting = new RateLimiting(this.config.rateLimiting, this.loadDetection)

    if (this.app) {
      this._createAndLinkStateManager()
      this._attemptCreateAppliedListener()

      let disableSnapshots = !!(
        this.config &&
        this.config.debug &&
        this.config.debug.disableSnapshots === true
      )
      if (disableSnapshots != true) {
        // Start state snapshotting once you go active with an app
        this.once('active', Snapshot.startSnapshotting)
      }
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
    Context.setReporterContext(this.reporter)

    this._registerRoutes()

    // this.io.on('disconnect')

    // Register listeners for P2P events
    Self.emitter.on('witnessing', async (publicKey) => {
      this.logger.playbackLogState('witnessing', '', publicKey)
      await Snapshot.startWitnessMode()
    })
    Self.emitter.on('joining', (publicKey) => {
      // this.io.emit('DATA', `NODE JOINING ${publicKey}`)
      this.logger.playbackLogState('joining', '', publicKey)
      if (this.reporter) this.reporter.reportJoining(publicKey)
    })
    Self.emitter.on('joined', (nodeId, publicKey) => {
      // this.io.emit('DATA', `NODE JOINED ${nodeId}`)
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
        // not doing a safety sync
        // todo hook this up later cant deal with it now.
        // await this.storage.deleteOldDBPath()

        await this.syncAppData()
      }
    })
    Self.emitter.on('active', (nodeId) => {
      // this.io.emit('DATA', `NODE ACTIVE ${nodeId}`)
      this.logger.playbackLogState('active', nodeId, '')
      if (this.reporter) {
        this.reporter.reportActive(nodeId)
        this.reporter.startReporting()
      }
      if (this.statistics) this.statistics.startSnapshots()
      this.emit('active', nodeId)
    })
    Self.emitter.on('failed', () => {
      this.mainLogger.info('shutdown: on failed event')
      this.shutdown(true)
    })
    Self.emitter.on('error', (e) => {
      console.log(e.message + ' at ' + e.stack)
      if (logFlags.debug) this.mainLogger.debug('shardus.start() ' + e.message + ' at ' + e.stack)
      // normally fatal error keys should not be variable ut this seems like an ok exception for now
      this.shardus_fatal(
        `onError_ex` + e.message + ' at ' + e.stack,
        'shardus.start() ' + e.message + ' at ' + e.stack
      )
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
      this.mainLogger.info(`exitCleanly: removed`)
      if (this.reporter) {
        this.reporter.stopReporting()
        await this.reporter.reportRemoved(Self.id)
      }
      this.exitHandler.exitCleanly(`removed`, `removed from network in normal conditions`) // exits with status 0 so that PM2 can restart the process
    })
    Self.emitter.on('apoptosized', async (callstack: string, message: string, restart: boolean) => {
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
      nestedCountersInstance.countRareEvent('fatal', 'exitCleanly: apoptosized (not technically fatal)')
      this.mainLogger.error('exitCleanly: apoptosized')
      this.mainLogger.error(message)
      this.mainLogger.error(callstack)
      if (this.reporter) {
        this.reporter.stopReporting()
        await this.reporter.reportRemoved(Self.id)
      }
      if (restart)
        this.exitHandler.exitCleanly(
          `Apoptosized`,
          `apoptosized by network but exiting cleanly for a restart`
        )
      // exits with status 0 so that PM2 can restart the process
      else this.exitHandler.exitUncleanly(`Apoptosized`, `apoptosized by network`) // exits with status 1 so that PM2 CANNOT restart the process
    })
    Self.emitter.on('node-activated', ({ ...params }) =>
      this.app.eventNotify?.({ type: 'node-activated', ...params })
    )
    Self.emitter.on('node-deactivated', ({ ...params }) =>
      this.app.eventNotify?.({ type: 'node-deactivated', ...params })
    )

    Context.setShardusContext(this)

    // Init new P2P
    Self.init()

    // Start P2P
    await Self.startup()

    // handle config queue changes and debug logic updates
    this._registerListener(this.p2p.state, 'cycle_q1_start', async () => {
      let lastCycle = CycleChain.getNewest()

      // need to make sure sync is finish or we may not have the global account
      // even worse, the dapp may not have initialized storage yet
      if (this.stateManager.appFinishedSyncing === true) {
        this.updateConfigChangeQueue(lastCycle)
      }

      this.updateDebug(lastCycle)
    })
  }

  /**
   * Function used to register event listeners
   * @param {*} emitter Socket emitter to be called
   * @param {*} event Event name to be registered
   * @param {*} callback Callback function to be executed on event
   */
  _registerListener(emitter, event, callback) {
    if (this._listeners[event]) {
      this.shardus_fatal(
        `_registerListener_dupe`,
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
      this.mainLogger.warn(`This event listener doesn't exist! Event: \`${event}\` in Shardus`)
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
      this.logger,
      this.storage,
      this.p2p,
      this.crypto,
      this.config
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
    if (this.stateManager) await this.stateManager.accountSync.initialSyncMain(3)
    // if (this.stateManager) await this.stateManager.accountSync.syncStateDataFast(3) // fast mode
    console.log('syncAppData')
    if (this.p2p.isFirstSeed) {
      await this.p2p.goActive()
      console.log('syncAppData - goActive')
      await this.stateManager.waitForShardCalcs()
      await this.app.sync()
      console.log('syncAppData - sync')
      this.stateManager.appFinishedSyncing = true
      Self.setp2pIgnoreJoinRequests(false)
      console.log('p2pIgnoreJoinRequests = false')
    } else {
      await this.stateManager.startCatchUpQueue()
      console.log('syncAppData - startCatchUpQueue')
      await this.app.sync()
      console.log('syncAppData - sync')
      Self.setp2pIgnoreJoinRequests(false)
      console.log('p2pIgnoreJoinRequests = false')
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

      //this.stateManager.partitionObjects.startSyncPartitions()
      this.stateManager.startProcessingCycleSummaries()
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
    if (logFlags.debug) {
      this.appLogger.debug(new Date(), ...data)
    }
  }

  /**
   * Gets log flags.
   * use these for to cull out slow log lines with stringify
   * if you pass comma separated objects to dapp.log you do not need this.
   * Also good for controlling console logging
   */
  getLogFlags(): LogFlags {
    return logFlags
  }

  /**
   * Submits a transaction to the network
   * Returns an object that tells whether a tx was successful or not and the reason why via the
   * validateTxnFields application SDK function.
   * Throws an error if an application was not provided to shardus.
   *
   * {
   *   success: boolean,
   *   reason: string,
   *   staus: number
   * }
   *
   */
  async put(
    tx: ShardusTypes.OpaqueTransaction,
    set = false,
    global = false
  ): Promise<{ success: boolean; reason: string; status: number }> {
    const noConsensus = set || global

    // Check if Consensor is ready to receive txs before processing it further
    if (!this.appProvided)
      throw new Error('Please provide an App object to Shardus.setup before calling Shardus.put')
    if (logFlags.verbose)
      this.mainLogger.debug(`Start of injectTransaction ${JSON.stringify(tx)} set:${set} global:${global}`) // not reducing tx here so we can get the long hashes
    if (!this.stateManager.accountSync.dataSyncMainPhaseComplete) {
      this.statistics.incrementCounter('txRejected')
      nestedCountersInstance.countEvent('rejected', '!dataSyncMainPhaseComplete')
      return { success: false, reason: 'Node is still syncing.', status: 500 }
    }
    if (!this.stateManager.hasCycleShardData()) {
      this.statistics.incrementCounter('txRejected')
      nestedCountersInstance.countEvent('rejected', '!hasCycleShardData')
      return {
        success: false,
        reason: 'Not ready to accept transactions, shard calculations pending',
        status: 500,
      }
    }
    if (set === false) {
      if (!this.p2p.allowTransactions()) {
        if (global === true && this.p2p.allowSet()) {
          // This ok because we are initializing a global at the set time period
        } else {
          if (logFlags.verbose)
            this.mainLogger.debug(`txRejected ${JSON.stringify(tx)} set:${set} global:${global}`)

          this.statistics.incrementCounter('txRejected')
          nestedCountersInstance.countEvent('rejected', '!allowTransactions')
          return {
            success: false,
            reason: 'Network conditions to allow transactions are not met.',
            status: 500,
          }
        }
      }
    } else {
      if (!this.p2p.allowSet()) {
        this.statistics.incrementCounter('txRejected')
        nestedCountersInstance.countEvent('rejected', '!allowTransactions2')
        return {
          success: false,
          reason: 'Network conditions to allow app init via set',
          status: 500,
        }
      }
    }
    if (this.rateLimiting.isOverloaded()) {
      this.statistics.incrementCounter('txRejected')
      nestedCountersInstance.countEvent('rejected', 'isOverloaded')
      return { success: false, reason: 'Maximum load exceeded.', status: 500 }
    }

    try {
      // Perform basic validation of the transaction fields
      if (logFlags.verbose) this.mainLogger.debug('Performing initial validation of the transaction')

      let appData = {}

      // Give the dapp an opportunity to do some up front work and generate
      // appData metadata for the applied TX
      await this.app.txPreCrackData(tx, appData)

      const injectedTimestamp = this.app.getTimestampFromTransaction(tx, appData)

      //this tx id is not good.. need to ask dapp for it!
      //may be moot though where it matters
      const txId = this.crypto.hash(tx)
      let timestampReceipt: ShardusTypes.TimestampReceipt
      if (!injectedTimestamp || injectedTimestamp === -1) {
        if (injectedTimestamp === -1) {
          console.log('Dapp request to generate a new timestmap for the tx')
        }
        timestampReceipt = await this.stateManager.transactionConsensus.askTxnTimestampFromNode(tx, txId)
        console.log('Network generated a timestamp', timestampReceipt)
      }
      if (!injectedTimestamp && !timestampReceipt) {
        this.shardus_fatal(
          'put_noTimestamp',
          `Transaction timestamp cannot be determined ${utils.stringifyReduce(tx)} `
        )
        this.statistics.incrementCounter('txRejected')
        nestedCountersInstance.countEvent('rejected', '_timestampNotDetermined')
        return {
          success: false,
          reason: 'Transaction timestamp cannot be determined.',
          status: 500,
        }
      }
      let timestampedTx
      if (timestampReceipt && timestampReceipt.timestamp) {
        timestampedTx = {
          tx,
          timestampReceipt,
        }
      } else {
        timestampedTx = { tx }
      }

      // Perform fast validation of the transaction fields
      const validateResult = this.app.validate(timestampedTx, appData)
      if (validateResult.success === false) {
        // 400 is a code for bad tx or client faulty
        validateResult.status = validateResult.status ? validateResult.status : 400
        return validateResult
      }

      // Ask App to crack open tx and return timestamp, id (hash), and keys
      const { timestamp, id, keys, shardusMemoryPatterns } = this.app.crack(timestampedTx, appData)
      // console.log('app.crack results', timestamp, id, keys)

      // Validate the transaction timestamp
      let txExpireTimeMs = this.config.transactionExpireTime * 1000

      if (global) {
        txExpireTimeMs = 2 * 10 * 1000 //todo consider if this should be a config.
      }

      if (inRangeOfCurrentTime(timestamp, txExpireTimeMs, txExpireTimeMs) === false) {
        this.shardus_fatal(
          `put_txExpired`,
          `Transaction Expired: timestamp:${timestamp} now:${Date.now()} diff(now-ts):${
            Date.now() - timestamp
          }  ${utils.stringifyReduce(tx)} `
        )
        this.statistics.incrementCounter('txRejected')
        nestedCountersInstance.countEvent('rejected', '_isTransactionTimestampExpired')
        return { success: false, reason: 'Transaction Expired', status: 400 }
      }

      this.profiler.profileSectionStart('put')

      //as ShardusMemoryPatternsInput
      // Pack into acceptedTx, and pass to StateManager
      const acceptedTX: ShardusTypes.AcceptedTx = {
        timestamp,
        txId: id,
        keys,
        data: timestampedTx,
        appData,
        shardusMemoryPatterns: shardusMemoryPatterns,
      }
      if (logFlags.verbose) this.mainLogger.debug('Transaction validated')
      if (global === false) {
        //temp way to make global modifying TXs not over count
        this.statistics.incrementCounter('txInjected')
      }
      this.logger.playbackLogNote(
        'tx_injected',
        `${txId}`,
        `Transaction: ${utils.stringifyReduce(timestampedTx)}`
      )
      this.stateManager.transactionQueue.routeAndQueueAcceptedTransaction(
        acceptedTX,
        /*send gossip*/ true,
        null,
        global,
        noConsensus
      )

      // Pass received txs to any subscribed 'DATA' receivers
      // this.io.emit('DATA', tx)
    } catch (err) {
      this.shardus_fatal(`put_ex_` + err.message, `Put: Failed to process transaction. Exception: ${err}`)
      this.fatalLogger.fatal('Put: ' + err.name + ': ' + err.message + ' at ' + err.stack)
      return {
        success: false,
        reason: `Failed to process transaction: ${utils.stringifyReduce(tx)} ${err}`,
        status: 500, // 500 status code means transaction is generally failed
      }
    } finally {
      this.profiler.profileSectionEnd('put')
    }

    if (logFlags.verbose) {
      this.mainLogger.debug(`End of injectTransaction ${utils.stringifyReduce(tx)}`)
    }

    return {
      success: true,
      reason: 'Transaction queued, poll for results.',
      status: 200, // 200 status code means transaction is generally successful
    }
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
  getNode(id: string): ShardusTypes.Node {
    return this.p2p.state.getNode(id)
  }

  getNodeByPubKey(id: string): ShardusTypes.Node {
    return this.p2p.state.getNodeByPubKey(id)
  }

  isNodeActiveByPubKey(pubKey: string): boolean {
    const node = this.p2p.state.getNodeByPubKey(pubKey)
    if (node == null) {
      return false
    }
    if (node.status !== NodeStatus.ACTIVE) {
      return false
    }
    return true
  }

  isNodeActive(id: string): boolean {
    const node = this.p2p.state.getNode(id)
    if (node == null) {
      return false
    }
    if (node.status !== NodeStatus.ACTIVE) {
      return false
    }
    return true
  }

  /**
   * Returns an array of cycles in the cycleChain history starting from the current cycle
   * @param {*} amount The number cycles to fetch from the recent cycle history
   */
  getLatestCycles(amount = 1) {
    return this.p2p.getLatestCycles(amount)
  }

  /**
   * This function return number of active in the latest cycle.
   */
  getNumActiveNodes() {
    let lastCycle = CycleChain.getNewest()
    if (lastCycle == null) {
      nestedCountersInstance.countEvent('debug', 'getNumActiveNodes lastCycle == null')
      return 0
    }
    nestedCountersInstance.countEvent('debug', `getNumActiveNodes lastCycle.active: ${lastCycle.active}`)

    const latestCycle = this.p2p.getLatestCycles(1)[0]

    if (latestCycle == null) {
      nestedCountersInstance.countEvent('debug', 'getNumActiveNodes latestCycle == null')
      return 0
    }
    nestedCountersInstance.countEvent('debug', `getNumActiveNodes latestCycle.active: ${latestCycle.active}`)

    return latestCycle ? latestCycle.active : 0
  }

  /**
   * @typedef {import('../shardus/index.js').Node} Node
   */
  /**
   * getClosestNodes finds the closes nodes to a certain hash value
   * @param {string} hash any hash address (256bit 64 characters)
   * @param {number} count how many nodes to return
   * @param {boolean} selfExclude
   * @returns {string[]} returns a list of nodes ids that are closest. roughly in order of closeness
   */
  getClosestNodes(hash: string, count: number = 1, selfExclude: boolean = false): string[] {
    return this.stateManager.getClosestNodes(hash, count, selfExclude).map((node) => node.id)
  }

  getClosestNodesGlobal(hash, count) {
    return this.stateManager.getClosestNodesGlobal(hash, count)
  }

  getShardusProfiler() {
    return profilerInstance
  }

  setDebugSetLastAppAwait(label: string) {
    this.stateManager?.transactionQueue.setDebugSetLastAppAwait(label)
  }

  validateActiveNodeSignatures(
    signedAppData: any,
    signs: ShardusTypes.Sign[],
    minRequired: number
  ): { success: boolean; reason: string } {
    let validNodeCount = 0
    // let validNodes = []
    let appData = { ...signedAppData }
    if (appData.signs) delete appData.signs
    if (appData.sign) delete appData.sign
    for (let i = 0; i < signs.length; i++) {
      const sign = signs[i]
      const nodePublicKey = sign.owner
      appData.sign = sign // attach the node's sig for verification
      const node = this.p2p.state.getNodeByPubKey(nodePublicKey)
      const isValid = this.crypto.verify(appData, nodePublicKey)
      if (node && isValid) {
        validNodeCount++
      }
      // early break loop
      if (validNodeCount >= minRequired) {
        // if (validNodes.length >= minRequired) {
        return {
          success: true,
          reason: `Validated by ${minRequired} valid nodes!`,
        }
      }
    }
    return {
      success: false,
      reason: `Fail to verify enough valid nodes signatures`,
    }
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
      accountWrites: [],
      appDefinedData: {},
      failed: false,
      failMessage: null,
      appReceiptData: null,
      appReceiptDataHash: null,
    }
    return replyObject
  }

  applyResponseAddReceiptData(
    resultObject: ShardusTypes.ApplyResponse,
    appReceiptData: any,
    appReceiptDataHash: string
  ) {
    resultObject.appReceiptData = appReceiptData
    resultObject.appReceiptDataHash = appReceiptDataHash
  }

  applyResponseSetFailed(resultObject: ShardusTypes.ApplyResponse, failMessage: string) {
    resultObject.failed = true
    resultObject.failMessage = failMessage
  }

  // USED BY SIMPLECOINAPP
  applyResponseAddState(
    resultObject: ShardusTypes.ApplyResponse, //TODO define type! :{stateTableResults: ShardusTypes.StateTableObject[], accountData:ShardusTypes.WrappedResponse[] },
    accountData: any,
    localCache: any,
    accountId: string,
    txId: string,
    txTimestamp: number,
    stateBefore: string,
    stateAfter: string,
    accountCreated: boolean
  ) {
    const state = { accountId, txId, txTimestamp, stateBefore, stateAfter }
    if (accountCreated) {
      state.stateBefore = allZeroes64
    }
    //@ts-ignore
    resultObject.stateTableResults.push(state)
    let foundAccountData = resultObject.accountData.find((a) => a.accountId === accountId)
    if (foundAccountData) {
      foundAccountData = {
        ...foundAccountData,
        accountId,
        data: accountData,
        //@ts-ignore
        txId,
        timestamp: txTimestamp,
        hash: stateAfter,
        stateId: stateAfter, // duplicate of hash.., really need to go back and add types to this
        localCache,
      }
    } else {
      resultObject.accountData.push({
        accountId,
        data: accountData,
        //@ts-ignore
        txId,
        timestamp: txTimestamp,
        hash: stateAfter,
        stateId: stateAfter, // duplicate of hash.., really need to go back and add types to this
        localCache,
      })
    }
  }
  // USED BY SIMPLECOINAPP
  applyResponseAddChangedAccount(
    resultObject: ShardusTypes.ApplyResponse, //TODO define this type!
    accountId: string,
    account: ShardusTypes.WrappedResponse,
    txId: string,
    txTimestamp: number
  ) {
    resultObject.accountWrites.push({
      accountId,
      data: account,
      txId,
      timestamp: txTimestamp,
    })
  }

  useAccountWrites() {
    console.log('Using accountWrites only')
    this.stateManager.useAccountWritesOnly = true
  }

  tryInvolveAccount(txId: string, address: string, isRead: boolean): boolean {
    const result = this.stateManager.transactionQueue.tryInvloveAccount(txId, address, isRead)
    return result
  }

  signAsNode(obj) {
    return this.crypto.sign(obj)
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

  async getLocalOrRemoteCachedAppData(topic, dataId) {
    if (this.p2p.allowTransactions()) {
      return this.stateManager.cachedAppDataManager.getLocalOrRemoteCachedAppData(topic, dataId)
    } else {
      return null
    }
  }

  async getLocalOrRemoteAccountQueueCount(address): Promise<QueueCountsResult> {
    if (this.p2p.allowTransactions()) {
      return this.stateManager.getLocalOrRemoteAccountQueueCount(address)
    } else {
      return { count: 0, committingAppData: [] }
    }
  }

  async registerCacheTopic(topic: string, maxCycleAge: number, maxCacheElements: number) {
    try {
      return this.stateManager.cachedAppDataManager.registerTopic(topic, maxCycleAge, maxCacheElements)
    } catch (e) {
      this.mainLogger.error(`Error while registerCacheTopic`, e)
    }
  }

  async sendCorrespondingCachedAppData(
    topic: string,
    dataID: string,
    appData: any,
    cycle: number,
    fromId: string,
    txId: string
  ) {
    try {
      await this.stateManager.cachedAppDataManager.sendCorrespondingCachedAppData(
        topic,
        dataID,
        appData,
        cycle,
        fromId,
        txId
      )
    } catch (e) {
      this.mainLogger.error(`Error while sendCorrespondingCachedAppData`, e)
    }
  }

  /**
   * This function is used to query data from an account that is guaranteed to be in a remote shard
   * @param {*} address The address / publicKey of the account in which to query
   */
  async getRemoteAccount(address) {
    return this.stateManager.getRemoteAccount(address)
  }

  getConsenusGroupForAccount(address: string): ShardusTypes.Node[] {
    return this.stateManager.transactionQueue.getConsenusGroupForAccount(address)
  }

  getRandomConsensusNodeForAccount(address: string): ShardusTypes.Node {
    return this.stateManager.transactionQueue.getRandomConsensusNodeForAccount(address)
  }

  isAccountRemote(address: string): boolean {
    return this.stateManager.transactionQueue.isAccountRemote(address)
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

  // ended up not using this yet:
  // async debugSetAccountState(wrappedResponse:ShardusTypes.WrappedResponse) {
  //   //set data. this will invoke the app to set data also
  //   await this.stateManager.checkAndSetAccountData([wrappedResponse], 'debugSetAccountState', false)
  // }

  /**
   * This is for a dapp to restore a bunch of account data in a debug situation.
   * This will call back into the dapp and instruct it to commit each account
   * This will also update shardus values.
   * There is a bug with re-updating the accounts copy db though.
   * @param accountCopies
   */
  async debugCommitAccountCopies(accountCopies: ShardusTypes.AccountsCopy[]) {
    await this.stateManager._commitAccountCopies(accountCopies)
  }

  async forwardAccounts(data: Archivers.InitialAccountsData) {
    await Archivers.forwardAccounts(data)
  }

  // Expose dev public key to verify things on the app
  getDevPublicKey() {
    return getDevPublicKey()
  }

  /**
   * Shutdown this node in the network
   * @param {boolean} exitProcess Exit the process when shutting down
   */
  async shutdown(exitProcess = true) {
    try {
      this.mainLogger.info('exitCleanly: shutdown')
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
  _getApplicationInterface(application: ShardusTypes.App): ShardusTypes.App {
    if (logFlags.debug) this.mainLogger.debug('Start of _getApplicationInterfaces()')
    const applicationInterfaceImpl: Partial<ShardusTypes.App> = {}
    try {
      if (application == null) {
        // throw new Error('Invalid Application Instance')
        return null
      }

      if (typeof application.validate === 'function') {
        applicationInterfaceImpl.validate = (inTx, appData) => application.validate(inTx, appData)
      } else if (typeof application.validateTxnFields === 'function') {
        /**
         * Compatibility layer for Apps that use the old validateTxnFields fn
         * instead of the new validate fn
         */
        applicationInterfaceImpl.validate = (inTx, appData) => {
          const oldResult: ShardusTypes.IncomingTransactionResult = application.validateTxnFields(
            inTx,
            appData
          )
          const newResult = {
            success: oldResult.success,
            reason: oldResult.reason,
            status: oldResult.status,
          }
          return newResult
        }
      } else {
        throw new Error('Missing required interface function. validate()')
      }

      if (typeof application.crack === 'function') {
        applicationInterfaceImpl.crack = (inTx, appData) => application.crack(inTx, appData)
      } else if (
        typeof application.getKeyFromTransaction === 'function' &&
        typeof application.validateTxnFields === 'function'
      ) {
        /**
         * Compatibility layer for Apps that use the old getKeyFromTransaction
         * fn instead of the new crack fn
         */
        applicationInterfaceImpl.crack = (inTx) => {
          const oldGetKeyFromTransactionResult: ShardusTypes.TransactionKeys =
            application.getKeyFromTransaction(inTx)
          const oldValidateTxnFieldsResult: ShardusTypes.IncomingTransactionResult =
            application.validateTxnFields(inTx, null)
          const newResult = {
            timestamp: oldValidateTxnFieldsResult.txnTimestamp,
            id: this.crypto.hash(inTx), // [TODO] [URGENT] We really shouldn't be doing this and should change all apps to use the new way and do their own hash
            keys: oldGetKeyFromTransactionResult,
            shardusMemoryPatterns: null,
          }
          return newResult
        }
      } else {
        throw new Error('Missing required interface function. validate()')
      }

      if (typeof application.txPreCrackData === 'function') {
        applicationInterfaceImpl.txPreCrackData = async (tx, appData) =>
          application.txPreCrackData(tx, appData)
      } else {
        applicationInterfaceImpl.txPreCrackData = async function () {}
      }

      if (typeof application.getTimestampFromTransaction === 'function') {
        applicationInterfaceImpl.getTimestampFromTransaction = (inTx, appData) =>
          application.getTimestampFromTransaction(inTx, appData)
      } else {
        throw new Error('Missing requried interface function.getTimestampFromTransaction()')
      }

      if (typeof application.apply === 'function') {
        applicationInterfaceImpl.apply = (inTx, wrappedStates, appData) =>
          application.apply(inTx, wrappedStates, appData)
      } else {
        throw new Error('Missing required interface function. apply()')
      }

      if (typeof application.transactionReceiptPass === 'function') {
        applicationInterfaceImpl.transactionReceiptPass = async (tx, wrappedStates, applyResponse) =>
          application.transactionReceiptPass(tx, wrappedStates, applyResponse)
      } else {
        applicationInterfaceImpl.transactionReceiptPass = async function (tx, wrappedStates, applyResponse) {}
      }

      if (typeof application.transactionReceiptFail === 'function') {
        applicationInterfaceImpl.transactionReceiptFail = async (tx, wrappedStates, applyResponse) =>
          application.transactionReceiptFail(tx, wrappedStates, applyResponse)
      } else {
        applicationInterfaceImpl.transactionReceiptFail = async function (tx, wrappedStates, applyResponse) {}
      }

      if (typeof application.updateAccountFull === 'function') {
        applicationInterfaceImpl.updateAccountFull = async (wrappedStates, localCache, applyResponse) =>
          application.updateAccountFull(wrappedStates, localCache, applyResponse)
      } else {
        throw new Error('Missing required interface function. updateAccountFull()')
      }

      if (typeof application.updateAccountPartial === 'function') {
        applicationInterfaceImpl.updateAccountPartial = async (wrappedStates, localCache, applyResponse) =>
          application.updateAccountPartial(wrappedStates, localCache, applyResponse)
      } else {
        throw new Error('Missing required interface function. updateAccountPartial()')
      }

      if (typeof application.getRelevantData === 'function') {
        applicationInterfaceImpl.getRelevantData = async (accountId, tx, appData: any) =>
          application.getRelevantData(accountId, tx, appData)
      } else {
        throw new Error('Missing required interface function. getRelevantData()')
      }

      if (typeof application.getStateId === 'function') {
        applicationInterfaceImpl.getStateId = async (accountAddress, mustExist) =>
          application.getStateId(accountAddress, mustExist)
      } else {
        if (logFlags.debug) this.mainLogger.debug('getStateId not used by global server')
      }

      if (typeof application.close === 'function') {
        applicationInterfaceImpl.close = async () => application.close()
      } else {
        throw new Error('Missing required interface function. close()')
      }

      // App.get_account_data (Acc_start, Acc_end, Max_records)
      // Provides the functionality defined for /get_accounts API
      // Max_records - limits the number of records returned
      if (typeof application.getAccountData === 'function') {
        applicationInterfaceImpl.getAccountData = async (accountStart, accountEnd, maxRecords) =>
          application.getAccountData(accountStart, accountEnd, maxRecords)
      } else {
        throw new Error('Missing required interface function. getAccountData()')
      }

      if (typeof application.getAccountDataByRange === 'function') {
        applicationInterfaceImpl.getAccountDataByRange = async (
          accountStart,
          accountEnd,
          tsStart,
          tsEnd,
          maxRecords,
          offset,
          accountOffset
        ) =>
          application.getAccountDataByRange(
            accountStart,
            accountEnd,
            tsStart,
            tsEnd,
            maxRecords,
            offset,
            accountOffset
          )
      } else {
        throw new Error('Missing required interface function. getAccountDataByRange()')
      }

      if (typeof application.calculateAccountHash === 'function') {
        applicationInterfaceImpl.calculateAccountHash = (account) => application.calculateAccountHash(account)
      } else {
        throw new Error('Missing required interface function. calculateAccountHash()')
      }

      // App.set_account_data (Acc_records)
      // Acc_records - as provided by App.get_accounts
      // Stores the records into the Accounts table if the hash of the Acc_data matches State_id
      // Returns a list of failed Acc_id
      if (typeof application.setAccountData === 'function') {
        applicationInterfaceImpl.setAccountData = async (accountRecords) =>
          application.setAccountData(accountRecords)
      } else {
        throw new Error('Missing required interface function. setAccountData()')
      }

      // pass array of account ids to this and it will delete the accounts
      if (typeof application.deleteAccountData === 'function') {
        applicationInterfaceImpl.deleteAccountData = async (addressList) =>
          application.deleteAccountData(addressList)
      } else {
        throw new Error('Missing required interface function. deleteAccountData()')
      }

      if (typeof application.getAccountDataByList === 'function') {
        applicationInterfaceImpl.getAccountDataByList = async (addressList) =>
          application.getAccountDataByList(addressList)
      } else {
        throw new Error('Missing required interface function. getAccountDataByList()')
      }
      if (typeof application.deleteLocalAccountData === 'function') {
        applicationInterfaceImpl.deleteLocalAccountData = async () => application.deleteLocalAccountData()
      } else {
        throw new Error('Missing required interface function. deleteLocalAccountData()')
      }
      if (typeof application.getAccountDebugValue === 'function') {
        applicationInterfaceImpl.getAccountDebugValue = (wrappedAccount) =>
          application.getAccountDebugValue(wrappedAccount)
      } else {
        applicationInterfaceImpl.getAccountDebugValue = (wrappedAccount) =>
          'getAccountDebugValue() missing on app'
      }

      //getSimpleTxDebugValue(tx)
      if (typeof application.getSimpleTxDebugValue === 'function') {
        applicationInterfaceImpl.getSimpleTxDebugValue = (tx) => application.getSimpleTxDebugValue(tx)
      } else {
        applicationInterfaceImpl.getSimpleTxDebugValue = (tx) => ''
      }

      if (typeof application.canDebugDropTx === 'function') {
        applicationInterfaceImpl.canDebugDropTx = (tx) => application.canDebugDropTx(tx)
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
        applicationInterfaceImpl.dataSummaryInit = async (blob, accountData) =>
          application.dataSummaryInit(blob, accountData)
      } else {
        applicationInterfaceImpl.dataSummaryInit = async function (blob, accountData) {}
      }
      if (typeof application.dataSummaryUpdate === 'function') {
        applicationInterfaceImpl.dataSummaryUpdate = async (blob, accountDataBefore, accountDataAfter) =>
          application.dataSummaryUpdate(blob, accountDataBefore, accountDataAfter)
      } else {
        applicationInterfaceImpl.dataSummaryUpdate = async function (
          blob,
          accountDataBefore,
          accountDataAfter
        ) {}
      }
      if (typeof application.txSummaryUpdate === 'function') {
        applicationInterfaceImpl.txSummaryUpdate = async (blob, tx, wrappedStates) =>
          application.txSummaryUpdate(blob, tx, wrappedStates)
      } else {
        applicationInterfaceImpl.txSummaryUpdate = async function (blob, tx, wrappedStates) {}
      }

      if (typeof application.getAccountTimestamp === 'function') {
        applicationInterfaceImpl.getAccountTimestamp = async (accountAddress, mustExist) =>
          application.getAccountTimestamp(accountAddress, mustExist)
      } else {
        applicationInterfaceImpl.getAccountTimestamp = async function (accountAddress, mustExist) {
          return 0
        }
      }

      if (typeof application.getTimestampAndHashFromAccount === 'function') {
        applicationInterfaceImpl.getTimestampAndHashFromAccount = (account) =>
          application.getTimestampAndHashFromAccount(account)
      } else {
        applicationInterfaceImpl.getTimestampAndHashFromAccount = function (account) {
          return {
            timestamp: 0,
            hash: 'getTimestampAndHashFromAccount not impl',
          }
        }
      }
      if (typeof application.validateJoinRequest === 'function') {
        applicationInterfaceImpl.validateJoinRequest = (data) => application.validateJoinRequest(data)
      }
      if (typeof application.getJoinData === 'function') {
        applicationInterfaceImpl.getJoinData = () => application.getJoinData()
      }
      if (typeof application.eventNotify === 'function') {
        applicationInterfaceImpl.eventNotify = application.eventNotify
      }
      if (typeof application.isReadyToJoin === 'function') {
        applicationInterfaceImpl.isReadyToJoin = async (latestCycle, publicKey, activeNodes) =>
          application.isReadyToJoin(latestCycle, publicKey, activeNodes)
      } else {
        // If the app doesn't provide isReadyToJoin, assume it is always ready to join
        applicationInterfaceImpl.isReadyToJoin = async (latestCycle, publicKey, activeNodes) => true
      }
      if (typeof application.getNodeInfoAppData === 'function') {
        applicationInterfaceImpl.getNodeInfoAppData = () => application.getNodeInfoAppData()
      } else {
        // If the app doesn't provide getNodeInfoAppData, assume it returns empty obj
        applicationInterfaceImpl.getNodeInfoAppData = () => {}
      }
      if (typeof application.updateNetworkChangeQueue === 'function') {
        applicationInterfaceImpl.updateNetworkChangeQueue = async (
          account: ShardusTypes.WrappedData,
          appData: any
        ) => application.updateNetworkChangeQueue(account, appData)
      } else {
        // If the app doesn't provide isReadyToJoin, assume it is always ready to join
        applicationInterfaceImpl.isReadyToJoin = async (latestCycle, publicKey, activeNodes) => true
      }
      if (typeof application.signAppData === 'function') {
        applicationInterfaceImpl.signAppData = application.signAppData
      }
    } catch (ex) {
      this.shardus_fatal(
        `getAppInterface_ex`,
        `Required application interface not implemented. Exception: ${ex}`
      )
      this.fatalLogger.fatal('_getApplicationInterface: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      throw new Error(ex)
    }
    if (logFlags.debug) this.mainLogger.debug('End of _getApplicationInterfaces()')

    // At this point, we have validated all the fields so a cast is appropriate
    return applicationInterfaceImpl as ShardusTypes.App
  }

  /**
   * Register the exit and config routes
   */
  _registerRoutes() {
    // DEBUG routes
    this.network.registerExternalPost('exit', isDebugModeMiddleware, async (req, res) => {
      res.json({ success: true })
      await this.shutdown()
    })

    this.network.registerExternalGet('config', isDebugModeMiddleware, async (req, res) => {
      res.json({ config: this.config })
    })
    this.network.registerExternalGet('netconfig', async (req, res) => {
      res.json({ config: netConfig })
    })
    this.network.registerExternalGet('nodeInfo', async (req, res) => {
      const nodeInfo = Self.getPublicNodeInfo()
      const appData = this.app.getNodeInfoAppData()
      res.json({ nodeInfo: { ...nodeInfo, appData } })
    })

    this.p2p.registerInternal(
      'sign-app-data',
      async (
        payload: {
          type: string
          nodesToSign: string
          hash: string
          appData: any
        },
        respond: (arg0: any) => any
      ) => {
        const { type, nodesToSign, hash, appData } = payload
        const { success, signature } = await this.app.signAppData?.(type, hash, Number(nodesToSign), appData)

        await respond({ success, signature })
      }
    )

    // FOR internal testing. NEEDS to be removed for security purposes
    this.network.registerExternalPost('testGlobalAccountTX', isDebugModeMiddleware, async (req, res) => {
      try {
        this.mainLogger.debug(`testGlobalAccountTX: req:${utils.stringifyReduce(req.body)}`)
        const tx = req.body.tx
        this.put(tx, false, true)
        res.json({ success: true })
      } catch (ex) {
        this.mainLogger.debug('testGlobalAccountTX:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        this.shardus_fatal(
          `registerExternalPost_ex`,
          'testGlobalAccountTX:' + ex.name + ': ' + ex.message + ' at ' + ex.stack
        )
      }
    })

    this.network.registerExternalPost('testGlobalAccountTXSet', isDebugModeMiddleware, async (req, res) => {
      try {
        this.mainLogger.debug(`testGlobalAccountTXSet: req:${utils.stringifyReduce(req.body)}`)
        const tx = req.body.tx
        this.put(tx, true, true)
        res.json({ success: true })
      } catch (ex) {
        this.mainLogger.debug('testGlobalAccountTXSet:' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        this.shardus_fatal(
          `registerExternalPost2_ex`,
          'testGlobalAccountTXSet:' + ex.name + ': ' + ex.message + ' at ' + ex.stack
        )
      }
    })
  }

  /**
   * Registers exception handlers for "uncaughtException" and "unhandledRejection"
   */
  registerExceptionHandler() {
    const logFatalAndExit = (err) => {
      console.log('Encountered a fatal error. Check fatal log for details.')
      this.shardus_fatal(
        `unhandledRejection_ex_` + err.stack.substring(0, 100),
        'unhandledRejection: ' + err.stack
      )
      // this.exitHandler.exitCleanly()

      this.mainLogger.info(`exitUncleanly: logFatalAndExit`)
      this.exitHandler.exitUncleanly('Unhandled Exception', err.message)
    }
    process.on('uncaughtException', (err) => {
      logFatalAndExit(err)
    })
    process.on('unhandledRejection', (err) => {
      logFatalAndExit(err)
    })
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
    if (logFlags.debug)
      this.mainLogger.debug(`Transaction Timestamp: ${timestamp} CurrNodeTimestamp: ${currNodeTimestamp}
    txnExprationTime: ${txnExprationTime}   TransactionAge: ${txnAge}`)

    // this.mainLogger.debug(`TransactionAge: ${txnAge}`)
    if (txnAge >= txnExprationTime * 1000) {
      this.fatalLogger.error('Transaction Expired')
      transactionExpired = true
    }
    // this.mainLogger.debug(`End of _isTransactionTimestampExpired(${timestamp})`)
    return transactionExpired
  }

  async updateConfigChangeQueue(lastCycle: ShardusTypes.Cycle) {
    if (lastCycle == null) return
    let accounts = await this.app.getAccountDataByList([changeListGlobalAccount])
    if (accounts != null && accounts.length === 1) {
      let account = accounts[0]
      // @ts-ignore // TODO where is listOfChanges coming from here? I don't think it should exist on data
      let changes = account.data.listOfChanges as {
        cycle: number
        change: any
        appData: any
      }[]
      if (!changes || !Array.isArray(changes)) {
        //this may get logged if we have a changeListGlobalAccount that does not have config settings on it.
        //The fix is to let the dapp set the global account to use for this
        // this.mainLogger.error(
        //   `Invalid changes in global account ${changeListGlobalAccount}`
        // )
        return
      }
      for (let change of changes) {
        //skip future changes
        if (change.cycle > lastCycle.counter) {
          continue
        }
        //skip handled changes
        if (this.appliedConfigChanges.has(change.cycle)) {
          continue
        }
        //apply this change
        this.appliedConfigChanges.add(change.cycle)
        let changeObj = change.change
        let appData = change.appData

        this.patchObject(this.config, changeObj, appData)

        if (appData) {
          const data: WrappedData[] = await this.app.updateNetworkChangeQueue(account, appData)
          await this.stateManager.checkAndSetAccountData(data, 'global network account update', true)
        }

        this.p2p.configUpdated()
        this.loadDetection.configUpdated()
      }
    }
  }

  patchObject(existingObject: any, changeObj: any, appData: any) {
    for (const [key, value] of Object.entries(changeObj)) {
      if (existingObject[key] != null) {
        if (typeof value === 'object') {
          this.patchObject(existingObject[key], value, appData)
        } else {
          existingObject[key] = value
          this.mainLogger.info(`patched ${key} to ${value}`)
          nestedCountersInstance.countEvent('config', `patched ${key} to ${value}`)
        }
      }
    }
  }

  /**
   * Do some periodic debug logic work
   * @param lastCycle
   */
  updateDebug(lastCycle: ShardusTypes.Cycle) {
    if (lastCycle == null) return
    let countEndpointStart = this.config?.debug?.countEndpointStart
    let countEndpointStop = this.config?.debug?.countEndpointStop

    if (countEndpointStart == null || countEndpointStart < 0) {
      return
    }

    //reset counters
    if (countEndpointStart === lastCycle.counter) {
      //nestedCountersInstance.resetCounters()
      //nestedCountersInstance.resetRareCounters()
      profilerInstance.clearScopedTimes()

      if (countEndpointStop === -1 || countEndpointStop <= countEndpointStart || countEndpointStop == null) {
        this.config.debug.countEndpointStop = countEndpointStart + 2
      }
    }

    if (countEndpointStop === lastCycle.counter && countEndpointStop != null) {
      //nestedCountersInstance.resetRareCounters()
      //convert a scoped report into rare counter report blob
      let scopedReport = profilerInstance.scopedTimesDataReport()
      scopedReport.cycle = lastCycle.counter
      scopedReport.node = `${Self.ip}:${Self.port}`
      scopedReport.id = utils.makeShortHash(Self.id)
      nestedCountersInstance.countRareEvent('scopedTimeReport', JSON.stringify(scopedReport))
    }
  }

  setGlobal(address, value, when, source) {
    GlobalAccounts.setGlobal(address, value, when, source)
  }

  getDebugModeMiddleware() {
    return isDebugModeMiddleware
  }

  shardus_fatal(key, log, log2 = null) {
    nestedCountersInstance.countEvent('fatal-log', key)

    if (log2 != null) {
      this.fatalLogger.fatal(log, log2)
    } else {
      this.fatalLogger.fatal(log)
    }
  }

  monitorEvent(category: string, name: string, count: number, message: string) {
    nestedCountersInstance.countEvent(category, name, count)

    if (logFlags.verbose) {
      this.mainLogger.info(`Event received with info: {
        eventCategory: ${category},
        eventName: ${name},
        eventMessage: ${count},
      }`)
    }

    this.statistics.countEvent(category, name, count, message)
  }

  async getAppDataSignatures(
    type: string,
    hash: string,
    nodesToSign: number,
    appData: any,
    allowedBackupNodes: number = 0
  ): Promise<ShardusTypes.GetAppDataSignaturesResult> {
    const closestNodesIds = this.getClosestNodes(hash, nodesToSign + allowedBackupNodes)

    const filterNodeIds = closestNodesIds.filter((id) => id !== Self.id)

    const closestNodes = filterNodeIds.map((nodeId) => this.p2p.state.getNode(nodeId))

    let responses = []
    if (filterNodeIds.length > 0) {
      const groupPromiseResp = await groupResolvePromises(
        closestNodes.map((node) => {
          return this.p2p.ask(node, 'sign-app-data', {
            type,
            hash,
            nodesToSign,
            appData,
          })
        }),
        (res) => {
          if (res.success) return true
          return false
        },
        allowedBackupNodes,
        Math.min(nodesToSign, filterNodeIds.length)
      )

      if (groupPromiseResp.success) responses = groupPromiseResp.wins
      else
        return {
          success: groupPromiseResp.success,
          signatures: [],
        }
    }

    if (closestNodesIds.includes(Self.id)) {
      const { success, signature } = await this.app.signAppData?.(type, hash, Number(nodesToSign), appData)
      console.log(success, signature)
      responses = [...responses, ...[{ success, signature }]]
    }

    const signatures = responses.map(({ signature }) => signature)
    if (logFlags.verbose) this.mainLogger.debug('Signatures for get signed app data request', signatures)

    return {
      success: true,
      signatures: signatures,
    }
  }
}

// tslint:disable-next-line: no-default-export
export default Shardus
export * as ShardusTypes from '../shardus/shardus-types'
