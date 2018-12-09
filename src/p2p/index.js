const util = require('util')
const utils = require('../utils')
const http = require('../http')
const P2PState = require('./p2p-state')
const routes = require('./routes')

class P2P {
  constructor (config, logger, storage, crypto, network) {
    this.logger = logger
    this.mainLogger = logger.getLogger('main')
    this.storage = storage
    this.crypto = crypto
    this.network = network
    this.ipInfo = config.ipInfo
    this.id = null
    this.ipServer = config.ipServer
    this.timeServer = config.timeServer
    this.seedList = config.seedList
    this.syncLimit = config.syncLimit
    this.maxRejoinTime = config.maxRejoinTime
    this.difficulty = config.difficulty
    this.queryDelay = config.queryDelay
    this.netadmin = config.netadmin || 'default'
    this.seedNodes = null
    this.gossipHandlers = {}
    this.gossipRecipients = config.gossipRecipients

    this.state = new P2PState(config, this.logger, this.storage, this, this.crypto)
  }

  async init () {
    // Initialize our p2p state
    await this.state.init()

    // Make sure we know our external IP
    await this._ensureIpKnown()

    // Load ID from database
    const id = await this.storage.getProperty('id')
    if (id) this._setNodeId(id, false)

    // Set up the network after we are sure we have our current IP info
    await this.network.setup(this.getIpInfo())
    this._registerRoutes()
  }

  _registerRoutes () {
    routes.register(this)
  }

  _verifyExternalInfo (ipInfo) {
    if (!ipInfo.externalIp) {
      return false
    }
    if (!ipInfo.externalPort) {
      throw Error('Fatal: No external port specified, unable to start server.')
    }
    return true
  }

  _verifyInternalInfo (ipInfo) {
    if (!ipInfo.internalIp) {
      return false
    }
    if (!ipInfo.internalPort) {
      throw Error('Fatal: No internal port specified, unable to start server.')
    }
    return true
  }

  async _discoverIp (ipServer) {
    let { ip } = await http.get(ipServer)
    this.mainLogger.debug(`Discovered IP: ${ip}`)
    return ip
  }

  _checkWithinSyncLimit (time1, time2) {
    let timeDif = Math.abs(time1 - time2)
    if (timeDif > this.syncLimit) {
      return false
    }
    return true
  }

  // TODO: add way to compare time from major server head requests like google.com
  async _checkTimeSynced (timeServer) {
    const localTime = utils.getTime('s')
    let timestamp = await http.get(timeServer)
    return this._checkWithinSyncLimit(localTime, timestamp)
  }

  async _getSeedListSigned () {
    let seedListSigned = await http.get(this.seedList)
    this.mainLogger.debug(`Got signed seed list: ${JSON.stringify(seedListSigned)}`)
    return seedListSigned
  }

  async _getSeedNodes () {
    let seedListSigned = await this._getSeedListSigned()
    if (!this.crypto.verify(seedListSigned, this.netadmin)) throw Error('Fatal: Seed list was not signed by specified netadmin!')
    return seedListSigned.seedNodes
  }

  async _fetchSeedNodeInfo (seedNode) {
    const { nodeInfo } = await http.get(`${seedNode.ip}:${seedNode.port}/nodeinfo`)
    return nodeInfo
  }

  async _fetchSeedNodesInfo (seedNodes) {
    const promises = []
    for (let i = 0; i < seedNodes.length; i++) {
      const node = seedNodes[i]
      promises[i] = this._fetchSeedNodeInfo(node)
    }
    const seedNodesInfo = await Promise.all(promises)
    return seedNodesInfo
  }

  async _setNodeId (id, updateDb = true) {
    this.id = id
    this.mainLogger.info(`Your node's ID is ${this.id}`)
    if (!updateDb) return
    await this.storage.setProperty('id', id)
  }

  getIpInfo () {
    return this.ipInfo
  }

  getPublicNodeInfo () {
    const id = this.id
    const publicKey = this.crypto.getPublicKey()
    const ipInfo = this.getIpInfo()
    const status = { status: this.state.getNodeStatus(this.id) }
    const nodeInfo = Object.assign({ id, publicKey }, ipInfo, status)
    return nodeInfo
  }

  getCycleMarkerInfo () {
    const currentCycleMarker = this.state.getCurrentCycleMarker()
    const nextCycleMarker = this.state.getNextCycleMarker()
    const cycleCounter = this.state.getCycleCounter()
    const cycleStart = this.state.getCurrentCycleStart()
    const cycleDuration = this.state.getCurrentCycleDuration()
    const nodesJoined = this.state.getLastJoined()
    const currentTime = utils.getTime('s')
    const info = { currentCycleMarker, nextCycleMarker, cycleCounter, cycleStart, cycleDuration, nodesJoined, currentTime }
    this.mainLogger.debug(`Requested cycle marker info: ${JSON.stringify(info)}`)
    return info
  }

  getLatestCycles (amount) {
    const cycles = this.state.getLastCycles(amount)
    return cycles
  }

  getCycleChain (start, end) {
    this.mainLogger.debug(`Requested cycle chain from cycle ${start} to ${end}...`)
    let cycles
    try {
      cycles = this.state.getCycles(start, end)
    } catch (e) {
      this.mainLogger.debug(e)
      cycles = null
    }
    this.mainLogger.debug(`Result of requested cycleChain: ${cycles}`)
    return cycles
  }

  getCycleChainHash (start, end) {
    this.mainLogger.debug(`Requested hash of cycle chain from cycle ${start} to ${end}...`)
    let cycleChain
    try {
      cycleChain = this.getCycleChain(start, end)
    } catch (e) {
      return null
    }
    const hash = this.crypto.hash({ cycleChain })
    this.mainLogger.debug(`Hash of requested cycle chain: ${hash}`)
    return hash
  }

  _getThisNodeInfo () {
    const { externalIp, externalPort, internalIp, internalPort } = this.getIpInfo()
    const publicKey = this.crypto.getPublicKey()
    // TODO: Change this to actual selectable address
    const address = publicKey
    const joinRequestTimestamp = utils.getTime('s')
    const nodeInfo = { publicKey, externalIp, externalPort, internalIp, internalPort, address, joinRequestTimestamp }
    this.mainLogger.debug(`Node info of this node: ${JSON.stringify(nodeInfo)}`)
    return nodeInfo
  }

  async _ensureIpKnown () {
    let needsExternal = false
    let needsInternal = false

    if (!this._verifyExternalInfo(this.getIpInfo())) {
      needsExternal = true
    }
    if (!this._verifyInternalInfo(this.getIpInfo())) {
      needsInternal = true
    }
    if (!needsExternal && !needsInternal) return

    const discoveredIp = await this._discoverIp(this.ipServer)
    if (needsExternal) {
      this.ipInfo.externalIp = discoveredIp
    }
    if (needsInternal) {
      this.ipInfo.internalIp = discoveredIp
    }
  }

  async _checkIfNeedJoin (isFirstSeed) {
    const currExternIp = this.getIpInfo().externalIp
    const currExternPort = this.getIpInfo().externalPort
    const dbExternIp = await this.storage.getProperty('externalIp')
    const dbExternPort = await this.storage.getProperty('externalPort')

    // Check if our external network info matches what's in the database, otherwise we need to rejoin
    if (currExternIp !== dbExternIp || currExternPort !== dbExternPort) return true

    // TODO: Remove this and replace with robust way of seeing if no nodes
    // ----- are currently active before returning true
    if (isFirstSeed) return true

    const currentTime = utils.getTime('s')
    const lastHeartbeat = await this.storage.getProperty('heartbeat') || 0
    // If time since last heartbeat is greater than the max rejoin time, we have to rejoin
    if (currentTime - lastHeartbeat > this.maxRejoinTime) {
      return true
    }
    // TODO: Check if we are in nodeslist (requires ID)
    return false
  }

  _getNonSeedNodes (seedNodes = []) {
    // Get all nodes minus ourself
    const nodes = this.state.getAllNodes(this.id)
    // Make a copy of the nodeslist
    const nodesCopy = utils.deepCopy(nodes)
    if (!seedNodes.length) throw new Error('Fatal: No seed nodes provided!')
    for (const seedNode of seedNodes) {
      delete nodesCopy[seedNode]
    }
    return nodesCopy
  }

  getNodelistHash () {
    const nodelist = this.state.getAllNodes()
    const nodelistHash = this.crypto.hash({ nodelist })
    this.mainLogger.debug(`Hash of current nodelist: ${nodelistHash}`)
    return nodelistHash
  }

  async _submitJoin (nodes, joinRequest) {
    const node = nodes[0]
    this.mainLogger.debug(`Sending join request to ${node.ip}:${node.port}`)
    await http.post(`${node.ip}:${node.port}/join`, joinRequest)
  }

  async _fetchNodeId (seedNodes) {
    // TODO: implement a more robust way to choose a node
    const { nodesJoined, currentCycleMarker } = await this._fetchCycleMarker(seedNodes)
    this.mainLogger.debug(`Nodes joined in this cycle: ${JSON.stringify(nodesJoined)}`)
    const { publicKey } = this._getThisNodeInfo()
    for (const key of nodesJoined) {
      if (key === publicKey) return this.state.computeNodeId(publicKey, currentCycleMarker)
    }
    return null
  }

  async _waitUntilJoinPhase (currentTime, cycleStart, cycleDuration) {
    this.mainLogger.debug(`Current time is: ${currentTime}`)
    this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
    this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
    const nextJoinStart = cycleStart + cycleDuration
    this.mainLogger.debug(`Next join cycle starts at: ${nextJoinStart}`)
    const timeToWait = (nextJoinStart - currentTime + this.queryDelay) * 1000
    this.mainLogger.debug(`Waiting for ${timeToWait} ms before next join phase...`)
    await utils.sleep(timeToWait)
  }

  async _waitUntilEndOfCycle (currentTime, cycleStart, cycleDuration) {
    this.mainLogger.debug(`Current time is: ${currentTime}`)
    this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
    this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
    const endOfCycle = cycleStart + (2 * cycleDuration)
    this.mainLogger.debug(`End of cycle at: ${endOfCycle}`)
    let timeToWait
    if (currentTime < endOfCycle) {
      timeToWait = (endOfCycle - currentTime + this.queryDelay) * 1000
    } else {
      timeToWait = 0
    }
    this.mainLogger.debug(`Waiting for ${timeToWait} ms before next cycle marker creation...`)
    await utils.sleep(timeToWait)
  }

  _isIn2ndQuarter (currentTime, cycleStart, cycleDuration) {
    this.mainLogger.debug(`Current time is: ${currentTime}`)
    this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
    this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
    const startOf2ndQuarter = cycleStart + Math.ceil(0.25 * cycleDuration)
    this.mainLogger.debug(`Start of second quarter: ${startOf2ndQuarter}`)
    const endOf2ndQuarter = cycleStart + Math.ceil(0.5 * cycleDuration)
    this.mainLogger.debug(`End of second quarter: ${endOf2ndQuarter}`)
    if (currentTime < startOf2ndQuarter || currentTime > endOf2ndQuarter) {
      return false
    }
    return true
  }

  async _submitWhenNot2nd (nodes, route, message) {
    this.mainLogger.debug(`Submitting message: ${JSON.stringify(message)} on route: ${route} whenever it's not the second quarter of cycle...`)
    const { currentTime, cycleStart, cycleDuration } = await this._fetchCycleMarkerInternal(this.seedNodes)
    if (this._isIn2ndQuarter(currentTime, cycleStart, cycleDuration)) {
      await utils.sleep(0.25 * cycleDuration * 1000)
    }
    await this.tell(nodes, route, message)
  }

  async _attemptJoin (seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration) {
    // TODO: check if we missed join phase
    const currTime1 = utils.getTime('s') + timeOffset
    await this._waitUntilJoinPhase(currTime1, cycleStart, cycleDuration)
    await this._submitJoin(seedNodes, joinRequest)
    const currTime2 = utils.getTime('s') + timeOffset
    await this._waitUntilEndOfCycle(currTime2, cycleStart, cycleDuration)
    const nodeId = await this._fetchNodeId(seedNodes)
    return nodeId
  }

  async _join (seedNodes) {
    const localTime = utils.getTime('s')
    const { currentTime } = await this._fetchCycleMarker(seedNodes)
    if (!this._checkWithinSyncLimit(localTime, currentTime)) throw Error('Local time out of sync with network.')
    const timeOffset = currentTime - localTime
    this.mainLogger.debug(`Time offset with selected node: ${timeOffset}`)
    let nodeId = null
    while (!nodeId) {
      const { currentCycleMarker, nextCycleMarker, cycleStart, cycleDuration } = await this._fetchCycleMarker(seedNodes)
      if (nextCycleMarker) {
        // Use next cycle marker
        const joinRequest = await this._createJoinRequest(nextCycleMarker)
        nodeId = await this._attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
        if (!nodeId) {
          const { cycleStart, cycleDuration } = await this._fetchCycleMarker(seedNodes)
          nodeId = await this._attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
        }
      } else {
        const joinRequest = await this._createJoinRequest(currentCycleMarker)
        nodeId = await this._attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
      }
    }
    return nodeId
  }

  // TODO: Think about exception when there is more than
  // ----- one seed node in seed list, but you are still a seednode
  _checkIfFirstSeedNode (seedNodes) {
    if (!seedNodes.length) throw new Error('Fatal: No seed nodes in seed list!')
    if (seedNodes.length > 1) return false
    const seed = seedNodes[0]
    const { externalIp, externalPort } = this.getIpInfo()
    if (externalIp === seed.ip && externalPort === seed.port) {
      return true
    }
    return false
  }

  async _createJoinRequest (cycleMarker) {
    // Build and return a join request
    let nodeInfo = this._getThisNodeInfo()
    let selectionNum = this.crypto.hash({ cycleMarker, address: nodeInfo.address })
    // TO-DO: Think about if the selection number still needs to be signed
    // let signedSelectionNum = this.crypto.sign({ selectionNum })
    let proofOfWork = {
      compute: await this.crypto.getComputeProofOfWork(cycleMarker, this.difficulty)
    }
    // TODO: add a version number at some point
    // version: '0.0.0'
    const joinReq = { nodeInfo, cycleMarker, proofOfWork, selectionNum }
    const signedJoinReq = this.crypto.sign(joinReq)
    this.mainLogger.debug(`Join request created... Join request: ${JSON.stringify(signedJoinReq)}`)
    return signedJoinReq
  }

  _isActive () {
    const active = this.state.getNodeStatus(this.id) === 'active'
    if (!active) {
      this.mainLogger.debug('This node is not currently active...')
      return false
    }
    this.mainLogger.debug('This node is active!')
    return true
  }

  async _robustQuery (nodes, queryFn, equalityFn, redundancy) {
    if (typeof equalityFn !== 'function') {
      equalityFn = util.isDeepStrictEqual
    }
    if (!redundancy || redundancy < 1) redundancy = 3
    redundancy = nodes.length < redundancy ? nodes.length : redundancy

    class Tally {
      constructor (winCount, equalFn) {
        this.winCount = winCount
        this.equalFn = equalFn
        this.items = []
      }
      add (newItem) {
        for (let item of this.items) {
          if (this.equalFn(newItem, item.value)) item.count++
          if (item.count >= this.winCount) return item.value
        }
        this.items.push({ value: newItem, count: 1 })
        if (this.winCount === 1) return newItem
      }
    }
    let responses = new Tally(redundancy, equalityFn)
    let errors = 0

    nodes = [...nodes]
    shuffleArray(nodes)

    for (let node of nodes) {
      try {
        let query = await queryFn(node)
        this.mainLogger.debug(`Result of query: ${JSON.stringify(query)}`)
        let result = responses.add(query)
        if (result) return result
      } catch (e) {
        this.mainLogger.debug(e)
        errors++
      }
    }

    throw new Error(`Could not get ${redundancy} redundant responses from ${nodes.length} nodes. Encountered ${errors} query errors.`)
  }

  async _sequentialQuery (nodes, queryFn, verifyFn) {
    if (typeof verifyFn !== 'function') {
      verifyFn = (result) => true
    }

    let errors = 0
    let invalid = 0

    nodes = [...nodes]
    shuffleArray(nodes)

    for (let node of nodes) {
      try {
        let result = await queryFn(node)
        if (!result) throw new Error('Unable to get result from query.')
        this.mainLogger.debug(`Sequential query result: ${JSON.stringify(result)}`)
        let verified = verifyFn(result)
        if (!verified) {
          this.mainLogger.debug(`Query result failed verification.`)
          invalid += 1
          continue
        }
        return result
      } catch (e) {
        errors += 1
      }
    }

    throw new Error(`Could not get a responses from ${nodes.length} nodes. Encountered ${errors} errors and there were ${invalid} invalid queries.`)
  }

  _verifyNodelist (nodelist, nodelistHash) {
    this.mainLogger.debug(`Given nodelist: ${JSON.stringify(nodelist)}`)
    const ourHash = this.crypto.hash(nodelist)
    this.mainLogger.debug(`Our nodelist hash: ${ourHash}`)
    this.mainLogger.debug(`Given nodelist hash: ${nodelistHash}`)
    return ourHash === nodelistHash
  }

  _verifyCycleChain (cycleChain, cycleChainHash) {
    this.mainLogger.debug(`Given cycle chain: ${JSON.stringify(cycleChain)}`)
    const ourHash = this.crypto.hash(cycleChain)
    this.mainLogger.debug(`Our cycle chain hash: ${ourHash}`)
    this.mainLogger.debug(`Given cycle chain hash: ${cycleChainHash}`)
    return ourHash === cycleChainHash
  }

  async _fetchNodelistHash (nodes) {
    let queryFn = async (node) => {
      const { nodelistHash } = await this.ask(node, 'nodelisthash')
      return { nodelistHash }
    }
    const { nodelistHash } = await this._robustQuery(nodes, queryFn)
    return nodelistHash
  }

  async _fetchVerifiedNodelist (nodes, nodelistHash) {
    let queryFn = async (node) => {
      const { nodelist } = await this.ask(node, 'nodelist')
      return { nodelist }
    }
    let verifyFn = (nodelist) => this._verifyNodelist(nodelist, nodelistHash)
    const { nodelist } = await this._sequentialQuery(nodes, queryFn, verifyFn)
    return nodelist
  }

  async _fetchCycleMarker (nodes) {
    const cycleMarkerInfo = await this._robustQuery(nodes, (node) => http.get(`${node.ip}:${node.port}/cyclemarker`))
    return cycleMarkerInfo
  }

  async _fetchCycleMarkerInternal (nodes) {
    let queryFn = async (node) => {
      const cycleMarkerInfo = await this.ask(node, 'cyclemarker')
      return cycleMarkerInfo
    }
    const cycleMarkerInfo = await this._robustQuery(nodes, queryFn)
    return cycleMarkerInfo
  }

  async _fetchCycleChainHash (nodes, start, end) {
    let queryFn = async (node) => {
      const { cycleChainHash } = await this.ask(node, 'cyclechainhash', { start, end })
      return { cycleChainHash }
    }
    const { cycleChainHash } = await this._robustQuery(nodes, queryFn)
    this.mainLogger.debug(`Result of robust query to fetch cycle chain hash: ${cycleChainHash}`)
    return cycleChainHash
  }

  async _fetchVerifiedCycleChain (nodes, cycleChainHash, start, end) {
    let queryFn = async (node) => {
      const { cycleChain } = await this.ask(node, 'cyclechain', { start, end })
      return { cycleChain }
    }
    let verifyFn = (cycleChain) => this._verifyCycleChain(cycleChain, cycleChainHash)
    const { cycleChain } = await this._sequentialQuery(nodes, queryFn, verifyFn)
    return cycleChain
  }

  async _fetchLatestCycleChain (seedNodes, nodes) {
    // Remove seedNodes from nodes
    nodes = nodes.filter(n => !(seedNodes.map(s => s.id).includes(n.id)))

    // Get current cycle counter
    let cycleCounter
    try {
      ;({ cycleCounter } = await this._fetchCycleMarkerInternal(nodes))
    } catch (e) {
      this.mainLogger.info('Could not get cycleMarker from nodes. Querying seedNodes for it...')
      this.mainLogger.debug(e)
      ;({ cycleCounter } = await this._fetchCycleMarkerInternal(seedNodes))
    }
    this.mainLogger.debug(`Fetched cycle counter: ${cycleCounter}`)

    // Determine cycle counter numbers to get, at most, the last 1000 cycles
    let chainEnd = cycleCounter
    let desiredCycles = 1000
    let chainStart = chainEnd - (cycleCounter < desiredCycles ? cycleCounter : cycleCounter - (desiredCycles - 1))

    // Get cycle chain hash
    let cycleChainHash
    try {
      cycleChainHash = await this._fetchCycleChainHash(nodes, chainStart, chainEnd)
    } catch (e) {
      this.mainLogger.info('Could not get cycleChainHash from nodes. Querying seedNodes for it...')
      this.mainLogger.debug(e)
      cycleChainHash = await this._fetchCycleChainHash(seedNodes, chainStart, chainEnd)
    }

    this.mainLogger.debug(`Fetched cycle chain hash: ${cycleChainHash}`)

    // Get verified cycle chain
    let cycleChain
    try {
      cycleChain = await this._fetchVerifiedCycleChain(nodes, cycleChainHash, chainStart, chainEnd)
    } catch (e) {
      this.mainLogger.info('Could not get verified cycleChain from nodes. Querying seedNodes for it...')
      this.mainLogger.debug(e)
      cycleChain = await this._fetchVerifiedCycleChain(seedNodes, cycleChainHash, chainStart, chainEnd)
    }

    return cycleChain
  }

  _validateJoinRequest (joinRequest) {
    // TODO: implement actual validation (call to application side?)
    return true
  }

  async addJoinRequest (joinRequest, fromExternal = true) {
    const valid = this._validateJoinRequest(joinRequest)
    if (!valid) return false
    let added
    if (!fromExternal) added = this.state.addGossipedJoinRequest(joinRequest)
    else added = this.state.addNewJoinRequest(joinRequest)
    if (!added) return false
    const active = this._isActive()
    if (!active) return true
    const allNodes = this.state.getAllNodes(this.id)
    this.mainLogger.debug(`Gossiping join request to these nodes: ${JSON.stringify(allNodes)}`)
    await this.tell(allNodes, 'join', joinRequest)
    return true
  }

  async _discoverNetwork (seedNodes) {
    // Check if our time is synced to network time server
    let timeSynced = await this._checkTimeSynced(this.timeServer)
    if (!timeSynced) throw new Error('Local time out of sync with time server.')

    // Check if we are first seed node
    const isFirstSeed = this._checkIfFirstSeedNode(seedNodes)
    if (!isFirstSeed) {
      this.mainLogger.info('You are not the first seed node...')
      return false
    }
    this.mainLogger.info('You are the first seed node!')
    return true
  }

  async _joinNetwork (seedNodes, isFirstSeed) {
    this.mainLogger.debug('Clearing P2P state...')
    await this.state.clear()

    // Sets our IPs and ports for internal and external network in the database
    await this.storage.setProperty('externalIp', this.getIpInfo().externalIp)
    await this.storage.setProperty('externalPort', this.getIpInfo().externalPort)
    await this.storage.setProperty('internalIp', this.getIpInfo().internalIp)
    await this.storage.setProperty('internalPort', this.getIpInfo().internalPort)

    if (isFirstSeed) {
      this.mainLogger.debug('Joining network...')

      // This is for testing purposes
      console.log('Doing initial setup for server...')

      const joinRequest = await this._createJoinRequest()
      this.state.startCycles()
      this.state.addNewJoinRequest(joinRequest)

      // Sleep for cycle duration before updating status
      // TODO: Make this more deterministic
      await utils.sleep(this.state.getCurrentCycleDuration() * 1000)
      const { currentCycleMarker } = this.getCycleMarkerInfo()
      const nodeId = this.state.computeNodeId(joinRequest.nodeInfo.publicKey, currentCycleMarker)
      this._setNodeId(nodeId)

      return true
    }

    const nodeId = await this._join(seedNodes)
    if (!nodeId) {
      this.mainLogger.info('Unable to join network. Shutting down...')
      return false
    }
    this.mainLogger.info('Successfully joined the network!')
    this._setNodeId(nodeId)
    // const testResponse = await this.ask({ internalIp: '127.0.0.1', internalPort: 9005 }, 'test2')
    // console.log(JSON.stringify(testResponse))
    return true
  }

  async _syncToNetwork (seedNodes, isFirstSeed) {
    // TODO: need to make it robust when resync implemented,
    // ---   currently system would never resync if we were only
    // ---   seed node in the network

    // If you are first node, there is nothing to sync to
    if (isFirstSeed) {
      this.mainLogger.info('No syncing required...')
      return true
    }

    // If not first seed, we need to sync to network
    this.mainLogger.info('Syncing to network...')

    // Get full node info for seed nodes
    this.mainLogger.debug('Fetching seed node info...')
    this.seedNodes = await this._fetchSeedNodesInfo(seedNodes)

    // Get hash of nodelist
    this.mainLogger.debug('Fetching nodelist hash...')
    const nodelistHash = await this._fetchNodelistHash(this.seedNodes)
    this.mainLogger.debug(`Nodelist hash is: ${nodelistHash}.`)

    // Get and verify nodelist aganist hash
    this.mainLogger.debug('Fetching verified nodelist...')
    const nodelist = await this._fetchVerifiedNodelist(this.seedNodes, nodelistHash)
    this.mainLogger.debug(`Nodelist is: ${JSON.stringify(nodelist)}.`)

    // Add retrieved nodelist to the state
    await this.state.addNodes(nodelist)

    // TODO: When active nodes are synced, change nodes to allActiveNodes
    // const nodes = this.state.getActiveNodes(this.id)
    this.mainLogger.debug('Fetching latest cycle chain...')
    const nodes = this.seedNodes
    const cycleChain = await this._fetchLatestCycleChain(this.seedNodes, nodes)
    this.mainLogger.debug(`Retrieved cycle chain: ${JSON.stringify(cycleChain)}`)
    try {
      await this.state.addCycles(cycleChain)
    } catch (e) {
      this.mainLogger.error(e)
      this.mainLogger.info('Unable to add cycles. Sync failed...')
      return false
    }
    this.mainLogger.info('Successfully synced to the network!')
    return true
  }

  async _submitActiveRequest () {
    const allNodes = this.state.getAllNodes(this.id)
    await this._submitWhenNot2nd(allNodes, 'active', { nodeId: this.id })
  }

  async _goActive (isFirstSeed) {
    if (isFirstSeed) {
      this.state.addStatusUpdate(this.id, 'active')
      return true
    }
    await this._submitActiveRequest()
    // TO-DO: After gossip is implemented, node will wait for messages
    // -----  to be gossiped to it before marking itself active
    await this.state.directStatusUpdate(this.id, 'active', true)
    return true
  }

  // Finds a node either in nodelist or in seedNodes listhis.mainLogger.debug(`Node ID to look up: ${nodeId}`)t if told to
  _findNodeInGroup (nodeId, group) {
    if (!group) {
      const errMsg = 'No group given for _findNodeInGroup()'
      this.mainLogger.debug(errMsg)
      throw new Error(errMsg)
    }
    this.mainLogger.debug(`Node ID to find in group: ${nodeId}`)
    for (const node of group) {
      if (node.id === nodeId) return node
    }
    return false
  }

  // Verifies that the received internal message was signed by the stated node
  _verifySignedByNode (message, node) {
    let result
    try {
      if (!node.publicKey) {
        this.mainLogger.debug('Node object did not contain public key for verifySignedByNode()!')
        return false
      }
      this.mainLogger.debug(`Expected publicKey: ${node.publicKey}, actual publicKey: ${message.sign.owner}`)
      result = this.crypto.verify(message, node.publicKey)
    } catch (e) {
      this.mainLogger.debug(`Invalid or missing signature on message: ${JSON.stringify(message)}`)
      return false
    }
    return result
  }

  _extractPayload (wrappedPayload, nodeGroup) {
    // Check to see if node is in expected node group
    const node = this._findNodeInGroup(wrappedPayload.sender, nodeGroup)
    if (!node) {
      this.mainLogger.debug(`Invalid sender on internal payload: ${JSON.stringify(wrappedPayload)}`)
      return null
    }
    const signedByNode = this._verifySignedByNode(wrappedPayload, node)
    // Check if actually signed by that node
    if (!signedByNode) {
      this.mainLogger.debug('Internal payload not signed by an expected node.')
      return null
    }
    const payload = wrappedPayload.payload
    this.mainLogger.debug('Internal payload successfully verified.')
    return payload
  }

  _wrapAndSignMessage (msg) {
    if (!msg) throw new Error('No message given to wrap and sign!')
    const wrapped = {
      payload: msg,
      sender: this.id
    }
    const signed = this.crypto.sign(wrapped)
    return signed
  }

  // Our own P2P version of the network tell, with a sign added
  async tell (nodes, route, message) {
    const signedMessage = this._wrapAndSignMessage(message)
    await this.network.tell(nodes, route, signedMessage)
  }

  // Our own P2P version of the network ask, with a sign added, and sign verified on other side
  async ask (node, route, message = {}) {
    const signedMessage = this._wrapAndSignMessage(message)
    const signedResponse = await this.network.ask(node, route, signedMessage)
    this.mainLogger.debug(`Result of network-level ask: ${JSON.stringify(signedResponse)}`)
    const response = this._extractPayload(signedResponse, [node])
    if (!response) throw new Error(`Unable to verify response to ask request: ${route} -- ${JSON.stringify(message)} from node: ${node.id}`)
    return response
  }

  registerInternal (route, handler) {
    // Create function that wraps handler function
    const wrappedHandler = async (wrappedPayload, respond) => {
      // Create wrapped respond function for sending back signed data
      const respondWrapped = async (response) => {
        const signedResponse = this._wrapAndSignMessage(response)
        this.mainLogger.debug(`The signed wrapped response to send back: ${signedResponse}`)
        await respond(signedResponse)
      }
      // Checks to see if we can extract the actual payload from the wrapped message
      const payload = this._extractPayload(wrappedPayload, this.state.getAllNodes(this.id))
      if (!payload) {
        await respondWrapped({ success: false, error: 'invalid or missing signature' })
        return
      }
      await handler(payload, respondWrapped)
    }
    // Include that in the handler function that is passed
    this.network.registerInternal(route, wrappedHandler)
  }

  /**
   * Send Gossip to all nodes
   */
  async sendGossip (type, payload) {
    this.mainLogger.debug(`Start of sendGossip(${JSON.stringify(payload)})`)
    const gossipPayload = { type: type, data: payload }
    try {
      const recipients = getRandom(this.state.getAllNodes(this.id), this.gossipRecipients)
      this.mainLogger.debug(`Gossiping join request to these nodes: ${JSON.stringify(recipients)}`)
      await this.network.tell(recipients, 'gossip', gossipPayload)
    } catch (ex) {
      this.mainLogger.error(`Failed to sendGossip(${JSON.stringify(payload)}) Exception => ex`)
    }
    this.mainLogger.debug(`End of sendGossip(${JSON.stringify(payload)})`)
  }

  /**
 * Handle Goosip Transactions
 * Payload: {type: ['receipt', 'trustedTransaction'], data: {}}
 */
  async handleGossip (payload) {
    this.mainLogger.debug(`Start of handleGossip(${JSON.stringify(payload)})`)
    const type = payload.type
    const data = payload.data

    const gossipHandler = this.gossipHandlers[type]
    if (!gossipHandler) {
      this.mainLogger.debug('Gossip Handler not found')
    }
    await gossipHandler(data)
    this.mainLogger.debug(`End of handleGossip(${JSON.stringify(payload)})`)
  }

  /**
 * @param {type} example:- 'receipt', 'transaction'
 * @param {handler} example:- function
 */
  registerGossipHandler (type, handler) {
    this.gossipHandlers[type] = handler
  }

  async startup () {
    const seedNodes = await this._getSeedNodes()
    const isFirstSeed = await this._discoverNetwork(seedNodes)
    const needJoin = await this._checkIfNeedJoin(isFirstSeed)
    let joined = true
    if (needJoin) joined = await this._joinNetwork(seedNodes, isFirstSeed)
    if (!joined) return false
    await this._syncToNetwork(seedNodes, isFirstSeed)

    await this._goActive(isFirstSeed)
    this.mainLogger.info('Node is now active!')

    // if (!isFirstSeed) this.state.startCycles()

    // This is also for testing purposes
    console.log('Server ready!')
    return true
  }
}

// From: https://stackoverflow.com/a/12646864
function shuffleArray (array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]]
  }
}

// From: https://stackoverflow.com/a/19270021
function getRandom (arr, n) {
  const result = new Array(n)
  let len = arr.length
  const taken = new Array(len)
  if (n > len) {
    throw new RangeError('getRandom: more elements taken than available')
  }
  while (n--) {
    var x = Math.floor(Math.random() * len)
    result[n] = arr[x in taken ? taken[x] : x]
    taken[x] = --len in taken ? taken[len] : len
  }
  return result
}

module.exports = P2P
