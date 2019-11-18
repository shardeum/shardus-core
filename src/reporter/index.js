const http = require('../http')
const allZeroes64 = '0'.repeat(64)

/**
   * @typedef {import('../state-manager/index').CycleShardData} CycleShardData
   */

class Reporter {
  constructor (config, logger, p2p, statistics, stateManager, profiler, loadDetection) {
    this.config = config
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.statistics = statistics
    this.stateManager = stateManager
    this.profiler = profiler
    this.loadDetection = loadDetection
    this.logger = logger

    this.reportTimer = null

    this.lastTime = Date.now()

    this.doConsoleReport = false
    if (this.config.console === true) {
      this.doConsoleReport = true
    }
    this.hasRecipient = this.config.recipient != null
  }

  _calculateAverageTps (txs) {
    return Math.round(txs / this.config.interval)
  }

  async reportJoining (publicKey) {
    if (!this.hasRecipient) {
      return
    }
    try {
      const nodeIpInfo = this.p2p.getIpInfo()
      await http.post(`${this.config.recipient}/joining`, { publicKey, nodeIpInfo })
    } catch (e) {
      this.mainLogger.error('reportJoining: ' + e.name + ': ' + e.message + ' at ' + e.stack)
      console.error(e)
    }
  }

  async reportJoined (nodeId, publicKey) {
    if (!this.hasRecipient) {
      return
    }
    try {
      const nodeIpInfo = this.p2p.getIpInfo()
      await http.post(`${this.config.recipient}/joined`, { publicKey, nodeId, nodeIpInfo })
    } catch (e) {
      this.mainLogger.error('reportJoined: ' + e.name + ': ' + e.message + ' at ' + e.stack)
      console.error(e)
    }
  }

  async reportActive (nodeId) {
    if (!this.hasRecipient) {
      return
    }
    try {
      await http.post(`${this.config.recipient}/active`, { nodeId })
    } catch (e) {
      this.mainLogger.error('reportActive: ' + e.name + ': ' + e.message + ' at ' + e.stack)
      console.error(e)
    }
  }

  async reportRemoved (nodeId) {
    if (!this.hasRecipient) {
      return
    }
    try {
      await http.post(`${this.config.recipient}/removed`, { nodeId })
    } catch (e) {
      this.mainLogger.error('reportRemoved: ' + e.name + ': ' + e.message + ' at ' + e.stack)
      console.error(e)
    }
  }

  // Sends a report
  async _sendReport (data) {
    if (!this.hasRecipient) {
      return
    }
    const nodeId = this.p2p.getNodeId()
    if (!nodeId) throw new Error('No node ID available to the Reporter module.')
    const report = {
      nodeId,
      data
    }
    try {
      await http.post(`${this.config.recipient}/heartbeat`, report)
    } catch (e) {
      this.mainLogger.error('_sendReport: ' + e.name + ': ' + e.message + ' at ' + e.stack)
      console.error(e)
    }
  }

  startReporting () {
    // Creates and sends a report every `interval` seconds
    this.reportTimer = setInterval(async () => {
      let appState = this.stateManager ? await this.stateManager.getAccountsStateHash() : allZeroes64
      const cycleMarker = this.p2p.getCycleMarker()
      const cycleCounter = this.p2p.state.getCycleCounter()
      const nodelistHash = this.p2p.getNodelistHash()
      const desiredNodes = this.p2p.state.getDesiredCount()
      const txInjected = this.statistics ? this.statistics.getPreviousElement('txInjected') : 0
      const txApplied = this.statistics ? this.statistics.getPreviousElement('txApplied') : 0
      const txRejected = this.statistics ? this.statistics.getPreviousElement('txRejected') : 0
      const txExpired = this.statistics ? this.statistics.getPreviousElement('txExpired') : 0
      const txProcessed = this.statistics ? this.statistics.getPreviousElement('txProcessed') : 0
      const reportInterval = this.config.interval
      const nodeIpInfo = this.p2p.getIpInfo()

      let repairsStarted = 0
      let repairsFinished = 0
      // report only if we are active in te networks.
      // only knowingly report deltas.
      let partitionReport = null
      let globalSync = null
      if (this.stateManager != null) {
        partitionReport = this.stateManager.getPartitionReport(true, true)
        globalSync = this.stateManager.stateIsGood

        repairsStarted = this.stateManager.dataRepairsStarted
        repairsFinished = this.stateManager.dataRepairsCompleted
        // Hack to code a green or red color for app state:
        appState = globalSync ? '00ff00ff' : 'ff0000ff'
      }

      let partitions = 0
      let partitionsCovered = 0
      if (this.stateManager != null) {
        /** @type {CycleShardData} */
        let shardData = this.stateManager.currentCycleShardData //   getShardDataForCycle(cycleCounter)
        if (shardData != null) {
          partitions = shardData.shardGlobals.numPartitions
          partitionsCovered = shardData.nodeShardData.storedPartitions.partitionsCovered
        }
      }

      // Server load
      const currentLoad = this.loadDetection.getCurrentLoad()
      const queueLength = this.statistics.getPreviousElement('queueLength')
      const txTimeInQueue = this.statistics.getPreviousElement('txTimeInQueue') / 1000 // ms to sec

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
          txTimeInQueue
        })
      } catch (e) {
        this.mainLogger.error('startReporting: ' + e.name + ': ' + e.message + ' at ' + e.stack)
        console.error(e)
      }

      if (this.doConsoleReport) {
        this.consoleReport()
      }
    }, this.config.interval * 1000)
  }

  consoleReport () {
    let time = Date.now()
    let delta = time - this.lastTime
    delta = delta * 0.001
    const txInjected = this.statistics ? this.statistics.getPreviousElement('txInjected') : 0
    const txApplied = this.statistics ? this.statistics.getPreviousElement('txApplied') : 0
    let report = `Perf inteval ${delta}    ${txInjected} Injected @${txInjected / delta} per second.    ${txApplied} Applied @${txApplied / delta} per second`
    this.lastTime = time

    console.log(report)

    if (this.profiler) {
      this.profiler.printAndClearReport(delta)
    }
  }

  stopReporting () {
    this.mainLogger.info('Stopping statistics reporting...')
    clearInterval(this.reportTimer)
  }
}

module.exports = Reporter
