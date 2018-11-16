exports.register = function (context) {
  setupRoutes.call(context)
}

function setupRoutes () {
  this.network.registerExternalGet('cyclemarker', (req, res) => {
    const cycleMarkerInfo = this.getCycleMarkerInfo()
    res.json(cycleMarkerInfo)
  })
  this.network.registerExternalGet('cyclechain', (req, res) => {
    const cycleChain = this.getLatestCycles(10)
    res.json({ cycleChain })
  })
  this.network.registerExternalGet('join', (req, res) => {
    const invalidJoinReqErr = 'invalid join request'
    if (!req.body) {
      this.mainLogger.error('Invalid join request received.')
      return res.json({ success: false, error: invalidJoinReqErr })
    }
    const joinRequest = req.body
    this.mainLogger.debug(`Join request received: ${JSON.stringify(joinRequest)}`)
    res.json({ success: true })
    const accepted = this.addJoinRequest(joinRequest)
    if (!accepted) return this.mainLogger.debug('Join request not accepted.')
    this.mainLogger.debug('Join request accepted!')
  })
}
