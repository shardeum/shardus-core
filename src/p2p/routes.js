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
    if (!this.state.acceptJoinRequests || this.joinRequestToggle === false) {
      return res.json({ success: false, error: 'not accepting join requests' })
    }
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

  this.network.registerExternalGet('joined/:publicKey', (req, res) => {
    const publicKey = req.params.publicKey
    const node = this.state.getNodeByPubKey(publicKey)
    if (!node) {
      this.mainLogger.debug(`Unable to find node with given public key ${publicKey} for 'joined' route request.`)
      return res.json({ joined: false })
    }
    const { cycleJoined } = node
    return res.json({ joined: true, cycleJoined })
  })

  this.network.registerExternalGet('seednodes', (req, res) => {
    const seedNodes = this.state.getSeedNodes()
    return res.json({ seedNodes })
  })

  // -------- INTERNAL Routes ----------

  this.registerInternal('gossip', async (payload, respond, sender, tracker = '') => {
    await this.handleGossip(payload, sender, tracker)
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
    const cycleMarkerCerts = this.getCycleMarkerCerts(payload.start, payload.end)
    if (!cycleChain) {
      await respond({ cycleChain, error: 'invalid indexes for cycle chain' })
      return
    }
    if (!cycleMarkerCerts) {
      await respond({ cycleChain, cycleMarkerCerts, error: 'invalid indexes for cycle marker certificates' })
      return
    }
    await respond({ cycleChain, cycleMarkerCerts })
  })

  this.registerInternal('unfinalized', async (payload, respond) => {
    if (!this.state.unfinalizedReady) {
      this.mainLogger.debug('Unfinalized cycle not ready to be provided.')
      await respond({ unfinalizedCycle: null })
      return
    }
    const unfinalizedCycle = this.state.currentCycle
    await respond({ unfinalizedCycle })
  })

  this.registerInternal('cycleupdates', async (payload, respond) => {
    const cycleUpdates = this.state.currentCycle.updates
    await respond({ cycleUpdates })
    // Update your cycle and remake a cert if the askers cycleUpdates are better
    if (!payload) {
      this.mainLogger.debug('No payload provided with `cycleupdates` request.')
      return
    }
    const hisCycleUpdates = payload.myCycleUpdates
    const hisCertificate = payload.myCertificate
    if (!hisCycleUpdates || !hisCertificate) {
      this.mainLogger.debug('Invalid payload provided with `cycleupdates` request.')
      return
    }
    const cycleUpdated = await this.state.addCycleUpdates(hisCycleUpdates)
    // TODO: Verify the logic here
    if (cycleUpdated) {
      this.mainLogger.debug('Updated our cycle data after getting a `cycleupdates` request.')
      // Use the askers cert if its better than the one you made
      const [added] = this.state.addCertificate(hisCertificate, true)
      if (!added) {
        const myCertificate = this.state.getCurrentCertificate()
        this.sendGossipIn('certificate', myCertificate)
        return
      }
      this.sendGossipIn('certificate', hisCertificate)
    }
  })

  this.registerInternal('node', async (payload, respond) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided with `node` request.')
      await respond({ node: null })
      return
    }
    const getBy = payload.getBy
    if (!getBy) {
      this.mainLogger.debug('No query method provided with `node` request.')
      await respond({ node: null })
      return
    }

    switch (getBy) {
      case 'publicKey':
        const publicKey = payload.publicKey
        if (!publicKey) {
          this.mainLogger.debug('No public key provided with `node` request to get by public key.')
          await respond({ node: null })
          return
        }
        const node = this.state.getNodeByPubKey(publicKey)
        await respond({ node })
        break
      default:
        this.mainLogger.debug('Invalid query method provided with `node` request.')
        await respond({ node: null })
    }
  })

  // -------- GOSSIP Routes ----------

  this.registerGossipHandler('join', async (payload, sender, tracker) => {
    if (!this.state.acceptJoinRequests || this.joinRequestToggle === false) return this.mainLogger.debug('Join request not accepted. Not accepting join requests currently.')
    const accepted = await this.addJoinRequest(payload, tracker, false)
    if (!accepted) return this.mainLogger.debug('Join request not accepted.')
    this.mainLogger.debug('Join request accepted!')
  })

  this.registerGossipHandler('active', async (payload, sender, tracker) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided with `active` request.')
      return
    }
    this.mainLogger.debug(`Payload for 'active' request: ${JSON.stringify(payload)}`)
    // Add status update of given node to queue
    const added = await this.state.addStatusUpdate(payload)
    if (!added) return this.mainLogger.debug(`Status update to active for ${payload.nodeId} not added.`)
    this.sendGossipIn('active', payload, tracker, sender)
  })

  /*
  this.registerGossipHandler('apoptosis', async (payload, sender, tracker) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided with `apoptosis` request.')
      return
    }
    this.mainLogger.debug(`Payload for 'apoptosis' request: ${JSON.stringify(payload)}`)
    // Attempt to add apoptosis message to cycle
    const added = await this.state.addExtApoptosisMessage(payload)
    if (!added) return this.mainLogger.debug(`Apoptosis message for ${payload.nodeId} not added.`)
    this.sendGossipIn('apoptosis', payload, tracker, sender)
  })
  */

  this.registerGossipHandler('certificate', async (payload, sender, tracker) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided for the `certificate` request.')
      return
    }
    const certificate = payload
    this.mainLogger.debug(`Propagated cycle certificate: ${JSON.stringify(certificate)}`)
    const [added, reason] = this.state.addCertificate(certificate, true)
    if (!added) {
      switch (reason) {
        case 'not_better':
          return
        case 'diff_cm':
          const cycleUpdates = await this._requestCycleUpdates(sender)
          const cycleUpdated = await this.state.addCycleUpdates(cycleUpdates)
          if (!cycleUpdated) return
          // Try to see if they had the same cycle marker, and if they did, check if their cert is better
          const [added] = this.state.addCertificate(certificate, true)
          if (!added) {
            const ourCert = this.state.getCurrentCertificate()
            this.sendGossipIn('certificate', ourCert, tracker, sender)
            return
          }
          break
      }
    }
    this.sendGossipIn('certificate', certificate, tracker, sender)
  })

  this.registerGossipHandler('scaling', async (payload, sender, tracker) => {
    if (!payload) {
      this.mainLogger.debug('No payload provided for the `scaling` request.')
      return
    }
    const added = await this.state.addExtScalingRequest(payload)
    if (!added) return
    this.sendGossipIn('scaling', payload, tracker)
  })

  // -------- DEMO Routes ----------

  this.network.registerExternalGet('nodelist', async (req, res) => {
    return res.json({ nodelist: this.state.getAllNodes() })
  })

  this.network.registerExternalGet('apoptosis', async (req, res) => {
    res.json({ apoptosis: true })
    await this.initApoptosis()
  })
}
