const utils = require('../utils')

class P2PState {
  constructor (config, logger, storage, crypto) {
    this.mainLogger = logger.getLogger('main')
    this.crypto = crypto
    this.storage = storage
    this.defaultCycleDuration = config.cycleDuration
    this.nodes = {
      ordered: [],
      current: {},
      active: {},
      syncing: {},
      pending: {}
    }
    this.currentCycle = {
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
    this.cycles = []
    this.acceptJoinReq = false
    this.shouldStop = false
  }

  // TODO: add init function that reads from database into memory
  async init () {
    const cycles = await this.storage.listCycles()
    this.mainLogger.debug(`Loaded ${cycles.length} cycles from the database.`)
    this.cycles = cycles
    const nodes = await this.storage.listNodes()
    this.mainLogger.debug(`Loaded ${nodes.length} nodes from the database.`)
    this._addNodesToNodelist(nodes)
  }

  _resetNodelist () {
    this.nodes = {
      ordered: [],
      current: {},
      active: {},
      syncing: {},
      pending: {}
    }
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
    this.mainLogger.info('P2P data cleared from database.')
    this._resetState()
  }

  addJoinRequest (joinRequest) {
    if (!this.acceptJoinReq) return false
    const bestJoinRequests = this._getBestJoinRequests()
    bestJoinRequests.push(joinRequest)
    this._addPendingNode(joinRequest.nodeInfo)
    // TODO: return if actually added to best join requests
    return true
  }

  _addPendingNode (node) {
    this.nodes.pending[node.publicKey] = node
  }

  _addJoiningNodes (nodes) {
    for (const node of nodes) {
      this.currentCycle.joined.push(node.publicKey)
    }
  }

  _computeNodeId (publicKey, cycleMarker) {
    // TODO: Implement actual node ID process
    return publicKey
  }

  // TODO: Check if we are the node being added so we can add our ID to the properties table
  async _acceptNode (publicKey, cycleMarker) {
    let node
    try {
      node = this.nodes.pending[publicKey]
    } catch (e) {
      throw new Error('Node not found in pending.')
    }
    let nodeId = this._computeNodeId(publicKey, cycleMarker)
    node.id = nodeId
    delete node.publicKey
    this.nodes.ordered.push(node)
    this.nodes.current[node.id] = node
    delete this.nodes.pending[node.id]
    // TODO: Let _addNodeToNode handle this when status is param
    this.nodes.syncing[node.id] = node
    await this.addNode(node)
  }

  async _acceptNodes (publicKeys, cycleMarker) {
    const promises = []
    for (const publicKey of publicKeys) {
      promises.push(this._acceptNode(publicKey, cycleMarker))
    }
    await Promise.all(promises)
  }

  // TODO: Take status as a param after status is being stored in DB
  _addNodeToNodelist (node) {
    this.nodes.current[node.id] = node
  }

  _addNodesToNodelist (nodes) {
    for (const node of nodes) {
      this._addNodeToNodelist(node)
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

  /* TODO: add this change after status is being stored in DB
  // Should pass an array of objects containing { node, status }
  _addNodesToNodelist (nodesInfo) {
    for (const nodeInfo of nodesInfo) {
      this._addNodeToNodelist(nodeInfo.node, nodeInfo.status)
    }
  }
  */

  _computeCycleMarker (fields) {
    this.mainLogger.debug(`Computing cycle marker... Cycle marker fields: ${JSON.stringify(fields)}`)
    const cycleMarker = this.crypto.hash(fields)
    this.mainLogger.debug(`Created cycle marker: ${cycleMarker}`)
    return cycleMarker
  }

  _resetCurrentCycle () {
    this.currentCycle = {
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
    const accepted = this._acceptNodes(cycleInfo.joined)
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

  getCycles (amount) {
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
}

module.exports = P2PState
