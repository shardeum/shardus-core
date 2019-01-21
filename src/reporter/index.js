const http = require('../http')

class Reporter {
  constructor (config, logger, p2p, shardus, profiler) {
    this.config = config
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.shardus = shardus
    this.profiler = profiler
    this.logger = logger

    this.reportTimer = null
    this._txInjected = 0
    this._txApplied = 0

    this.p2p.registerOnJoining((publicKey) => {
      this.logger.playbackLogState('joining', '', publicKey)
      return this.reportJoining(publicKey)
    })

    this.p2p.registerOnJoined((nodeId, publicKey) => {
      this.logger.playbackLogState('joined', nodeId, publicKey)
      this.logger.setPlaybackID(nodeId)
      return this.reportJoined(nodeId, publicKey)
    })

    this.p2p.registerOnActive((nodeId) => {
      this.logger.playbackLogState('active', nodeId, '')
      return this.reportActive(nodeId)
    })

    this.lastTime = Date.now

    this.doConsoleReport = false
    if (this.config.console === true) {
      this.doConsoleReport = true
    }
    this.hasRecipient = this.config.recipient != null
  }

  incrementTxInjected () {
    this._txInjected += 1
  }

  incrementTxApplied () {
    this._txApplied += 1
  }

  _resetTxsSeen () {
    this._txInjected = 0
    this._txApplied = 0
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
      this.mainLogger.error(e)
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
      this.mainLogger.error(e)
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
      this.mainLogger.error(e)
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
      this.mainLogger.error(e)
      console.error(e)
    }
  }

  startReporting () {
    // Creates and sends a report every `interval` seconds
    this.reportTimer = setInterval(async () => {
      const appState = await this.shardus.getAccountsStateHash()
      const cycleMarker = this.p2p.getCycleMarker()
      const nodelistHash = this.p2p.getNodelistHash()
      const txInjected = this._txInjected
      const txApplied = this._txApplied
      const reportInterval = this.config.interval
      const nodeIpInfo = this.p2p.getIpInfo()

      try {
        await this._sendReport({ appState, cycleMarker, nodelistHash, txInjected, txApplied, reportInterval, nodeIpInfo })
      } catch (e) {
        this.mainLogger.error(e)
        console.error(e)
      }

      if (this.doConsoleReport) {
        this.consoleReport()
      }

      this._resetTxsSeen()
    }, this.config.interval * 1000)
  }

  consoleReport () {
    let time = Date.now()
    let delta = time - this.lastTime
    delta = delta * 0.001
    let report = `Perf inteval ${delta}    ${this._txInjected} Injected @${this._txInjected / delta} per second.    ${this._txApplied} Applied @${this._txApplied / delta} per second`
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
