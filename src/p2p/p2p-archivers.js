// const utils = require('../utils')

class P2PArchivers {
  constructor (logger, p2p, state, crypto) {
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.state = state
    this.crypto = crypto
    this.joinRequests = []
    this.archiversList = []
  }

  resetJoinRequests () {
    this.joinRequests = []
  }

  addJoinRequest (joinRequest) {
    if (this.state.acceptJoinRequests && this.crypto.verify(joinRequest)) {
      this.joinRequests.push(joinRequest)
      return true
    }
    return false
  }

  getJoinedArchivers () {
    return this.joinRequests
  }

  addArchivers (joinedArchivers) {
    for (const joinRequest of joinedArchivers) {
      this.archiversList.push(joinRequest.nodeInfo)
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

    this.p2p.network.registerExternalGet('archivers', async (req, res) => {
      return res.json({ archivers: this.archiversList })
    })
  }
}

module.exports = P2PArchivers
