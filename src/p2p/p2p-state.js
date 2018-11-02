const utils = require('../utils')

class P2PState {
  constructor (logger, crypto, storage) {
    this.mainLogger = logger.getLogger('main')
    this.crypto = crypto
    this.storage = storage
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
      returned: []
    }
    this.cycles = []
    this.joinRequests = []
  }

  // TODO: add init function that reads from database into memory

  addJoinRequest (nodeInfo) {
    // TODO: add actual join requests
    this.joinRequests.push(nodeInfo)
    this._addPendingNode(nodeInfo)
  }

  _addPendingNode (node) {
    this.nodes.pending.push(node)
    // TODO: For now we are automatically adding to join list, we shouldn't
    this.currentCycle.joined.push(node.publicKey)
  }

  _deriveNodeId (publicKey, cycleMarker) {
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
    let nodeId = this._deriveNodeId(publicKey, cycleMarker)
    node.id = nodeId
    delete node.publicKey
    this.nodes.ordered.push(node)
    this.nodes.current[node.id] = node
    // TODO: these should go to syncing and not active: this.nodes.syncing[node.id]= node
    this.nodes.active[node.id] = node
    this.storage.addNodes(node)
  }

  _acceptNodes (publicKeys, cycleMarker) {
    for (const publicKey of publicKeys) {
      this._acceptNode(publicKey, cycleMarker)
    }
  }

  _deriveCycleMarker (fields) {
    this.mainLogger.info('Creating new cycle marker...')
    this.mainLogger.debug(`Cycle marker fields: ${JSON.stringify(fields)}`)
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

  createCycle () {
    this.mainLogger.info('Creating new cycle...')
    const previous = this.getLastCycleMarker()
    const counter = this.getLastCycleCounter()
    const time = this.getCurrentCycleTime()
    const active = this.getActiveCount()
    const desired = this.getDesiredCount()
    const joined = this.getJoined()
    const removed = this.getRemoved()
    const lost = this.getLost()
    const returned = this.getReturned()

    const cmFields = {
      previous,
      counter,
      time,
      active,
      desired,
      joined,
      removed,
      lost,
      returned
    }

    const marker = this._deriveCycleMarker(cmFields)
    const cycle = {
      counter,
      marker,
      active,
      desired,
      joined,
      removed,
      lost,
      returned
    }
    this._resetCurrentCycle()
    this._acceptNodes(joined)
    this.cycles.push(cycle)
    this.storage.addCycles(cycle)
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
    let cycleTime = Math.floor(currTime / 120)
    return cycleTime
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

  getLastCycle () {
    if (!this.cycles.length) return null
    return this.cycles[this.cycles.length - 1]
  }

  getLastCycleCounter () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return 0
    return lastCycle.counter
  }

  getLastCycleMarker () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return '0'.repeat(64)
    return lastCycle.marker
  }
}

module.exports = P2PState
