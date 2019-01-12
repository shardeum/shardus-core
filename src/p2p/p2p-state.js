const utils = require('../utils')

class P2PState {
  constructor (config, logger, storage, p2p, crypto) {
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.crypto = crypto
    this.storage = storage
    this.defaultCycleDuration = config.cycleDuration

    this.cycles = []

    // Variables for regulating different phases cycles
    this.acceptChainUpdates = false
    this.shouldStop = false
    this.unfinalizedReady = false
    this.cyclesStarted = false

    // Specifies valid statuses
    this.validStatuses = ['active', 'syncing', 'pending']
    this.statusUpdateType = {
      'active': 'activated'
    }

    // Defines a clean nodelist that we will use for restoring the nodeslist to a clean state
    this.cleanNodelist = {
      ordered: [],
      current: {},
      byIp: {}
    }

    // Populates the clean nodelist with our valid statuses
    for (const status of this.validStatuses) {
      this.cleanNodelist[status] = {}
    }

    // Defines a clean cycle that we will for restoring the current cycle to a clean state
    this.cleanCycle = {
      metadata: {
        bestCertDist: null,
        updateSeen: {},
        receivedCerts: false
      },
      updates: {
        bestJoinRequests: [],
        active: []
      },
      data: {
        start: null,
        duration: null,
        joined: [],
        removed: [],
        lost: [],
        returned: [],
        activated: [],
        certificate: {}
      }
    }

    // Sets nodelist and current cycle to a copy of the clean nodelist and cycle objects
    this.nodes = utils.deepCopy(this.cleanNodelist)
    this.currentCycle = utils.deepCopy(this.cleanCycle)
  }

  async init () {
    const cycles = await this.storage.listCycles()
    this.mainLogger.debug(`Loaded ${cycles.length} cycles from the database.`)
    this.cycles = cycles
    const nodes = await this.storage.listNodes()
    this.mainLogger.debug(`Loaded ${nodes.length} nodes from the database.`)
    this._addNodesToNodelist(nodes)
  }

  _resetNodelist () {
    this.nodes = utils.deepCopy(this.cleanNodelist)
  }

  _resetCycles () {
    this.cycles.length = 0
  }

  _resetState () {
    this._resetCurrentCycle()
    this._resetNodelist()
    this._resetCycles()
  }

  async clear () {
    this.mainLogger.info('Clearing P2P state in memory and in database...')
    await this.storage.clearP2pState()
    await this.storage.deleteProperty('id')
    this.mainLogger.info('P2P data cleared from database.')
    this._resetState()
  }

  _addJoinRequest (joinRequest) {
    if (!this.cyclesStarted) return false
    if (!this._addToBestJoinRequests(joinRequest)) {
      this.mainLogger.debug('Join request not added: Was not best request for this cycle.')
      return false
    }
    this._addPendingNode(joinRequest.nodeInfo)
    return true
  }

  addNewJoinRequest (joinRequest) {
    if (!this.acceptChainUpdates) {
      this.mainLogger.debug('Join request not added: Not accepting chain updates right now.')
      return false
    }
    return this._addJoinRequest(joinRequest)
  }

  addGossipedJoinRequest (joinRequest) {
    return this._addJoinRequest(joinRequest)
  }

  _addPendingNode (node) {
    this.nodes.pending[node.publicKey] = node
    const internalHost = `${node.internalIp}:${node.internalPort}`
    this.nodes.byIp[internalHost] = node
  }

  _removeJoiningNode (node) {
    delete this.nodes.pending[node.publicKey]
    const internalHost = `${node.internalIp}:${node.internalPort}`
    delete this.nodes.byIp[internalHost]
  }

  _addJoiningNodes (nodes) {
    for (const node of nodes) {
      this.currentCycle.data.joined.push(node.publicKey)
    }
  }

  // Checks if a given timestamp is during the current cycle
  isDuringThisCycle (timestamp) {
    const start = this.getCurrentCycleStart() * 1000
    const duration = this.getCurrentCycleDuration() * 1000
    const end = start + duration
    if (timestamp < start) {
      this.mainLogger.debug('Status update timestamp is too old for this cycle.')
      return false
    }
    if (timestamp > end) {
      this.mainLogger.debug('Status update timestamp is too far in the future for this cycle.')
      return false
    }
    return true
  }

  computeNodeId (publicKey, cycleMarker) {
    const nodeId = this.crypto.hash({ publicKey, cycleMarker })
    this.mainLogger.debug(`Node ID is: ${nodeId}`)
    return nodeId
  }

  getNodeStatus (nodeId) {
    const current = this.nodes.current
    if (!current[nodeId]) return null
    return current[nodeId].status
  }

  // Can check if a node ID or public key has been seen for an update already this cycle
  _wasSeenThisCycle (key) {
    if (!this.currentCycle.metadata.updateSeen[key]) {
      return false
    }
    return true
  }

  // Marks a node as seen for an update this cycle
  _markNodeAsSeen (key) {
    this.currentCycle.metadata.updateSeen[key] = true
  }

  addStatusUpdate (update) {
    if (!this.cyclesStarted) return false
    const { nodeId, status, timestamp, sign } = update

    // Validate that all required fields exist
    if (!nodeId) {
      this.mainLogger.debug('Node ID of node was not provided with status update.')
      return false
    }
    if (!sign) {
      this.mainLogger.debug('Status update was not signed.')
      return false
    }
    if (!status) {
      this.mainLogger.debug('No status given with update.')
      return false
    }
    if (!timestamp) {
      this.mainLogger.debug('No timestamp given with update.')
      return false
    }

    // Check if node has already been seen for an update for this cycle
    if (this._wasSeenThisCycle(nodeId)) {
      this.mainLogger.debug(`Node ID ${nodeId} has already been seen this cycle.`)
      return false
    }
    // Check if node status already matches update status
    const currentStatus = this.getNodeStatus(nodeId)
    if (currentStatus === status) {
      this.mainLogger.debug(`Node status ${currentStatus} already matches requested status of ${status}. Unable to add status update.`)
      return false
    }
    // Check if the timestamp is valid
    if (!this.isDuringThisCycle(timestamp)) {
      this.mainLogger.debug(`The timestamp ${timestamp} is not a time during the current cycle. Unable to add status update.`)
      return false
    }
    // Check if the status update is of a valid type
    const invalidStatusMsg = `Invalid status: ${status}. Unable to add status update to queue.`
    if (!this.validStatuses.includes(status)) {
      this.mainLogger.debug(invalidStatusMsg)
      return false
    }
    // Get status type
    let type
    try {
      type = this.statusUpdateType[status]
    } catch (e) {
      this.mainLogger.debug(invalidStatusMsg)
      return false
    }

    // Try to get the public key associated with given node ID
    let publicKey
    try {
      ;({ publicKey } = this.getNode(nodeId))
    } catch (e) {
      this.mainLogger.debug(e)
      ;({ publicKey } = null)
    }
    if (!publicKey) {
      this.mainLogger.debug('Unknown node ID in status update.')
      return false
    }
    // Check if the status update was signed by the node
    const isSignedByNode = this.crypto.verify(update, publicKey)
    if (!isSignedByNode) {
      this.mainLogger.debug('Status update was not signed by the expected node.')
      return false
    }

    this.mainLogger.debug(`Type of status update: ${type}`)

    // Finally add the update after all validation has passed
    this.currentCycle.updates[status].push(update)
    utils.insertSorted(this.currentCycle.data[type], nodeId)
    // Mark node as seen for this cycle
    this._markNodeAsSeen(nodeId)
    this.mainLogger.debug(`Node ${nodeId} added to ${type} list for this cycle.`)
    return true
  }

  // TODO: Update this to go through entire update types
  async addCycleUpdates (updates) {
    const { bestJoinRequests, active } = updates
    for (const joinRequest of bestJoinRequests) {
      this._addJoinRequest(joinRequest)
    }
    for (const activeRequest of active) {
      this.addStatusUpdate(activeRequest)
    }
    await this._createCycleMarker()
  }

  async _setNodeStatus (nodeId, status) {
    // Get node by ID
    let node
    try {
      node = this.getNode(nodeId)
    } catch (e) {
      this.mainLogger.debug(`${nodeId} is not a valid or known node ID.`)
      return false
    }
    // Try to update status for given node
    let updated
    try {
      updated = await this._updateNodeStatus(node, status)
    } catch (e) {
      this.mainLogger.error(e)
      return false
    }
    return updated
  }

  // Sets a group of nodes to a particular status
  async _setNodesToStatus (nodeIds, status) {
    this.mainLogger.debug(`Node IDs to be updated to ${status} status: ${JSON.stringify(nodeIds)}`)
    const promises = []
    for (const nodeId of nodeIds) {
      promises.push(this._setNodeStatus(nodeId, status))
    }
    await Promise.all(promises)
  }

  // For use for internal updates to status for this node
  async directStatusUpdate (nodeId, status, updateDb) {
    // Check if we actually know about this node
    const node = this.getNode(nodeId)
    if (!node) {
      this.mainLogger.debug('Cannot update status of unknown node.')
      return false
    }
    const invalidStatusMsg = `Invalid status: ${status}. Unable to update status.`
    if (!this.validStatuses.includes(status)) {
      this.mainLogger.debug(invalidStatusMsg)
      return false
    }
    await this._updateNodeStatus(node, status, updateDb)
    return true
  }

  async _updateNodeStatus (node, status, updateDb = true) {
    if (!this.validStatuses.includes(status)) throw new Error('Invalid node status.')
    if (node.status === status) return true
    const oldStatus = node.status
    this.mainLogger.debug(`Old status of node: ${oldStatus}`)
    node.status = status
    this.mainLogger.debug(`New status of node: ${node.status}`)
    const id = node.id
    // If the node previously had a status, remove it from that index object
    if (oldStatus && this.nodes[oldStatus][id]) delete this.nodes[oldStatus][id]
    this.nodes[status][id] = node
    if (!updateDb) return true
    await this.storage.updateNodes({ id }, { status })
    return true
  }

  async _acceptNode (publicKey, cycleMarker) {
    let node
    try {
      node = this.nodes.pending[publicKey]
    } catch (e) {
      throw new Error('Node not found in pending.')
    }
    let nodeId = this.computeNodeId(publicKey, cycleMarker)
    node.id = nodeId
    node.cycleJoined = cycleMarker
    this.nodes.ordered.push(node)
    delete this.nodes.pending[node.publicKey]
    await this._updateNodeStatus(node, 'syncing', false)
    await this.addNode(node)
    this.mainLogger.debug(`Nodelist after adding this node: ${JSON.stringify(this.nodes.current)}`)
  }

  async _acceptNodes (publicKeys, cycleMarker) {
    const promises = []
    for (const publicKey of publicKeys) {
      promises.push(this._acceptNode(publicKey, cycleMarker))
    }
    await Promise.all(promises)
  }

  // TODO: Insert ordered into order subobject
  _addNodeToNodelist (node) {
    const status = node.status
    if (!this.validStatuses.includes(status)) throw new Error('Invalid node status.')
    this.nodes[status][node.id] = node
    this.nodes.current[node.id] = node
  }

  _addNodesToNodelist (nodes) {
    for (const node of nodes) {
      if (node.status) this._addNodeToNodelist(node)
      else throw new Error('Node does not have status property')
    }
  }

  // This is for adding a node both in memory and to storage
  async addNode (node) {
    this._addNodeToNodelist(node)
    await this.storage.addNodes(node)
  }

  // This is for adding nodes both in memory and to storage
  async addNodes (nodes) {
    this._addNodesToNodelist(nodes)
    await this.storage.addNodes(nodes)
  }

  _computeCycleMarker (fields) {
    this.mainLogger.debug(`Computing cycle marker... Cycle marker fields: ${JSON.stringify(fields)}`)
    const cycleMarker = this.crypto.hash(fields)
    this.mainLogger.debug(`Created cycle marker: ${cycleMarker}`)
    return cycleMarker
  }

  _resetCurrentCycle () {
    this.currentCycle = utils.deepCopy(this.cleanCycle)
  }

  // Kicks off the whole cycle and cycle marker creation system
  startCycles () {
    this.cyclesStarted = true
    this.shouldStop = false
    this.mainLogger.info('Starting first cycle...')
    this._startNewCycle()
  }

  stopCycles () {
    this.shouldStop = true
  }

  _startNewCycle () {
    this._resetCurrentCycle()
    const lastCycleDuration = this.getLastCycleDuration()
    const lastCycleStart = this.getLastCycleStart()
    const currentTime = utils.getTime('s')
    this.currentCycle.data.duration = lastCycleDuration
    this.currentCycle.data.start = lastCycleStart ? lastCycleStart + lastCycleDuration : utils.getTime('s')
    this.mainLogger.info(`Starting new cycle of duration ${this.getCurrentCycleDuration()}...`)
    this.mainLogger.debug(`Last cycle start time: ${lastCycleStart}`)
    this.mainLogger.debug(`Last cycle duration: ${lastCycleDuration}`)
    this.mainLogger.debug(`Current time: ${currentTime}`)
    const quarterCycle = Math.ceil(this.getCurrentCycleDuration() * 1000 / 4)
    this._startUpdatePhase(this.currentCycle.data.start * 1000, quarterCycle)
  }

  _startUpdatePhase (startTime, phaseLen) {
    this.mainLogger.debug('Starting update phase...')
    this.acceptChainUpdates = true
    const endTime = startTime + phaseLen
    utils.setAlarm(() => {
      this._endUpdatePhase(endTime, phaseLen)
    }, endTime)
  }

  _getBestJoinRequests () {
    return this.currentCycle.updates.bestJoinRequests
  }

  _isKnownNode (node) {
    const internalHost = `${node.internalIp}:${node.internalPort}`
    if (!this.nodes.byIp[internalHost]) return false
    return true
  }

  _isBetterThanLowestBest (request, lowest) {
    if (!this.crypto.isGreaterHash(request.selectionNum, lowest.selectionNum)) {
      return false
    }
    return true
  }

  _addToBestJoinRequests (joinRequest) {
    const { nodeInfo } = joinRequest

    // Check if this node has already been seen this cycle
    if (this._wasSeenThisCycle(nodeInfo.publicKey)) {
      this.mainLogger.debug('Node has already been seen this cycle. Unable to add join request.')
      return false
    }

    // Mark node as seen for this cycle
    this._markNodeAsSeen(nodeInfo.publicKey)

    // Return if we already know about this node
    if (this._isKnownNode(nodeInfo)) {
      this.mainLogger.info('Cannot add join request for this node, already a known node.')
      return false
    }

    // Get the list of best requests
    const bestRequests = this._getBestJoinRequests()

    // TODO: calculate how many nodes to accept this cycle
    const toAccept = 1

    // If length of array is bigger, do this precheck
    const competing = bestRequests.length >= toAccept
    if (competing) {
      const lastIndex = bestRequests.length - 1
      const lowest = bestRequests[lastIndex]

      // Check if we are better than the lowest best
      if (!this._isBetterThanLowestBest(joinRequest, lowest)) {
        this.mainLogger.debug(`${joinRequest.selectionNum} is not better than ${lowest.selectionNum}. Node ${joinRequest.nodeInfo.publicKey} not added to this cycle.`)
        return false
      }
    }

    // Insert sorted into best list if we made it this far
    utils.insertSorted(bestRequests, joinRequest, (a, b) => (a.selectionNum < b.selectionNum ? 1 : (a.selectionNum > b.selectionNum ? -1 : 0)))

    // If we were competing for a spot, we have to get rid of the weakest link
    if (competing) {
      const removedRequest = bestRequests.pop()
      const removedNode = removedRequest.nodeInfo
      this.mainLogger.debug(`Removing the following node from this cycle's join requests: ${removedNode}`)
      this._removeJoiningNode(removedNode)
    }
    return true
  }

  // TODO: implement this to get best nodes based on POW, selection number,
  // ---   and number of desired nodes
  _getBestNodes () {
    const bestNodes = []
    const bestJoinRequests = this._getBestJoinRequests()
    for (const joinRequest of bestJoinRequests) {
      bestNodes.push(joinRequest.nodeInfo)
    }
    this.mainLogger.debug(`Best nodes for this cycle: ${JSON.stringify(bestNodes)}`)
    return bestNodes
  }

  _endUpdatePhase (startTime, phaseLen) {
    this.mainLogger.debug('Ending update phase...')
    this.acceptChainUpdates = false
    const bestNodes = this._getBestNodes()
    this._addJoiningNodes(bestNodes)
    const endTime = startTime + phaseLen
    utils.setAlarm(() => {
      this._startCycleSync(endTime, phaseLen)
    }, endTime)
  }

  async _startCycleSync (startTime, phaseLen) {
    this.mainLogger.debug('Starting cycle sync phase...')
    await this._createCycleMarker()
    const endTime = startTime + phaseLen
    utils.setAlarm(() => {
      this._finalizeCycle(endTime, phaseLen)
    }, endTime)
  }

  async _finalizeCycle (startTime, phaseLen) {
    this.mainLogger.debug('Starting cycle finalization phase...')
    const endTime = startTime + phaseLen
    utils.setAlarm(async () => {
      await this._createCycle()
      this.unfinalizedReady = false
      if (this.shouldStop) return
      this._startNewCycle()
    }, endTime)
    // TODO: Make it so seed node doesn't need to call this when alone
    // if (!this.currentCycle.metadata.receivedCerts) await this.p2p.requestUpdatesFromRandom()
    this.unfinalizedReady = true
  }

  async _createCycleMarker () {
    this.mainLogger.info('Creating new cycle marker...')
    const cycleInfo = this.getCycleInfo(false)
    const cycleMarker = this._computeCycleMarker(cycleInfo)
    const certificate = this._createCertificate(cycleMarker)
    if (!this.cycles.length) return this.addCertificate({ marker: cycleMarker, signer: '0'.repeat(64) })
    const [added] = this.addCertificate(certificate)
    if (!added) return
    await this.p2p.sendGossip('certificate', certificate)
  }

  async addUnfinalizedAndStart (cycle) {
    if (!cycle) {
      this.mainLogger.info('Unable to add unfinalized cycle. Cycle not given.')
      return false
    }
    const { start, duration } = cycle
    const currTime = utils.getTime('s')
    const toWait = ((start + duration) - currTime) * 1000
    this.currentCycle = cycle
    await this._createCycle()
    this.mainLogger.debug(`Waiting ${toWait} ms before starting cycles...`)
    setTimeout(() => {
      this.mainLogger.debug('Starting up cycles...')
      this.startCycles()
    }, toWait)
  }

  async addCycle (cycle) {
    this.cycles.push(cycle)
    await this.storage.addCycles(cycle)
  }

  async addCycles (cycles) {
    for (const cycle of cycles) {
      this.cycles.push(cycle)
    }
    await this.storage.addCycles(cycles)
    this.mainLogger.debug(`All cycles after adding given cycles: ${JSON.stringify(this.cycles)}`)
  }

  async _createCycle () {
    this.mainLogger.info('Creating new cycle chain entry...')
    const cycleInfo = this.getCycleInfo()
    this.mainLogger.debug(`Cycle info for new cycle: ${JSON.stringify(cycleInfo)}`)
    cycleInfo.marker = this.getCurrentCertificate().marker

    const accepted = this._acceptNodes(cycleInfo.joined, cycleInfo.marker)
    this.mainLogger.debug(`Nodes to be activated this cycle: ${JSON.stringify(cycleInfo.activated)}`)
    const activated = this._setNodesToStatus(cycleInfo.activated, 'active')
    const cycleAdded = this.addCycle(cycleInfo)
    const promises = [accepted, activated, cycleAdded]
    try {
      await Promise.all(promises)
      this.mainLogger.info('Added cycle chain entry to database successfully!')
    } catch (e) {
      this.mainLogger.error(e)
    }
  }

  getCycleInfo (withCert = true) {
    const previous = this.getCurrentCycleMarker()
    const counter = this.getCycleCounter()
    const start = this.getCurrentCycleStart()
    const duration = this.getCurrentCycleDuration()
    const active = this.getActiveCount()
    const desired = this.getDesiredCount()
    const joined = this.getJoined()
    const removed = this.getRemoved()
    const lost = this.getLost()
    const returned = this.getReturned()
    const activated = this.getActivated()

    const cycleInfo = {
      previous,
      counter,
      start,
      duration,
      active,
      desired,
      joined,
      removed,
      lost,
      returned,
      activated
    }
    if (withCert) {
      cycleInfo.certificate = this.getCurrentCertificate()
    }

    return cycleInfo
  }

  _createCertificate (cycleMarker) {
    this.mainLogger.info(`Creating certificate for cycle marker ${cycleMarker}...`)
    const signer = this.p2p.id
    const cert = this.crypto.sign({ marker: cycleMarker, signer })
    return cert
  }

  addCertificate (certificate, fromNetwork = false) {
    const addCert = (cert, dist) => {
      this.currentCycle.data.certificate = cert
      this.currentCycle.metadata.bestCertDist = dist
      this.mainLogger.debug('Certificate added!')
    }
    this.mainLogger.debug('Attempting to add certificate...')
    this.mainLogger.debug(`Certificate to be added: ${JSON.stringify(certificate)}`)

    // TODO: verify signer of the certificate and return false plus 'invalid_signer' reason

    // If we received this cert from the network, change our receivedCerts flag to true
    if (fromNetwork) {
      // TODO: Make this return the proper reason
      if (!this.cyclesStarted) return [false, 'not_better']
      this.currentCycle.metadata.receivedCerts = true
    }

    // If we don't have a best cert for this cycle yet, just add this cert
    if (!this.currentCycle.metadata.bestCertDist) {
      const certDist = utils.XOR(certificate.marker, certificate.signer)
      addCert(certificate, certDist)
      return [true]
    }

    // If the cycle marker is different than what we have, don't add it
    if (certificate.marker !== this.getCurrentCertificate().marker) {
      console.log(certificate.marker)
      console.log(this.getCurrentCertificate().marker)
      this.mainLogger.debug('The cycle marker from this certificate is different than the one we currently have...')
      return [false, 'diff_cm']
    }

    // Calculate XOR distance between cycle marker and the signer of the certificate's node ID
    const certDist = utils.XOR(certificate.marker, certificate.signer)

    // If we don't have a best cert for this cycle yet, just add this cert
    if (!this.currentCycle.metadata.bestCertDist) {
      addCert(certificate, certDist)
      return [true]
    }

    // If the cert distance for this cert is less than the current best, return false
    if (certDist <= this.currentCycle.metadata.bestCertDist) {
      this.mainLogger.debug('Certificate not added. Current certificate is better.')
      this.mainLogger.debug(`Current certificate distance from cycle marker: ${this.currentCycle.metadata.bestCertDist}`)
      this.mainLogger.debug(`This certificate distance from cycle marker: ${certDist}`)
      return [false, 'not_better']
    }

    // Otherwise, we have the new best, add it and return true
    addCert(certificate, certDist)
    return [true]
  }

  getCycles (start = 0, end = this.cycles.length) {
    if (start < 0) throw new Error('Invalid start cycle counter.')
    if (end > this.cycles.length) throw new Error('Invalid end cycle counter.')
    return this.cycles.slice(start, end + 1)
  }

  getCurrentCertificate () {
    const cert = this.currentCycle.data.certificate
    if (!Object.keys(cert).length) return null
    return cert
  }

  getActiveCount () {
    const activeNodes = Object.values(this.nodes.active)
    if (!activeNodes.length) return 1
    return activeNodes.length
  }

  getDesiredCount () {
    // TODO: Implement an actual calculation
    return 100
  }

  getLastCycles (amount) {
    if (this.cycles.length < amount) {
      return this.cycles
    }
    return this.cycles.slice(0 - amount)
  }

  getJoined () {
    return this.currentCycle.data.joined
  }

  getRemoved () {
    return this.currentCycle.data.removed
  }

  getLost () {
    return this.currentCycle.data.lost
  }

  getReturned () {
    return this.currentCycle.data.returned
  }

  getActivated () {
    const activated = this.currentCycle.data.activated
    this.mainLogger.debug(`Result of getActivated: ${JSON.stringify(activated)}`)
    return activated
  }

  getLastCycle () {
    if (!this.cycles.length) return null
    return this.cycles[this.cycles.length - 1]
  }

  getCycleCounter () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return 0
    return lastCycle.counter + 1
  }

  getLastCycleStart () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return null
    return lastCycle.start
  }

  getCurrentCycleStart () {
    return this.currentCycle.data.start || null
  }

  getLastCycleDuration () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return this.defaultCycleDuration
    return lastCycle.duration
  }

  getCurrentCycleDuration () {
    return this.currentCycle.data.duration
  }

  getCurrentCycleMarker () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return '0'.repeat(64)
    return lastCycle.marker
  }

  getNextCycleMarker () {
    const currentCert = this.getCurrentCertificate()
    if (!currentCert) return null
    const nextCycleMarker = currentCert.marker
    return nextCycleMarker
  }

  getLastJoined () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return []
    return lastCycle.joined
  }

  _areEquivalentNodes (node1, node2) {
    const properties = ['externalIp', 'internalIp', 'externalPort', 'internalPort']
    for (const property of properties) {
      if (!node1[property] || !node2[property]) return false
      if (node1[property] !== node2[property]) return false
    }
    return true
  }

  getNode (id) {
    const current = this.nodes.current
    if (!current[id]) throw new Error('Invalid node ID.')
    return current[id]
  }

  _getSubsetOfNodelist (nodes, self = null) {
    if (!self) return Object.values(nodes)
    // Check if self in node list
    if (!nodes[self]) {
      this.mainLogger.error(`Invalid node ID in 'self' field. Given ID: ${self}`)
      return Object.values(nodes)
    }
    const nodesCopy = utils.deepCopy(nodes)
    delete nodesCopy[self]
    return Object.values(nodesCopy)
  }

  getAllNodes (self) {
    return this._getSubsetOfNodelist(this.nodes.current, self)
  }

  getActiveNodes (self) {
    return this._getSubsetOfNodelist(this.nodes.active, self)
  }
}

module.exports = P2PState
