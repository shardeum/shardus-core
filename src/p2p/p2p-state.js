const utils = require('../utils')

class P2PState {
  constructor (config, logger, storage, crypto) {
    this.mainLogger = logger.getLogger('main')
    this.crypto = crypto
    this.storage = storage
    this.defaultCycleDuration = config.cycleDuration

    this.cycles = []

    // Variables for regulating different phases cycles
    this.acceptJoinReq = false
    this.shouldStop = false

    // Specifies valid statuses
    this.validStatuses = ['active', 'syncing', 'pending']

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
      certificate: {}
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
    if (!this.acceptJoinReq) return false
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

  async setNodeStatus (nodeId, status) {
    let node
    try {
      node = this.getNode(nodeId)
    } catch (e) {
      this.mainLogger.debug(`${nodeId} is not a valid or known node ID.`)
      return false
    }
    let updated
    try {
      updated = await this._updateNodeStatus(node, status)
    } catch (e) {
      this.mainLogger.error(e)
      return false
    }
    return updated
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
  // TODO: Pull insertOrdered fn from old codebase
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
    this._startJoinPhase(quarterCycle)
  }

  _startJoinPhase (phaseLen) {
    this.mainLogger.debug('Starting join phase...')
    this.acceptJoinReq = true
    setTimeout(() => {
      this._endJoinPhase(phaseLen)
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

  _addToBestJoinRequests (joinRequest) {
    // TODO: implement full logic for filtering join request
    const bestRequests = this._getBestJoinRequests()
    const { nodeInfo } = joinRequest
    if (this._isKnownNode(nodeInfo)) return false
    bestRequests.push(joinRequest)
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

  _endJoinPhase (phaseLen) {
    this.mainLogger.debug('Ending join phase...')
    this.acceptJoinReq = false
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
    this.addCertificate(certificate)
  }

  async _createCycle () {
    this.mainLogger.info('Creating new cycle chain entry...')
    const cycleInfo = this.getCycleInfo()
    cycleInfo.marker = this.getCurrentCertificate().marker

    this.cycles.push(cycleInfo)
    const accepted = this._acceptNodes(cycleInfo.joined, cycleInfo.marker)
    const cycleAdded = this.storage.addCycles(cycleInfo)
    const promises = [accepted, cycleAdded]
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
    const cert = this.crypto.sign({ marker: cycleMarker })
    return cert
  }

  addCertificate (certificate) {
    this.mainLogger.debug('Adding certificate...')
    // TODO: Should check whether certificate is better or not than current cert
    this.currentCycle.certificate = certificate
    this.mainLogger.debug('Certificate added!')
    return true
    /*
      TODO:
        Should return true or false of whether the cert was added,
        will be used when deciding whether to propagate cert or not
    */
  }

  getCycles (start = 0, end = (this.cycles.length - 1)) {
    if (start < 0) throw new Error('Invalid start cycle counter.')
    if (end > this.cycles.length - 1) throw new Error('Invalid end cycle counter.')
    return this.cycles.slice(start, end + 1)
  }

  getCurrentCertificate () {
    // TODO: implement certificate propagation
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
    return this.currentCycle.activated
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
  }

  getNode (id) {
    const current = this.nodes.current
    if (!current[id]) throw new Error('Invalid node ID.')
    return current[id]
  }

  getAllNodes (self = null) {
    const nodes = this.nodes.current
    if (!self) return Object.values(nodes)
    // Check if self in node list
    if (!nodes[self]) throw new Error('Fatal: Invalid node ID in `self` field.')
    const nodesCopy = utils.deepCopy(nodes)
    delete nodesCopy[self]
    return Object.values(nodesCopy)
  }
}

module.exports = P2PState
