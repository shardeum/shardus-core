const http = require('../http')

class P2PArchivers {
  constructor (logger, p2p, state, crypto) {
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.state = state
    this.crypto = crypto
    this.joinRequests = []
    this.archiversList = []
    this.cycleRecipients = []
  }

  resetJoinRequests () {
    this.joinRequests = []
  }

  async addJoinRequest (joinRequest, tracker, gossip = true) {
    if (this.state.acceptJoinRequests === false) {
      return false
    }
    if (this.crypto.verify(joinRequest) === false) {
      return false
    }
    this.joinRequests.push(joinRequest)
    if (gossip === true) {
      await this.p2p.sendGossipIn('joinarchiver', joinRequest, tracker)
    }
    return true
  }

  getArchiverUpdates () {
    return this.joinRequests
  }

  updateArchivers (joinedArchivers) {
    // Update archiversList
    for (const nodeInfo of joinedArchivers) {
      this.archiversList.push(nodeInfo)
    }
  }

  addCycleRecipient (nodeInfo) {
    this.cycleRecipients.push(nodeInfo)
  }

  sendCycle (cycle) {
    for (const nodeInfo of this.cycleRecipients) {
      const nodeUrl = `http://${nodeInfo.ip}:${nodeInfo.port}/newcycle`
      http.post(nodeUrl, cycle)
    }
  }

  registerRoutes () {
    this.p2p.network.registerExternalPost('joinarchiver', async (req, res) => {
      if (!this.state.acceptJoinRequests) {
        return res.json({ success: false, error: 'not accepting archiver join requests' })
      }
      const invalidJoinReqErr = 'invalid archiver join request'
      if (!req.body) {
        this.mainLogger.error('Invalid archiver join request received.')
        return res.json({ success: false, error: invalidJoinReqErr })
      }

      const joinRequest = req.body
      this.mainLogger.debug(`Archiver join request received: ${JSON.stringify(joinRequest)}`)
      res.json({ success: true })

      const accepted = await this.addJoinRequest(joinRequest)
      if (!accepted) return this.mainLogger.debug('Archiver join request not accepted.')
      this.mainLogger.debug('Archiver join request accepted!')
    })

    this.p2p.registerGossipHandler('joinarchiver', async (payload, sender, tracker) => {
      if (!this.state.acceptJoinRequests) return this.mainLogger.debug('Archiver join request not accepted. Not accepting join requests currently.')
      const accepted = await this.addJoinRequest(payload, tracker, false)
      if (!accepted) return this.mainLogger.debug('Archiver join request not accepted.')
      this.mainLogger.debug('Archiver join request accepted!')
    })

    this.p2p.network.registerExternalGet('archivers', (req, res) => {
      res.json({ archivers: this.archiversList })
    })

    this.p2p.network.registerExternalGet('cyclerecipients', (req, res) => {
      res.json({ cycleRecipients: this.cycleRecipients })
    })
  }
}

module.exports = P2PArchivers
