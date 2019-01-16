const http = require('../http')

class Reporter {
  constructor (config, logger, p2p, shardus) {
    this.config = config
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.shardus = shardus

    this.reportTimer = null
    this._txInjected = 0
    this._txApplied = 0

    this.p2p.registerOnJoining((publicKey) => {
      return this.reportJoining(publicKey)
    })

    this.p2p.registerOnJoined((nodeId, publicKey) => {
      return this.reportJoined(nodeId, publicKey)
    })

    this.p2p.registerOnActive((nodeId) => {
      return this.reportActive(nodeId)
    })
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
    try {
      await http.post(`${this.config.recipient}/joining`, { publicKey })
    } catch (e) {
      this.mainLogger.error(e)
      console.error(e)
    }
  }

  async reportJoined (nodeId, publicKey) {
    try {
      await http.post(`${this.config.recipient}/joined`, { publicKey, nodeId })
    } catch (e) {
      this.mainLogger.error(e)
      console.error(e)
    }
  }

  async reportActive (nodeId) {
    try {
      await http.post(`${this.config.recipient}/active`, { nodeId })
    } catch (e) {
      this.mainLogger.error(e)
      console.error(e)
    }
  }

  // Sends a report
  async _sendReport (data) {
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

      this._resetTxsSeen()
    }, this.config.interval * 1000)
  }

  stopReporting () {
    this.mainLogger.info('Stopping statistics reporting...')
    clearInterval(this.reportTimer)
  }
}

module.exports = Reporter
