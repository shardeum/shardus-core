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
      bestJoinRequests: [],
      start: null,
      duration: null,
      joined: [],
      removed: [],
      lost: [],
      returned: [],
      activated: [],
      certificate: {},
      bestCertDist: null
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
    if (!this._addToBestJoinRequests(joinRequest)) {
      return false
    }
    this._addPendingNode(joinRequest.nodeInfo)
    return true
  }

  addNewJoinRequest (joinRequest) {
    if (!this.acceptChainUpdates) return false
    return this._addJoinRequest(joinRequest)
  }

  addGossipedJoinRequest (joinRequest) {
    return this._addJoinRequest(joinRequest)
  }

  _addPendingNode (node) {
    this.nodes.pending[node.publicKey] = node
  }

  _addJoiningNodes (nodes) {
    for (const node of nodes) {
      this.currentCycle.joined.push(node.publicKey)
    }
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

  addStatusUpdate (nodeId, status) {
    // Check if we actually know about this node
    if (!this.getNode(nodeId)) {
      this.mainLogger.debug('Cannot update status of unknown node.')
      return false
    }
    const invalidStatusMsg = `Invalid status: ${status}. Unable to add status update to queue.`
    if (!this.validStatuses.includes(status)) {
      this.mainLogger.debug(invalidStatusMsg)
      return false
    }
    let type
    try {
      type = this.statusUpdateType[status]
    } catch (e) {
      this.mainLogger.debug(invalidStatusMsg)
      return false
    }
    this.mainLogger.debug(`Type of status update: ${type}`)
    this.currentCycle[type].push(nodeId)
    this.mainLogger.debug(`Node ${nodeId} added to ${type} list for this cycle.`)
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
    this.nodes.byIp[`${node.internalIp}:${node.internalPort}`] = node
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
    this.currentCycle.duration = lastCycleDuration
    this.currentCycle.start = lastCycleStart ? lastCycleStart + lastCycleDuration : utils.getTime('s')
    this.mainLogger.info(`Starting new cycle of duration ${this.getCurrentCycleDuration()}...`)
    this.mainLogger.debug(`Last cycle start time: ${lastCycleStart}`)
    this.mainLogger.debug(`Last cycle duration: ${lastCycleDuration}`)
    this.mainLogger.debug(`Current time: ${currentTime}`)
    const quarterCycle = Math.ceil(this.getCurrentCycleDuration() * 1000 / 4)
    this._startUpdatePhase(quarterCycle)
  }

  _startUpdatePhase (phaseLen) {
    this.mainLogger.debug('Starting join phase...')
    this.acceptChainUpdates = true
    setTimeout(() => {
      this._endUpdatePhase(phaseLen)
    }, phaseLen)
  }

  _getBestJoinRequests () {
    return this.currentCycle.bestJoinRequests
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

  // Check if better than lowest best, if not, return false: check that we're not propagating
  // Insert sorted
  // If length of array is bigger than our max nodes per cycle, drop lowest

  _addToBestJoinRequests (joinRequest) {
    const bestRequests = this._getBestJoinRequests()
    const { nodeInfo } = joinRequest

    // Return if we already know about this node
    if (this._isKnownNode(nodeInfo)) return false

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
    if (competing) bestRequests.pop()
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

  _endUpdatePhase (phaseLen) {
    this.mainLogger.debug('Ending join phase...')
    this.acceptChainUpdates = false
    const bestNodes = this._getBestNodes()
    this._addJoiningNodes(bestNodes)
    // TODO: implement clearing out the unaccepted nodes from byIp when clearing pending requests
    setTimeout(() => {
      this._startCycleSync(phaseLen)
    }, phaseLen)
  }

  _startCycleSync (phaseLen) {
    this.mainLogger.debug('Starting cycle sync phase...')
    this._createCycleMarker()
    setTimeout(() => {
      this._finalizeCycle(phaseLen)
    }, phaseLen)
  }

  async _finalizeCycle (phaseLen) {
    this.mainLogger.debug('Starting cycle finalization phase...')
    this._createCycle()
    setTimeout(() => {
      if (this.shouldStop) return
      this._startNewCycle()
    }, phaseLen)
  }

  _createCycleMarker () {
    this.mainLogger.info('Creating new cycle marker...')
    const cycleInfo = this.getCycleInfo(false)
    const cycleMarker = this._computeCycleMarker(cycleInfo)
    const certificate = this._createCertificate(cycleMarker)
    if (!this.cycles.length) return this.addCertificate({ marker: cycleMarker, signer: '0'.repeat(64) })
    const added = this.addCertificate(certificate)
    if (!added) return
    this.p2p.sendGossip('certificate', certificate)
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

  addCertificate (certificate) {
    const addCert = (cert, dist) => {
      this.currentCycle.certificate = cert
      this.currentCycle.bestCertDist = dist
      this.mainLogger.debug('Certificate added!')
    }
    this.mainLogger.debug('Attempting to add certificate...')
    this.mainLogger.debug(`Certificate to be added: ${JSON.stringify(certificate)}`)

    // Calculate XOR distance between cycle marker and the signer of the certificate's node ID
    const certDist = utils.XOR(certificate.marker, certificate.signer)

    // If we don't have a best cert for this cycle yet, just add this cert
    if (!this.currentCycle.bestCertDist) {
      addCert(certificate, certDist)
      return true
    }

    // If the cert distance for this cert is less than the current best, return false
    if (certDist <= this.currentCycle.bestCertDist) {
      this.mainLogger.debug('Certificate not added. Current certificate is better.')
      this.mainLogger.debug(`Current certificate distance from cycle marker: ${this.currentCycle.bestCertDist}`)
      this.mainLogger.debug(`This certificate distance from cycle marker: ${certDist}`)
      return false
    }

    // Otherwise, we have the new best, add it and return true
    addCert(certificate, certDist)
    return true
  }

  getCycles (start = 0, end = this.cycles.length) {
    if (start < 0) throw new Error('Invalid start cycle counter.')
    if (end > this.cycles.length) throw new Error('Invalid end cycle counter.')
    return this.cycles.slice(start, end + 1)
  }

  getCurrentCertificate () {
    const cert = this.currentCycle.certificate
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
    return this.currentCycle.joined
  }

  getRemoved () {
    return this.currentCycle.removed
  }

  getLost () {
    return this.currentCycle.lost
  }

  getReturned () {
    return this.currentCycle.returned
  }

  getActivated () {
    const activated = this.currentCycle.activated
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
    return this.currentCycle.start || null
  }

  getLastCycleDuration () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return this.defaultCycleDuration
    return lastCycle.duration
  }

  getCurrentCycleDuration () {
    return this.currentCycle.duration
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
      throw new Error(`Fatal: Invalid node ID in 'self' field. Given ID: ${self}`)
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
