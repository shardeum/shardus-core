const http = require('../http')

class Reporter {
  constructor (config, logger, p2p) {
    this.config = config
    this.mainLogger = logger.getLogger('main')

    this.p2p = p2p

    this.reportTimer = null
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
      await http.post(this.config.recipient, report)
    } catch (e) {
      this.mainLogger.error(e)
      console.error(e)
    }
  }

  startReporting () {
    // Creates and sends a report every `interval` seconds
    this.reportTimer = setInterval(async () => {
      const appState = this.p2p.getAppState()
      const cycleMarker = this.p2p.getCycleMarker()
      const nodelistHash = this.p2p.getNodelistHash()
      const tpsInjected = this.p2p.getTpsInjected()
      const tpsApplied = this.p2p.getTpsApplied()

      try {
        await this._sendReport({ appState, cycleMarker, nodelistHash, tpsInjected, tpsApplied })
      } catch (e) {
        this.mainLogger.error(e)
        console.error(e)
      }
    }, this.config.interval * 1000)
  }

  stopReporting () {
    clearInterval(this.reportTimer)
  }
}

module.exports = Reporter
