const http = require('../http')
const allZeroes64 = '0'.repeat(64)

class Reporter {
  constructor (config, logger, p2p, statistics, stateManager, profiler) {
    this.config = config
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.statistics = statistics
    this.stateManager = stateManager
    this.profiler = profiler
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
      await http.post(`${this.config.recipient}/joining`, { publicKey })
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
      await http.post(`${this.config.recipient}/joined`, { publicKey, nodeId })
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
      const appState = this.stateManager ? await this.stateManager.getAccountsStateHash() : allZeroes64
      const cycleMarker = this.p2p.getCycleMarker()
      const nodelistHash = this.p2p.getNodelistHash()
      const desiredNodes = this.p2p.state.getDesiredCount()
      const txInjected = this.statistics ? this.statistics.getPreviousElement('txInjected') : 0
      const txApplied = this.statistics ? this.statistics.getPreviousElement('txApplied') : 0
      const txRejected = this.statistics ? this.statistics.getPreviousElement('txRejected') : 0
      const txExpired = this.statistics ? this.statistics.getPreviousElement('txExpired') : 0
      const reportInterval = this.config.interval
      const nodeIpInfo = this.p2p.getIpInfo()

      try {
        await this._sendReport({ appState, cycleMarker, nodelistHash, desiredNodes, txInjected, txApplied, txRejected, txExpired, reportInterval, nodeIpInfo })
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
