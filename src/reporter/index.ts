import Log4js from 'log4js'
import LoadDetection from '../load-detection'
import Logger from '../logger'
import { ipInfo } from '../network'
import { config, crypto } from '../p2p/Context'
import * as Context from '../p2p/Context'
import { getDesiredCount } from '../p2p/CycleAutoScale'
import * as CycleChain from '../p2p/CycleChain'
import * as Self from '../p2p/Self'
import * as NodeList from '../p2p/NodeList'
import * as Rotation from '../p2p/Rotation'
import StateManager from '../state-manager'
import Statistics from '../statistics'
import Profiler from '../utils/profiler'
import packageJson from '../../package.json'

const http = require('../http')
const allZeroes64 = '0'.repeat(64)

// import Shardus = require('../shardus/shardus-types')

/**
 * @typedef {import('../state-manager/index').CycleShardData} CycleShardData
 */

interface StatisticsReport {
  txInjected: number
  txApplied: number
  txRejected: number
  txProcessed: number
  txExpired: number
}

interface Reporter {
  config: any
  mainLogger: Log4js.Logger
  p2p: any
  statistics: Statistics
  stateManager: StateManager
  profiler: Profiler
  loadDetection: LoadDetection
  logger: Logger
  reportTimer: NodeJS.Timeout
  lastTime: number
  doConsoleReport: boolean
  hasRecipient: boolean
  statisticsReport: StatisticsReport
}
class Reporter {
  constructor(
    config,
    logger,
    statistics,
    stateManager,
    profiler,
    loadDetection
  ) {
    this.config = config
    this.mainLogger = logger.getLogger('main')
    this.statistics = statistics
    this.stateManager = stateManager
    this.profiler = profiler
    this.loadDetection = loadDetection
    this.logger = logger

    this.reportTimer = null

    this.lastTime = Date.now()

    this.doConsoleReport = false
    if (this.config.debug && this.config.debug.profiler) {
      this.doConsoleReport = true
    }
    this.hasRecipient = this.config.recipient != null
    this.resetStatisticsReport()
  }

  resetStatisticsReport() {
    this.statisticsReport = {
      txInjected: 0,
      txApplied: 0,
      txRejected: 0,
      txProcessed: 0,
      txExpired: 0,
    }
  }

  collectStatisticToReport() {
    this.statisticsReport.txInjected += this.statistics
      ? this.statistics.getPreviousElement('txInjected')
      : 0
    this.statisticsReport.txApplied += this.statistics
      ? this.statistics.getPreviousElement('txApplied')
      : 0
    this.statisticsReport.txRejected += this.statistics
      ? this.statistics.getPreviousElement('txRejected')
      : 0
    this.statisticsReport.txExpired += this.statistics
      ? this.statistics.getPreviousElement('txExpired')
      : 0
    this.statisticsReport.txProcessed += this.statistics
      ? this.statistics.getPreviousElement('txProcessed')
      : 0
  }

  async reportJoining(publicKey) {
    if (!this.hasRecipient) {
      return
    }
    try {
      const nodeIpInfo = ipInfo
      await http.post(`${this.config.recipient}/joining`, {
        publicKey,
        nodeIpInfo,
      })
    } catch (e) {
      this.mainLogger.error(
        'reportJoining: ' + e.name + ': ' + e.message + ' at ' + e.stack
      )
      console.error(e)
    }
  }

  async reportJoined(nodeId, publicKey) {
    if (!this.hasRecipient) {
      return
    }
    try {
      const nodeIpInfo = ipInfo
      await http.post(`${this.config.recipient}/joined`, {
        publicKey,
        nodeId,
        nodeIpInfo,
      })
    } catch (e) {
      this.mainLogger.error(
        'reportJoined: ' + e.name + ': ' + e.message + ' at ' + e.stack
      )
      console.error(e)
    }
  }

  async reportActive(nodeId) {
    if (!this.hasRecipient) {
      return
    }
    try {
      await http.post(`${this.config.recipient}/active`, { nodeId })
    } catch (e) {
      this.mainLogger.error(
        'reportActive: ' + e.name + ': ' + e.message + ' at ' + e.stack
      )
      console.error(e)
    }
  }

  async reportRemoved(nodeId) {
    if (!this.hasRecipient) {
      return
    }
    try {
      await http.post(`${this.config.recipient}/removed`, { nodeId })
    } catch (e) {
      this.mainLogger.error(
        'reportRemoved: ' + e.name + ': ' + e.message + ' at ' + e.stack
      )
      console.error(e)
    }
    // Omar added this, since, just clearing the timer did not work
    //   it was still sending one more heartbeat after sending a removed
    this.hasRecipient = false
  }

  // Sends a report
  async _sendReport(data) {
    if (!this.hasRecipient) {
      return
    }
    const nodeId = Self.id
    if (!nodeId) throw new Error('No node ID available to the Reporter module.')
    const report = {
      nodeId,
      data,
    }
    try {
      await http.post(`${this.config.recipient}/heartbeat`, report)
    } catch (e) {
      this.mainLogger.error(
        '_sendReport: ' + e.name + ': ' + e.message + ' at ' + e.stack
      )
      console.error(e)
    }
  }

  getReportInterval(): number {
    if (NodeList.activeByIdOrder.length >= 100) {
      return 10 * 1000
    } else {
      return this.config.interval * 1000
    }
  }
  checkIsNodeLost(nodeId) {
    const lostNodeIds = CycleChain.getNewest().lost
    if (lostNodeIds.length === 0) return false
    const foundId = lostNodeIds.find((lostId) => lostId === nodeId)
    if (foundId) return true
    return false
  }

  async report() {
    /*
    Stop calling getAccountsStateHash() since this is not of use in a sharded network, also expensive to compute.
      let appState = this.stateManager
        ? await this.stateManager.transactionQueue.getAccountsStateHash()
        : allZeroes64
    */
    let appState = allZeroes64 // monititor server will set color based on partition report
    const cycleMarker = CycleChain.newest.previous || '' // [TODO] Replace with cycle creator
    const cycleCounter = CycleChain.newest.counter
    const nodelistHash = crypto.hash(NodeList.byJoinOrder)
    const desiredNodes = getDesiredCount()
    const txInjected = this.statisticsReport.txInjected
    const txApplied = this.statisticsReport.txApplied
    const txRejected = this.statisticsReport.txRejected
    const txExpired = this.statisticsReport.txExpired
    const txProcessed = this.statisticsReport.txProcessed
    const reportInterval = this.getReportInterval()
    const nodeIpInfo = ipInfo

    let repairsStarted = 0
    let repairsFinished = 0
    // report only if we are active in te networks.
    // only knowingly report deltas.
    let partitionReport = null
    let globalSync = null
    if (this.stateManager != null) {
      partitionReport = this.stateManager.partitionObjects.getPartitionReport(
        true,
        true
      )
      globalSync = this.stateManager.isStateGood()

      repairsStarted = this.stateManager.dataRepairsStarted
      repairsFinished = this.stateManager.dataRepairsCompleted
      // Hack to code a green or red color for app state:
      appState = globalSync ? '00ff00ff' : 'ff0000ff'
    }

    let partitions = 0
    let partitionsCovered = 0
    if (this.stateManager != null) {
      /** @type {CycleShardData} */
      const shardData = this.stateManager.currentCycleShardData //   getShardDataForCycle(cycleCounter)
      if (shardData != null) {
        partitions = shardData.shardGlobals.numPartitions
        partitionsCovered =
          shardData.nodeShardData.storedPartitions.partitionsCovered
      }
    }

    // Server load
    const currentLoad = this.loadDetection.getCurrentLoad()
    const queueLength = this.statistics.getPreviousElement('queueLength')
    const txTimeInQueue =
      this.statistics.getPreviousElement('txTimeInQueue') / 1000 // ms to sec
    const isNodeLost = this.checkIsNodeLost(Self.id)

    try {
      await this._sendReport({
        repairsStarted,
        repairsFinished,
        appState,
        cycleMarker,
        cycleCounter,
        nodelistHash,
        desiredNodes,
        txInjected,
        txApplied,
        txRejected,
        txExpired,
        txProcessed,
        reportInterval,
        nodeIpInfo,
        partitionReport,
        globalSync,
        partitions,
        partitionsCovered,
        currentLoad,
        queueLength,
        txTimeInQueue,
        isLost: isNodeLost,
        shardusVersion: packageJson.version,
      })
    } catch (e) {
      this.mainLogger.error(
        'startReporting: ' + e.name + ': ' + e.message + ' at ' + e.stack
      )
      console.error(e)
    }

    this.resetStatisticsReport()
    this.consoleReport()

    // if (this.doConsoleReport) {
    //   this.consoleReport()
    // }
    this.reportTimer = setTimeout(() => {
      this.report()
    }, this.getReportInterval())
  }

  startReporting() {
    const self = this
    setInterval(() => {
      self.collectStatisticToReport()
    }, 1000)
    // Creates and sends a report every `interval` seconds
    this.reportTimer = setTimeout(() => {
      this.report()
    }, this.getReportInterval())
  }

  consoleReport() {
    const time = Date.now()
    let delta = time - this.lastTime
    delta = delta * 0.001
    const txInjected = this.statistics
      ? this.statistics.getPreviousElement('txInjected')
      : 0
    const txApplied = this.statistics
      ? this.statistics.getPreviousElement('txApplied')
      : 0
    const report = `Perf inteval ${delta}    ${txInjected} Injected @${
      txInjected / delta
    } per second.    ${txApplied} Applied @${txApplied / delta} per second`
    this.lastTime = time

    console.log(report)

    if (this.profiler) {
      console.log(this.profiler.printAndClearReport(delta))
      console.log(
        'Current load',
        'counter',
        CycleChain.newest.counter,
        this.loadDetection.getCurrentLoad()
      )
    }
  }

  stopReporting() {
    this.mainLogger.info('Stopping statistics reporting...')
    clearTimeout(this.reportTimer)
  }
}

export default Reporter
