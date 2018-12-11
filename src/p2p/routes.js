exports.register = function (context) {
  setupRoutes.call(context)
}

function setupRoutes () {
  // -------- EXTERNAL Routes ----------

  this.network.registerExternalGet('cyclemarker', (req, res) => {
    const cycleMarkerInfo = this.getCycleMarkerInfo()
    res.json(cycleMarkerInfo)
  })

  this.network.registerExternalGet('cyclechain', (req, res) => {
    const cycleChain = this.getLatestCycles(10)
    res.json({ cycleChain })
  })

  this.network.registerExternalPost('join', async (req, res) => {
    const invalidJoinReqErr = 'invalid join request'
    if (!req.body) {
      this.mainLogger.error('Invalid join request received.')
      return res.json({ success: false, error: invalidJoinReqErr })
    }

    const joinRequest = req.body
    this.mainLogger.debug(`Join request received: ${JSON.stringify(joinRequest)}`)
    res.json({ success: true })

    const accepted = await this.addJoinRequest(joinRequest)
    if (!accepted) return this.mainLogger.debug('Join request not accepted.')
    this.mainLogger.debug('Join request accepted!')
  })

  this.network.registerExternalGet('nodeinfo', (req, res) => {
    const nodeInfo = this.getPublicNodeInfo()
    res.json({ nodeInfo })
  })

  // -------- INTERNAL Routes ----------

  this.registerInternal('join', async (payload) => {
    const accepted = await this.addJoinRequest(payload, false)
    if (!accepted) return this.mainLogger.debug('Join request not accepted.')
    this.mainLogger.debug('Join request accepted!')
  })

  // Temp Gossip Endpoint
  this.registerInternal('gossip', async (payload) => {
    const accepted = await this.handleGossip(payload, false)
    if (!accepted) return this.mainLogger.debug('Gossip Not Accepted.')
    this.mainLogger.debug('Gossip request accepted!')
  })

  this.registerInternal('cyclemarker', async (payload, respond) => {
    const cycleMarkerInfo = this.getCycleMarkerInfo()
    await respond(cycleMarkerInfo)
  })

  this.registerInternal('nodelisthash', async (payload, respond) => {
    const nodelistHash = this.getNodelistHash()
    await respond({ nodelistHash })
  })

  this.registerInternal('nodelist', async (payload, respond) => {
    const nodelist = this.state.getAllNodes()
    await respond({ nodelist })
  })

  this.registerInternal('cyclechainhash', async (payload, respond) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided with `cyclechainhash` request.')
      await respond({ cycleChainHash: null, error: 'no payload; start and end cycle required' })
      return
    }
    this.mainLogger.debug(`Payload of request on 'cyclechainhash': ${JSON.stringify(payload)}`)
    if (payload.start === undefined || payload.end === undefined) {
      this.mainLogger.debug('Start and end for the `cyclechainhash` request were not both provided.')
      await respond({ cycleChainHash: null, error: 'start and end required' })
      return
    }
    const cycleChainHash = this.getCycleChainHash(payload.start, payload.end)
    this.mainLogger.debug(`Cycle chain hash to be sent: ${JSON.stringify(cycleChainHash)}`)
    if (!cycleChainHash) {
      await respond({ cycleChainHash, error: 'invalid indexes for cycle chain hash' })
      return
    }
    await respond({ cycleChainHash })
  })

  this.registerInternal('cyclechain', async (payload, respond) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided with `cyclechain` request.')
      await respond({ cycleChain: null, error: 'no payload; start and end cycle required' })
      return
    }
    if (payload.start === undefined || payload.end === undefined) {
      this.mainLogger.debug('Start and end for the `cyclechain` request were not both provided.')
      await respond({ cycleChain: null, error: 'start and end required' })
      return
    }
    const cycleChain = this.getCycleChain(payload.start, payload.end)
    if (!cycleChain) {
      await respond({ cycleChain, error: 'invalid indexes for cycle chain' })
      return
    }
    await respond({ cycleChain })
  })

  this.registerInternal('active', async (payload) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided with `active` request.')
      return
    }
    this.mainLogger.debug(`Payload for 'active' request: ${payload}`)
    const { nodeId } = payload
    if (!payload.nodeId) {
      this.mainLogger.debug('Node ID of node was not provided with `active` request.')
      return
    }

    // Add status update of given node to queue
    await this.state.addStatusUpdate(nodeId, 'active')
  })

  this.registerInternal('certificate', async (payload) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided for the `certificate` request.')
      return
    }
    const certificate = payload
    this.mainLogger.debug(`Propagated cycle certificate: ${JSON.stringify(certificate)}`)
    console.log(certificate)
    const added = this.state.addCertificate(certificate)
    if (added) this.tell(this.state.getAllNodes(this.id), 'certificate', certificate)
  })

  // -------- DEBUG Routes ----------

  // Test route for the P2P.tell function
  this.registerInternal('test1', async (payload) => {
    if (!payload) {
      console.log('no payload')
      return
    }
    console.log(payload)
  })

  // Test route for the P2P.ask function
  this.registerInternal('test2', async (payload, respond) => {
    if (!payload) {
      console.log('no payload')
      return
    }
    console.log(payload)
    await respond(payload)
  })
}
