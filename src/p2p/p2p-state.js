const EventEmitter = require('events')
const utils = require('../utils')
const Random = require('../random')

/**
 * @typedef {import('../shardus/index').Node} Node
 */

class P2PState extends EventEmitter {
  constructor (config, logger, storage, p2p, crypto) {
    super()
    this.mainLogger = logger.getLogger('main')
    this.p2p = p2p
    this.crypto = crypto
    this.storage = storage
    this.defaultCycleDuration = config.cycleDuration
    this.maxNodesPerCycle = config.maxNodesPerCycle
    this.maxSeedNodes = config.maxSeedNodes
    this.desiredNodes = config.minNodes
    this.nodeExpiryAge = config.nodeExpiryAge
    this.maxNodesToRotate = config.maxNodesToRotate
    this.maxPercentOfDelta = config.maxPercentOfDelta
    this.scaleReqsNeeded = config.scaleReqsNeeded
    this.maxScaleReqs = config.maxScaleReqs
    this.amountToScale = config.amountToScale
    this.minNodes = config.minNodes
    this.maxNodes = config.maxNodes
    this.seedNodeOffset = config.seedNodeOffset

    this.cycles = []
    this.certificates = []

    // Variables for regulating different phases cycles
    this.acceptChainUpdates = false
    this.acceptJoinRequests = true
    this.unfinalizedReady = false
    this.cyclesStarted = false

    this.shouldStop = false

    // Specifies valid statuses
    this.validStatuses = ['active', 'syncing']
    this.statusUpdateType = {
      'active': 'activated'
    }

    // Defines a clean nodelist that we will use for restoring the nodeslist to a clean state
    this.cleanNodelist = {
      ordered: [],
      addressOrdered: [],
      current: {},
      byIp: {},
      byPubKey: {}
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
        receivedCerts: false,
        toAccept: 0,
        scalingSeen: {},
        apopSeen: {},
        lostSeen: {
          up: {},
          down: {}
        },
        startingDesired: 0,
        scaling: false
      },
      updates: {
        bestJoinRequests: [],
        active: [],
        scaling: {
          up: [],
          down: []
        },
        apoptosis: [],
        lost: {
          up: [],
          down: []
        }
      },
      data: {
        start: null,
        duration: null,
        counter: null,
        previous: null,
        joined: [],
        removed: [],
        lost: [],
        refuted: [],
        apoptosized: [],
        returned: [],
        activated: [],
        certificate: {},
        expired: 0,
        desired: 0
      }
    }

    // Sets nodelist and current cycle to a copy of the clean nodelist and cycle objects
    this.nodes = utils.deepCopy(this.cleanNodelist)
    this.currentCycle = utils.deepCopy(this.cleanCycle)

    this.lostNodes = null
  }

  async init () {
    const cycles = await this.storage.listCycles()
    this.mainLogger.debug(`Loaded ${cycles.length} cycles from the database.`)
    this.cycles = cycles
    const nodes = await this.storage.listNodes()
    this.mainLogger.debug(`Loaded ${nodes.length} nodes from the database.`)
    this._addNodesToNodelist(nodes)
  }

  initLost (p2plostnodes) {
    this.lostNodes = p2plostnodes
  }

  _resetNodelist () {
    this.nodes = utils.deepCopy(this.cleanNodelist)
  }

  _resetCycles () {
    this.cycles.length = 0
    this.certificates.length = 0
  }

  // We leave out shouldStop in case we have recently stopped the cycles
  _resetControlVars () {
    this.acceptChainUpdates = false
    this.acceptJoinRequests = true
    this.unfinalizedReady = false
    this.cyclesStarted = false
  }

  _resetState () {
    this._resetCurrentCycle()
    this._resetNodelist()
    this._resetCycles()
    this._resetControlVars()
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
    return true
  }

  addNewJoinRequest (joinRequest) {
    if (!this.acceptChainUpdates) {
      this.mainLogger.debug('Join request not added: Not accepting chain updates right now.')
      return false
    }
    return this._addJoinRequest(joinRequest)
  }

  async addExtScalingRequest (scalingRequest) {
    if (!this.acceptChainUpdates) {
      this.mainLogger.debug('Join request not added: Not accepting chain updates right now.')
      return false
    }
    const added = await this._addScalingRequest(scalingRequest)
    return added
  }

  validateScalingRequest (scalingRequest) {
    // Check existence of fields
    if (!scalingRequest.node || !scalingRequest.timestamp || !scalingRequest.cycleCounter || !scalingRequest.scale || !scalingRequest.sign) {
      this.mainLogger.debug(`Invalid scaling request, missing fields. Request: ${JSON.stringify(scalingRequest)}`)
      return false
    }
    // Check if cycle counter matches
    if (scalingRequest.cycleCounter !== this.getCycleCounter()) {
      this.mainLogger.debug(`Invalid scaling request, not for this cycle. Request: ${JSON.stringify(scalingRequest)}`)
      return false
    }
    // Check if we are trying to scale either up or down
    if (scalingRequest.scale !== 'up' && scalingRequest.scale !== 'down') {
      this.mainLogger.debug(`Invalid scaling request, not a valid scaling type. Request: ${JSON.stringify(scalingRequest)}`)
      return false
    }
    // Try to get the node who supposedly signed this request
    let node
    try {
      node = this.getNode(scalingRequest.node)
    } catch (e) {
      this.mainLogger.debug(e)
      this.mainLogger.debug(`Invalid scaling request, not a known node. Request: ${JSON.stringify(scalingRequest)}`)
      return false
    }
    // Return false if fails validation for signature
    if (!this.crypto.verify(scalingRequest, node.publicKey)) {
      this.mainLogger.debug(`Invalid scaling request, signature is not valid. Request: ${JSON.stringify(scalingRequest)}`)
      return false
    }
    return true
  }

  async _checkScaling () {
    const metadata = this.currentCycle.metadata
    const scalingUpdates = this.currentCycle.updates.scaling

    // Keep a flag if we have changed our metadata.scaling at all
    let changed = false

    if (metadata.scaling === 'up') {
      this.mainLogger.debug('Already set to scale up this cycle. No need to scale.')
      return
    }

    // Check up first
    if (scalingUpdates.up.length >= this.scaleReqsNeeded) {
      metadata.scaling = 'up'
      changed = true
    }

    // If we haven't changed, check down
    if (!changed) {
      if (metadata.scaling === 'down') {
        this.mainLogger.debug('Already set to scale down for this cycle. No need to scale.')
        return
      }
      if (scalingUpdates.down.length >= this.scaleReqsNeeded) {
        metadata.scaling = 'down'
        changed = true
      } else {
        // Return if we don't change anything
        return
      }
    }
    // At this point, we have changed our scaling flag
    let newDesired
    switch (metadata.scaling) {
      case 'up':
        newDesired = metadata.startingDesired + this.amountToScale
        // If newDesired more than maxNodes, set newDesired to maxNodes
        if (newDesired > this.maxNodes) newDesired = this.maxNodes
        break
      case 'down':
        newDesired = metadata.startingDesired - this.amountToScale
        // If newDesired less than minNodes, set newDesired to minNodes
        if (newDesired < this.minNodes) newDesired = this.minNodes
        break
      default:
        this.mainLogger.error(new Error(`Invalid scaling flag after changing flag. Flag: ${metadata.scaling}`))
        return
    }
    // Set our current cycle's desired to the new desired count
    this.currentCycle.data.desired = newDesired

    // If scaling flag changed, trigger computeCycleMarker
    this._createCycleMarker()
  }

  async _addToScalingRequests (scalingRequest) {
    const scalingUpdates = this.currentCycle.updates.scaling
    switch (scalingRequest.scale) {
      case 'up':
        // Check if we have exceeded the limit of scaling requests
        if (scalingUpdates.up.length >= this.maxScaleReqs) {
          this.mainLogger.debug('Max scale up requests already exceeded. Cannot add request.')
          return false
        }
        scalingUpdates.up.push(scalingRequest)
        await this._checkScaling()
        return true
      case 'down':
        // Check if we are already voting scale up, don't add in that case
        if (this.currentCycle.metadata.scaling === 'up') {
          this.mainLogger.debug('Already scaling up this cycle. Cannot add scaling down request.')
          return false
        }
        // Check if we have exceeded the limit of scaling requests
        if (scalingUpdates.down.length >= this.maxScaleReqs) {
          this.mainLogger.debug('Max scale down requests already exceeded. Cannot add request.')
          return false
        }
        scalingUpdates.down.push(scalingRequest)
        await this._checkScaling()
        return true
      default:
        this.mainLogger.debug(`Invalid scaling type in _addToScalingRequests(). Request: ${JSON.stringify(scalingRequest)}`)
        return false
    }
  }

  async _addScalingRequest (scalingRequest) {
    // Check existence of node
    if (!scalingRequest.node) return
    // Check scaling seen for this node
    if (this.currentCycle.metadata.scalingSeen[scalingRequest.node]) return

    // Set scaling seen for this node
    this.currentCycle.metadata.scalingSeen[scalingRequest.node] = true

    const valid = this.validateScalingRequest(scalingRequest)
    if (!valid) return false

    // If we pass validation, add to current cycle
    const added = await this._addToScalingRequests(scalingRequest)
    return added
  }

  addGossipedJoinRequest (joinRequest) {
    return this._addJoinRequest(joinRequest)
  }

  _addJoiningNodes () {
    const joining = this._getBestNodes()
    this.mainLogger.debug(`Joining nodes: ${JSON.stringify(joining)}`)
    const joined = this.currentCycle.data.joined
    this.mainLogger.debug(`Current joined: ${JSON.stringify(joined)}`)
    joined.length = 0
    for (const node of joining) {
      joined.push(node.publicKey)
    }
    this.mainLogger.debug(`Joined after update: ${JSON.stringify(joined)}`)
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
      publicKey = null
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
    if (!this.cyclesStarted) return false
    const { bestJoinRequests, active, scaling, apoptosis, lost } = updates
    for (const joinRequest of bestJoinRequests) {
      this._addJoinRequest(joinRequest)
    }
    for (const activeRequest of active) {
      this.addStatusUpdate(activeRequest)
    }
    for (const scaleReq of scaling.up) {
      await this._addScalingRequest(scaleReq)
    }
    for (const scaleReq of scaling.down) {
      await this._addScalingRequest(scaleReq)
    }
    for (const apopMsg of apoptosis) {
      this.addApoptosisMessage(apopMsg)
    }
    for (const lostDownMsg of lost.down) {
      this.addLostMessage(lostDownMsg, true)
    }
    for (const lostUpMsg of lost.up) {
      this.addLostMessage(lostUpMsg, true)
    }
    try {
      const cMarkerBefore = this.getCurrentCertificate().marker
      this._createCycleMarker(false)
      const cMarkerAfter = this.getCurrentCertificate().marker
      if (cMarkerBefore === cMarkerAfter) return false
    } catch (err) {
      console.log(err)
      return false
    }
    return true
  }

  addApoptosisMessage (msg) {
    if (!this.cyclesStarted) return false
    const { nodeId, type, cycleCounter, timestamp, sign } = msg

    // Validate that all required fields exist
    if (!nodeId) {
      this.mainLogger.debug('Node ID of node was not provided with apoptosis message.')
      return false
    }
    if (!sign) {
      this.mainLogger.debug('Apoptosis message was not signed.')
      return false
    }
    if (!cycleCounter) {
      this.mainLogger.debug('No cycleCounter given with apoptosis message.')
      return false
    }
    if (!timestamp) {
      this.mainLogger.debug('No timestamp given with apoptosis message.')
      return false
    }
    if (!type) {
      this.mainLogger.debug('No type given with apoptosis message.')
      return false
    }

    if (type !== 'apoptosis') {
      this.mainLogger.debug('Message is not of type `apoptosis`. Message cannot be added.')
      return false
    }

    // Check if message already exists
    if (this.currentCycle.metadata.apopSeen[nodeId]) {
      this.mainLogger.debug('Apoptosis message already seen for this node. Cannot add message.')
      return false
    }

    // Check if cycle counter if for this cycle or one before it
    if (cycleCounter !== this.getCycleCounter() && cycleCounter !== this.getCycleCounter() - 1) {
      // Invalid cycle counter
      this.mainLogger.debug('Invalid cycleCounter for apoptosis message. Unable to add message.')
      return false
    }

    // Check if node is in nodelist
    let node
    try {
      node = this.getNode(nodeId)
    } catch (e) {
      this.mainLogger.debug('Node not found in nodelist. Apoptosis message invalid.')
      return false
    }

    // Check if signature is valid and signed by expected node
    const valid = this.crypto.verify(msg, node.publicKey)
    if (!valid) {
      this.mainLogger.debug('Apoptosis message signature invalid. Unable to add message.')
      return false
    }

    // Add to cycle
    this.currentCycle.metadata.apopSeen[nodeId] = true
    this.currentCycle.updates.apoptosis.push(msg)
    utils.insertSorted(this.currentCycle.data.apoptosized, nodeId)
    return true
  }

  addExtApoptosisMessage (msg) {
    if (!this.acceptChainUpdates) {
      this.mainLogger.debug('Apoptosis message not added: Not accepting chain updates right now.')
      return false
    }
    return this.addApoptosisMessage(msg)
  }

  addLostMessage (msg, validate = false) {
    if (msg.lostMessage) { // Is DownMessage
      // Validate, if requested
      if (validate) {
        const [validated, reason] = this.lostNodes.validateDownMessage(msg)
        if (!validated) {
          this.mainLogger.debug(`Lost message not added: Invalid DownMessage: ${reason}: ${JSON.stringify(msg)}.`)
          return false
        }
      }

      const nodeId = msg.lostMessage.target

      // If this node has an UpMessage, ignore
      if (this.currentCycle.metadata.lostSeen.up[nodeId]) {
        return false
      }

      // If this node already has a DownMessage, ignore
      if (this.currentCycle.metadata.lostSeen.down[nodeId]) {
        return false
      }

      // Add to cycle's lost nodes
      this.currentCycle.metadata.lostSeen.down[nodeId] = true
      this.currentCycle.updates.lost.down.push(msg)
      utils.insertSorted(this.currentCycle.data.lost, nodeId)
    } else if (msg.downMessage) { // Is UpMessage
      // Validate, if requested
      if (validate) {
        const [validated, reason] = this.lostNodes.validateUpMessage(msg)
        if (!validated) {
          this.mainLogger.debug(`Lost message not added: Invalid UpMessage: ${reason}: ${JSON.stringify(msg)}.`)
          return false
        }
      }

      const nodeId = msg.downMessage.lostMessage.target

      // If this node already has an UpMessage, ignore
      if (this.currentCycle.metadata.lostSeen.up[nodeId]) {
        return false
      }

      // Remove this node from cycles lost nodes, if he was put there
      if (this.currentCycle.metadata.lostSeen.down[nodeId]) {
        delete this.currentCycle.metadata.lostSeen.down[nodeId]
        const updatesIdx = this.currentCycle.updates.lost.down.findIndex(msg => msg.lostMessage.target === nodeId)
        if (updatesIdx > 0) this.currentCycle.updates.lost.down.splice(updatesIdx, 1)
        const dataIdx = this.currentCycle.data.lost.findIndex(id => id === nodeId)
        if (dataIdx > 0) this.currentCycle.updates.lost.down.splice(dataIdx, 1)
      }

      // Add to cycle's refuted nodes
      this.currentCycle.metadata.lostSeen.up[nodeId] = true
      this.currentCycle.updates.lost.up.push(msg)
      utils.insertSorted(this.currentCycle.data.refuted, nodeId)
    }
    return true
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
      this.mainLogger.error('_setNodeStatus: ' + e.name + ': ' + e.message + ' at ' + e.stack)
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

  async _setNodesActiveTimestamp (nodeIds, timestamp) {
    for (const id of nodeIds) {
      const node = this.getNode(id)
      node.activeTimestamp = timestamp
      await this.storage.updateNodes({ id }, { activeTimestamp: timestamp })
    }
  }

  // For use for internal updates to status for this node
  async directStatusUpdate (nodeId, status, updateDb = true) {
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

  async _acceptNode (node, cycleMarker) {
    node.curvePublicKey = this.crypto.convertPublicKeyToCurve(node.publicKey)
    let nodeId = this.computeNodeId(node.publicKey, cycleMarker)
    node.id = nodeId
    node.cycleJoined = cycleMarker
    await this._updateNodeStatus(node, 'syncing', false)
    await this.addNode(node)
    this.mainLogger.debug(`Nodelist after adding this node: ${JSON.stringify(this.nodes.current)}`)
    this.mainLogger.debug(`Ordered nodelist after adding this node: ${JSON.stringify(this.nodes.ordered)}`)
  }

  async _acceptNodes (nodes, cycleMarker) {
    const promises = []
    for (const node of nodes) {
      promises.push(this._acceptNode(node, cycleMarker))
    }
    await Promise.all(promises)
  }

  _getNodeOrderedIndex (node) {
    const ordered = this.nodes.ordered
    // First check the first index of the ordered list, as this is most likely when removing nodes
    if (ordered[0].id === node.id) return 0
    // Then perform a b-search for the rest of the search
    const comparator = (a, b) => {
      if (a.joinRequestTimestamp === b.joinRequestTimestamp) {
        if (a.id === b.id) return 0
        return this.crypto.isGreaterHash(a.id, b.id) ? 1 : -1
      }
      return a.joinRequestTimestamp > b.joinRequestTimestamp ? 1 : -1
    }
    return utils.binarySearch(ordered, node, comparator)
  }

  /**
   * _getNodeAddressOrderedIndex
   * @param {Node} node
   * @returns {number|boolean} tricky because binary search can also return false
   */
  _getNodeAddressOrderedIndex (node) {
    const ordered = this.nodes.addressOrdered
    // First check the first index of the ordered list, as this is most likely when removing nodes
    if (ordered[0].id === node.id) return 0
    // Then perform a b-search for the rest of the search
    const comparator = (a, b) => {
      return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
    }
    return utils.binarySearch(ordered, node, comparator)
  }

  _getExpiredCountInternal () {
    // This line allows for a configuration in which nodes never expire
    if (this.nodeExpiryAge === 0) return 0
    const nodes = this.nodes.ordered
    const expiredTime = utils.getTime('s') - this.nodeExpiryAge
    const isExpired = (node) => {
      if (node.joinRequestTimestamp > expiredTime) {
        return false
      }
      return true
    }
    let count = 0
    for (const node of nodes) {
      if (!isExpired(node)) {
        break
      }
      count += 1
    }
    return count
  }

  // Checks if we are at max nodes already
  getNodesNeeded () {
    const desired = this.getDesiredCount()
    const active = this.getActiveCount()
    return desired - active
  }

  _setJoinAcceptance () {
    const needed = this.getNodesNeeded()
    if (needed < 0) {
      this.acceptJoinRequests = false
      return
    }
    const expired = this.getExpiredCount()
    if (needed === 0 && expired === 0) {
      this.acceptJoinRequests = false
      return
    }
    this.acceptJoinRequests = true
  }

  _getOpenSlots () {
    let toAccept = 0
    const needed = this.getNodesNeeded()
    // If we're over max nodes, we don't want to open any slots
    if (needed < 0) {
      return toAccept
    }
    // If we're at max nodes but not over, we want to check if there are any expired nodes to rotate out
    if (needed === 0) {
      const expired = this.getExpiredCount()
      if (expired > 0) toAccept = expired
      if (toAccept > this.maxNodesToRotate) toAccept = this.maxNodesToRotate
    } else {
      // Otherwise we open up as many slots as we can, th lesser between
      // the difference between desired and active, or the max nodes we can allow per cycle
      const desired = this.getDesiredCount()
      const active = this.getActiveCount()
      const currentOpen = desired - active
      toAccept = currentOpen
      if (toAccept > this.maxNodesPerCycle) toAccept = this.maxNodesPerCycle
      // Check if the percentage of nodes to add per cycle are smaller than the current toAccept value
      const calculatedPercent = Math.floor((this.maxPercentOfDelta / 100) * currentOpen)
      const percentOfNodes = calculatedPercent > 0 ? calculatedPercent : 1
      if (toAccept > percentOfNodes) toAccept = percentOfNodes
    }
    return toAccept
  }

  _markNodesForRemoval (n) {
    const nodes = this.nodes.ordered.slice(0, n)
    const removed = this.currentCycle.data.removed
    removed.length = 0
    for (const node of nodes) {
      removed.push(node.id)
    }
  }

  _removeExcessNodes () {
    const expired = this.getExpiredCount()
    if (expired === 0) return
    const desired = this.getDesiredCount()
    const active = this.getActiveCount()
    const diff = active - desired
    if (diff <= 0) return
    let toRemove = diff
    if (toRemove > this.maxNodesToRotate) toRemove = this.maxNodesToRotate
    if (toRemove > expired) toRemove = expired
    this._markNodesForRemoval(toRemove)
  }

  _removeNodeFromNodelist (node) {
    if (node.id === this.p2p.id) {
      this.mainLogger.info(`We have been marked for removal from the network. Commencing restart process. Current cycle marker: ${this.getCurrentCycleMarker()}`)
      this.emit('removed')
    }
    delete this.nodes[node.status][node.id]
    delete this.nodes.current[node.id]
    delete this.nodes.byPubKey[node.publicKey]
    // Get internalHost by concatenating the internal IP and port
    const internalHost = `${node.internalIp}:${node.internalPort}`
    delete this.nodes.byIp[internalHost]
    const index = this._getNodeOrderedIndex(node)
    this.nodes.ordered.splice(index, 1)

    const index2 = this._getNodeAddressOrderedIndex(node)
    this.nodes.addressOrdered.splice(index2, 1)
  }

  /**
   * @param {import("../shardus").Node} node
   */
  getOrderedSyncingNeighbors (node) {
    let index = this._getNodeAddressOrderedIndex(node)
    let results = []

    if (index === false) {
      console.log(`getOrderedSyncingNeighbors failed to find ${utils.stringifyReduce(node.id)}`)
      return results
    }
    // cycleShardData.activeNodes.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })
    // console.log(`getOrderedSyncingNeighbors find: ${utils.stringifyReduce(node.id)} index: ${index} all:  ${utils.stringifyReduce(this.nodes.addressOrdered.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)

    // @ts-ignore
    let leftIndex = index - 1
    // @ts-ignore
    let rightIndex = index + 1

    if (leftIndex < 0) {
      leftIndex = this.nodes.addressOrdered.length - 1
    }
    if (rightIndex >= this.nodes.addressOrdered.length) {
      rightIndex = 0
    }

    if (leftIndex !== index) {
      let node = this.nodes.addressOrdered[leftIndex]
      while (node.status === 'syncing') {
        results.push(node)
        leftIndex--
        if (leftIndex < 0) {
          leftIndex = this.nodes.addressOrdered.length - 1
        }
        if (leftIndex === index) {
          break
        }
        node = this.nodes.addressOrdered[leftIndex]
      }
    }
    if (rightIndex !== index) {
      let node = this.nodes.addressOrdered[rightIndex]
      while (node.status === 'syncing') {
        results.push(node)
        rightIndex++
        if (rightIndex >= this.nodes.addressOrdered.length) {
          rightIndex = 0
        }
        if (rightIndex === index) {
          break
        }
        node = this.nodes.addressOrdered[rightIndex]
      }
    }

    // if (results.length > 0) {
    //   console.log(`getOrderedSyncingNeighbors find: our node: ${utils.stringifyReduce(node.id)} syncing neighbors:  ${utils.stringifyReduce(results.map(node => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
    // }

    // todo what about two nodes syncing next to each other.  should we keep expanding to catch runs of syncing nodes.
    return results
  }

  _removeNodesFromNodelist (nodes) {
    for (const node of nodes) {
      this._removeNodeFromNodelist(node)
    }
  }

  async removeNode (node) {
    await this.storage.deleteNodes(node)
    this._removeNodeFromNodelist(node)
  }

  async removeNodes (nodes) {
    if (!nodes.length) return
    await this.storage.deleteNodes(nodes)
    this._removeNodesFromNodelist(nodes)
  }

  _addNodeToNodelist (node) {
    const status = node.status
    if (!this.validStatuses.includes(status)) throw new Error('Invalid node status.')
    this.nodes[status][node.id] = node
    this.nodes.current[node.id] = node
    this.nodes.byPubKey[node.publicKey] = node
    // Get internalHost by concatenating the internal IP and port
    const internalHost = `${node.internalIp}:${node.internalPort}`
    this.nodes.byIp[internalHost] = node
    // Insert sorted into ordered list
    utils.insertSorted(this.nodes.ordered, node, (a, b) => {
      if (a.joinRequestTimestamp === b.joinRequestTimestamp) {
        return this.crypto.isGreaterHash(a.id, b.id) ? 1 : -1
      }
      return a.joinRequestTimestamp > b.joinRequestTimestamp ? 1 : -1
    })

    utils.insertSorted(this.nodes.addressOrdered, node, (a, b) => {
      return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
    })
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
    this.cyclesStarted = false
  }

  _startNewCycle () {
    if (this.shouldStop) return
    this._resetCurrentCycle()
    const lastCycleDuration = this.getLastCycleDuration()
    const lastCycleStart = this.getLastCycleStart()
    const currentTime = utils.getTime('s')
    this.currentCycle.data.counter = this.getLastCycleCounter() + 1
    this.currentCycle.data.previous = this.getCurrentCycleMarker()
    this.currentCycle.data.duration = lastCycleDuration
    this.currentCycle.data.start = lastCycleStart ? lastCycleStart + lastCycleDuration : utils.getTime('s')
    this.currentCycle.data.expired = this._getExpiredCountInternal()
    this.currentCycle.data.desired = this.desiredNodes
    this.currentCycle.metadata.startingDesired = this.desiredNodes
    this._setJoinAcceptance()
    this.currentCycle.metadata.toAccept = this._getOpenSlots()
    this.mainLogger.info(`Starting new cycle of duration ${this.getCurrentCycleDuration()}...`)
    this.mainLogger.debug(`Last cycle start time: ${lastCycleStart}`)
    this.mainLogger.debug(`Last cycle duration: ${lastCycleDuration}`)
    this.mainLogger.debug(`Current time: ${currentTime}`)
    const quarterCycle = Math.ceil(this.getCurrentCycleDuration() * 1000 / 4)
    this._startUpdatePhase(this.currentCycle.data.start * 1000, quarterCycle)
  }

  // Q1
  _startUpdatePhase (startTime, phaseLen) {
    if (this.shouldStop) return
    this.mainLogger.debug(`P2P State: Started C${this.getCycleCounter()} Q1`)
    this.mainLogger.debug('Starting update phase...')
    this.acceptChainUpdates = true
    const endTime = startTime + phaseLen

    const lastCycle = this.getLastCycle()
    let time = utils.getTime('s')
    console.log('Q1 ' + time)
    this.emit('cycle_q1_start', lastCycle, time)

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

    const toAccept = this.currentCycle.metadata.toAccept

    // If length of array is bigger, do this precheck
    const competing = toAccept > 0 && bestRequests.length >= toAccept
    if (competing) {
      const lastIndex = bestRequests.length - 1
      const lowest = bestRequests[lastIndex]

      // TODO: call into application
      // ----- application should decide the ranking order of the join requests
      // ----- if hook doesn't exist, then we go with default order based on selection number
      // ----- hook signature = (currentList, newJoinRequest, numDesired) returns [newOrder, added]
      // ----- should create preconfigured hooks for adding POW, allowing join based on netadmin sig, etc.

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
      this.mainLogger.debug(`Removing the following node from this cycle's join requests: ${JSON.stringify(removedNode)}`)
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

  // Q2
  _endUpdatePhase (startTime, phaseLen) {
    if (this.shouldStop) return
    this.mainLogger.debug(`P2P State: Started C${this.getCycleCounter()} Q2`)
    this.mainLogger.debug('Ending update phase...')
    this.acceptChainUpdates = false
    const endTime = startTime + phaseLen

    const lastCycle = this.getLastCycle()
    let time = utils.getTime('s')
    console.log('Q2 ' + time)
    this.emit('cycle_q2_start', lastCycle, time)

    utils.setAlarm(() => {
      this._startCycleSync(endTime, phaseLen)
    }, endTime)
  }

  // Q3
  async _startCycleSync (startTime, phaseLen) {
    if (this.shouldStop) return
    this.mainLogger.debug(`P2P State: Started C${this.getCycleCounter()} Q3`)
    this.mainLogger.debug('Starting cycle sync phase...')
    this._createCycleMarker()
    const endTime = startTime + phaseLen

    const lastCycle = this.getLastCycle()
    let time = utils.getTime('s')
    console.log('Q3 ' + time)
    this.emit('cycle_q3_start', lastCycle, time)

    utils.setAlarm(() => {
      this._finalizeCycle(endTime, phaseLen)
    }, endTime)
  }

  // Q4
  async _finalizeCycle (startTime, phaseLen) {
    if (this.shouldStop) return
    this.mainLogger.debug(`P2P State: Started C${this.getCycleCounter()} Q4`)
    this.mainLogger.debug('Starting cycle finalization phase...')
    const endTime = startTime + phaseLen

    const lastCycle = this.getLastCycle()
    let time = utils.getTime('s')
    console.log('Q4 ' + time)
    this.emit('cycle_q4_start', lastCycle, time)

    utils.setAlarm(async () => {
      if (this.shouldStop) return
      await this._createCycle()
      this.unfinalizedReady = false
      this._startNewCycle()
    }, endTime)
    if (this.getActiveNodes(this.p2p.id).length > 0) {
      await this.p2p.requestUpdatesFromRandom()
    }
    this.unfinalizedReady = true
  }

  _createCycleMarker (gossip = true) {
    this.mainLogger.info('Creating new cycle marker...')
    this._addJoiningNodes()
    this._removeExcessNodes()
    this.mainLogger.debug('Getting cycle info to create cycle marker...')
    const cycleInfo = this.getCycleInfo(false)
    this.mainLogger.debug('Computing cycle marker before creating certificate...')
    const cycleMarker = this._computeCycleMarker(cycleInfo)
    this.mainLogger.debug('Creating new certificate based on the new computed cycle marker...')
    const certificate = this._createCertificate(cycleMarker)
    if (!this.cycles.length) return this.addCertificate({ marker: cycleMarker, signer: '0'.repeat(64) })
    const [added] = this.addCertificate(certificate)
    if (!added) return
    if (!gossip) return
    this.p2p.sendGossipIn('certificate', certificate)
  }

  async addUnfinalizedAndStart (cycle) {
    if (!cycle) {
      this.mainLogger.info('Unable to add unfinalized cycle. Cycle not given.')
      return false
    }
    const { data: { start, duration } } = cycle
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

  async addCycle (cycle, certificate = null, updateDb = true) {
    if (certificate) {
      this.certificates.push(certificate)
      cycle.certificate = certificate
    }
    if (updateDb) await this.storage.addCycles(cycle)
    delete cycle.certificate
    this.cycles.push(cycle)
    this.emit('newCycle', this.cycles)
  }

  async addCycles (cycles, certificates = null, updateDb = true) {
    if (certificates.length) {
      for (let i = 0; i < cycles.length; i++) {
        const certificate = certificates[i]
        this.certificates.push(certificate)
        cycles[i].certificate = certificate
      }
    }
    if (updateDb) await this.storage.addCycles(cycles)
    for (let i = 0; i < cycles.length; i++) {
      delete cycles[i].certificate
      this.cycles.push(cycles[i])
    }
    this.mainLogger.debug(`All cycles after adding given cycles: ${JSON.stringify(this.cycles)}`)
  }

  async _createCycle () {
    this.mainLogger.info('Creating new cycle chain entry...')
    const cycleInfo = this.getCycleInfo()
    this.mainLogger.debug(`Cycle info for new cycle: ${JSON.stringify(cycleInfo)}`)
    cycleInfo.marker = this.getCurrentCertificate().marker

    const bestNodes = this._getBestNodes()
    const accepted = this._acceptNodes(bestNodes, cycleInfo.marker)

    this.mainLogger.debug(`Nodes to be activated this cycle: ${JSON.stringify(cycleInfo.activated)}`)
    const activated = this._setNodesToStatus(cycleInfo.activated, 'active')
    this._setNodesActiveTimestamp(cycleInfo.activated, cycleInfo.start)

    // Get certificate from cycleInfo and then remove it from the object
    const certificate = cycleInfo.certificate
    delete cycleInfo.certificate
    const cycleAdded = this.addCycle(cycleInfo, certificate)

    const removedNodes = this._getRemovedNodes()
    const removed = this.removeNodes(removedNodes)

    const apoptosizedNodes = this._getApoptosizedNodes()
    const apoptosized = this.removeNodes(apoptosizedNodes)

    const lostNodes = this._getLostNodes()
    const lost = this.removeNodes(lostNodes)

    const promises = [accepted, activated, removed, apoptosized, lost, cycleAdded]
    try {
      await Promise.all(promises)
      this.mainLogger.info('Added cycle chain entry to database successfully!')
    } catch (e) {
      this.mainLogger.error('_createCycle: ' + e.name + ': ' + e.message + ' at ' + e.stack)
    }
    this.desiredNodes = this.currentCycle.data.desired
  }

  getCycleInfo (withCert = true) {
    const previous = this.getPreviousCycleMarker()
    const counter = this.getCycleCounter()
    const start = this.getCurrentCycleStart()
    const duration = this.getCurrentCycleDuration()
    const active = this.getActiveCount()
    const desired = this.getNextDesiredCount()
    const joined = this.getJoined()
    const removed = this.getRemoved()
    const lost = this.getLost()
    const refuted = this.getRefuted()
    const apoptosized = this.getApoptosized()
    const returned = this.getReturned()
    const activated = this.getActivated()
    const expired = this.getExpiredCount()

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
      refuted,
      apoptosized,
      returned,
      activated,
      expired
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

    // If the cycle marker is different than what we have
    if (certificate.marker !== this.getCurrentCertificate().marker) {
      this.mainLogger.debug('The cycle marker from this certificate is different than the one we currently have...')
      // If its from the network, don't add it
      if (fromNetwork) return [false, 'diff_cm']
      // Otherwise, its ours and we should add it
      const certDist = utils.XOR(certificate.marker, certificate.signer)
      addCert(certificate, certDist)
      return [true]
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
    if (end > this.cycles.length + 1) this.mainLogger.error('Invalid end cycle counter.')
    return this.cycles.slice(start, end + 1)
  }

  getCertificates (start = 0, end = this.certificates.length) {
    if (start < 0) throw new Error('Invalid start cycle counter.')
    if (end > this.cycles.length + 1) this.mainLogger.error('Invalid end cycle counter.')
    return this.certificates.slice(start, end + 1)
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
    return this.desiredNodes
  }

  getNextDesiredCount () {
    return this.currentCycle.data.desired
  }

  getExpiredCount () {
    return this.currentCycle.data.expired
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

  getApoptosized () {
    return this.currentCycle.data.apoptosized
  }

  getLost () {
    return this.currentCycle.data.lost
  }

  getRefuted () {
    return this.currentCycle.data.refuted
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

  getCycleByTimestamp (timestamp) {
    let secondsTs = Math.floor(timestamp * 0.001)
    // search from end, to improve normal case perf
    for (let i = this.cycles.length - 1; i >= 0; i--) {
      let cycle = this.cycles[i]
      if (cycle.start <= secondsTs && cycle.start + cycle.duration > secondsTs) {
        return cycle
      }
    }
    return null
  }

  getCycleByCounter (counter) {
    for (let i = this.cycles.length - 1; i >= 0; i--) {
      let cycle = this.cycles[i]
      if (cycle.counter === counter) {
        return cycle
      }
    }
    return null
  }

  getCycleCounter () {
    const counter = this.currentCycle.data.counter
    if (counter === undefined || counter === null) return null
    return this.currentCycle.data.counter
  }

  getLastCycleStart () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return null
    return lastCycle.start
  }

  getLastCycleCounter () {
    const lastCycle = this.getLastCycle()
    if (!lastCycle) return -1
    return lastCycle.counter
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

  getPreviousCycleMarker () {
    return this.currentCycle.data.previous || '0'.repeat(64)
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

  getNodeByPubKey (publicKey) {
    const byPubKey = this.nodes.byPubKey
    const node = byPubKey[publicKey]
    if (!node) {
      this.mainLogger.debug(`Node not found for given public key: ${publicKey}...`)
      return null
    }
    return node
  }

  _getSubsetOfNodelist (nodes, self = null) {
    if (!self) return Object.values(nodes)
    // Check if self in node list
    if (!nodes[self]) {
      this.mainLogger.warn(`Invalid node ID in 'self' field. Given ID: ${self}`)
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

  getNodesOrdered () {
    return this.nodes.ordered
  }

  _getRemovedNodes () {
    const nodes = []
    const removedIds = this.getRemoved()
    for (const id of removedIds) {
      const node = this.getNode(id)
      nodes.push(node)
    }
    return nodes
  }

  _getApoptosizedNodes () {
    const nodes = []
    const apoppedIds = this.getApoptosized()
    for (const id of apoppedIds) {
      const node = this.getNode(id)
      nodes.push(node)
    }
    return nodes
  }

  _getLostNodes () {
    const nodes = []
    const lostIds = this.getLost()
    for (const id of lostIds) {
      const node = this.getNode(id)
      nodes.push(node)
    }
    return nodes
  }

  _getRefutedNodes () {
    const nodes = []
    const refutedIds = this.getRefuted()
    for (const id of refutedIds) {
      const node = this.getNode(id)
      nodes.push(node)
    }
    return nodes
  }

  getSeedNodes (forSeedList = true) {
    // A helper function we use to produce a seed node list of the expected format
    const produceSeedList = (nodes) => {
      // We use this flag to get back the raw nodes instead of the node objects for the seed list format
      if (!forSeedList) return nodes
      const seedNodes = nodes.map((node) => { return { ip: node.externalIp, port: node.externalPort } })
      return seedNodes
    }
    // Make a deep copy of the nodelist ordered by join timestamp
    const orderedNodes = this.getNodesOrdered()
    // Remove nodes that are not active from our list
    const filteredNodes = []
    for (let i = 0; i < orderedNodes.length; i++) {
      const node = orderedNodes[i]
      if (node.status === 'active') {
        filteredNodes.push(node)
      }
    }
    // Reverse array
    filteredNodes.reverse()
    // If less than minNodes - seedNodeOffset, just return the whole list
    if (filteredNodes.length < this.minNodes - this.seedNodeOffset) return produceSeedList(filteredNodes)
    // If we make it here, we more than minNodes - seedNodeOffset, remove the last 4 nodes
    filteredNodes.splice(filteredNodes.length - this.seedNodeOffset, this.seedNodeOffset)
    // If nodes left over are less than or = maxSeedNodes, return all nodes
    if (filteredNodes.length <= this.maxSeedNodes) return produceSeedList(filteredNodes)
    // Remove excess nodes
    const toRemove = filteredNodes.length - this.maxSeedNodes
    filteredNodes.splice(filteredNodes.length - toRemove, toRemove)
    // Return reverse-ordered nodes
    return produceSeedList(filteredNodes)
  }

  getRandomActiveNode () {
    const nodes = this.getActiveNodes(this.p2p.id)
    const random = Random()
    // @ts-ignore todo test that it is really ok to ignore this.
    const randIndex = random.randomInt(0, nodes.length - 1)
    return nodes[randIndex]
  }

  // getRandomSeedNodes (seed) {
  //   if (!seed) {
  //     return [null, 'no_seed']
  //   }

  //   const orderedNodes = utils.deepCopy(this.getNodesOrdered())
  //   for (let i = 0; i < orderedNodes.length; i++) {
  //     const node = orderedNodes[i]
  //     if (node.status !== 'active') {
  //       orderedNodes.splice(i, 1)
  //     }
  //   }
  //   let chosenNodes
  //   // If the number of active nodes is less than or equal to the max seeds nodes we want, just return the entire list
  //   if (orderedNodes.length <= this.maxSeedNodes) {
  //     chosenNodes = orderedNodes
  //   } else { // Otherwise we seed RNG and generate numbers to select random nodes until we have 10
  //     chosenNodes = []
  //     const random = Random(seed)
  //     while (chosenNodes.length < 10) {
  //       const randIndex = random.randomInt(0, orderedNodes.length - 1)
  //       const randomNode = orderedNodes[randIndex]
  //       chosenNodes.push(randomNode)
  //       orderedNodes.splice(randIndex, 1)
  //     }
  //   }
  //   // Remove all properties from nodes besides external IP and port
  //   const seedNodes = chosenNodes.map((node) => { return { ip: node.externalIp, port: node.externalPort } })
  //   return [seedNodes]
  // }
}

module.exports = P2PState
