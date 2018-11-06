const utils = require('../utils')

class P2PState {
  constructor (config, logger, storage, crypto) {
    this.mainLogger = logger.getLogger('main')
    this.crypto = crypto
    this.storage = storage
    this.cycleDuration = config.cycleDuration
    this.nodes = {
      ordered: [],
      current: {},
      active: {},
      syncing: {},
      pending: {}
    }
    this.currentCycle = {
      joined: [],
      removed: [],
      lost: [],
      returned: [],
      activated: [],
      certificate: {}
    }
    this.cycles = []
    this.acceptJoinReq = false
    this.joinRequests = []
  }

  // TODO: add init function that reads from database into memory

  addJoinRequest (nodeInfo) {
    // TODO: check if accepting join requests
    // if (!acceptJoinReq) return ''
    // TODO: add actual join requests
    this.joinRequests.push(nodeInfo)
    this._addPendingNode(nodeInfo)
  }

  _addPendingNode (node) {
    this.nodes.pending[node.publicKey] = node
    // TODO: For now we are automatically adding to join list, we shouldn't
    this.currentCycle.joined.push(node.publicKey)
  }

  _computeNodeId (publicKey, cycleMarker) {
    // TODO: Implement actual node ID process
    return publicKey
  }

  _acceptNode (publicKey, cycleMarker) {
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
    this.nodes.syncing[node.id]= node
    this.storage.addNodes(node)
  }

  _acceptNodes (publicKeys, cycleMarker) {
    for (const publicKey of publicKeys) {
      this._acceptNode(publicKey, cycleMarker)
    }
  }

  _computeCycleMarker (fields) {
    this.mainLogger.debug(`Computing cycle marker... Cycle marker fields: ${JSON.stringify(fields)}`)
    const cycleMarker = this.crypto.hash(fields)
    this.mainLogger.debug(`Created cycle marker: ${cycleMarker}`)
    return cycleMarker
  }

  _resetCurrentCycle () {
    this.currentCycle = {
      joined: [],
      removed: [],
      lost: [],
      returned: []
    }
  }

  // Kicks off the whole cycle and cycle marker creation system
  startCycles () {
    this.mainLogger.info('Starting first cycle...')
    this._startNewCycle()
  }

  _startNewCycle () {
    this.mainLogger.info(`Starting new cycle of duration ${this.cycleDuration}...`)
    const quarterCycle = Math.ceil(this.cycleDuration * 1000 / 4)
    this._startJoinPhase(quarterCycle)
  }

  _startJoinPhase (phaseLen) {
    this.mainLogger.debug('Starting join phase...')
    this.acceptJoinReq = true
    setTimeout(() => {
      this._endJoinPhase(phaseLen)
    }, phaseLen)
  }

  _endJoinPhase (phaseLen) {
    this.mainLogger.debug('Ending join phase...')
    this.acceptJoinReq = false
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

    this._resetCurrentCycle()
    this._acceptNodes(cycleInfo.joined)
    this.cycles.push(cycleInfo)
    try {
      await this.storage.addCycles(cycleInfo)
      this.mainLogger.info('Added cycle chain entry to database successfully!')
    } catch (e) {
      this.mainLogger.error(e)
    }
  }

  getCycleInfo (withCert = true) {
    const previous = this.getLastCycleMarker()
    const counter = this.getCycleCounter()
    const time = this.getCurrentCycleTime()
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
      time,
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

  getCurrentCycleTime () {
    let currTime = utils.getTime('s')
    let cycleTime = Math.floor(currTime / this.cycleDuration)
    return cycleTime
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

  getLastCycleMarker () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return '0'.repeat(64)
    return lastCycle.marker
  }

  getLastJoined () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return null
    return lastCycle.joined
  }
}

module.exports = P2PState
