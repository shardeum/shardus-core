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
    this.state = new P2PState(config, this.logger, this.storage, this.crypto)
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

  async _setNodeId (id, updateDb = true) {
    this.id = id
    this.mainLogger.info(`Your node's ID is ${this.id}`)
    if (!updateDb) return
    await this.storage.setProperty('id', id)
  }

  getIpInfo () {
    return this.ipInfo
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
    const cycles = this.state.getCycles(amount)
    return cycles
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

  async _checkRejoin () {
    const currExternIp = this.getIpInfo().externalIp
    const currExternPort = this.getIpInfo().externalPort
    const dbExternIp = await this.storage.getProperty('externalIp')
    const dbExternPort = await this.storage.getProperty('externalPort')

    // Check if our external network info matches what's in the database, otherwise we need to rejoin
    if (currExternIp !== dbExternIp || currExternPort !== dbExternPort) return true

    const currentTime = utils.getTime('s')
    const lastHeartbeat = await this.storage.getProperty('heartbeat') || 0
    // If time since last heartbeat is greater than the max rejoin time, we have to rejoin
    if (currentTime - lastHeartbeat > this.maxRejoinTime) {
      return true
    }
    // TODO: Check if we are in nodeslist (requires ID)
    return false
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

  async _join () {
    const seedNodes = await this._getSeedNodes()
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
        let result = responses.add(await queryFn(node))
        if (result) return result
      } catch (e) {
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

    nodes = [...nodes]
    shuffleArray(nodes)

    for (let node of nodes) {
      try {
        let result = await queryFn(node)
        if (result && verifyFn(result)) return result
      } catch (e) {
        errors++
      }
    }

    throw new Error(`Could not get a response from ${nodes.length} nodes. Encountered ${errors} query errors.`)
  }

  _verifyCycleChain (cycleChain, chainHash) {
    return this.cypto.hash({ cycleChain }) !== chainHash
  }

  _fetchCycleMarker (nodes, redundancy) {
    return this._robustQuery(nodes, (node) => http.get(`${node.ip}:${node.port}/cyclemarker`), redundancy)
  }

  _fetchCycleChainHash (nodes, start, end, redundancy) {
    let queryFn = (node) => {
      // TODO: [AS] Use the internal network to return a chain hash
      return { chainHash: '' }
    }
    return this._robustQuery(nodes, queryFn, redundancy)
  }

  _fetchVerifiedCycleChain (nodes, chainHash, start, end) {
    let queryFn = node => {
      // TODO: [AS] Use the internal network to return a cycle chain
      return { cycleChain: [] }
    }
    let verifyFn = ({ cycleChain }) => this._verifyCycleChain(cycleChain, chainHash)
    return this._sequentialQuery(nodes, queryFn, verifyFn)
  }

  async _fetchLatestCycleChain (seedNodes, nodes, redundancy) {
    // Remove seedNodes from nodes
    nodes = nodes.filter(n => !(seedNodes.map(s => s.id).includes(n.id)))

    // Get current cycle counter
    let cycleCounter
    try {
      ({ cycleCounter } = await this._fetchCycleMarker(nodes, redundancy))
    } catch (e) {
      this.mainLogger.info('Could not get cycleMarker from nodes. Querying seedNodes for it...')
      this.mainLogger.debug(e)
      ({ cycleCounter } = await this._fetchCycleMarker(seedNodes, redundancy))
    }

    // Determine cycle counter numbers to get, at most, the last 1000 cycles
    let chainEnd = cycleCounter
    let chainStart = chainEnd - (cycleCounter < 1000 ? cycleCounter : 1000)

    // Get cycle chain hash
    let chainHash
    try {
      ({ chainHash } = await this._fetchCycleChainHash(nodes, chainStart, chainEnd, redundancy))
    } catch (e) {
      this.mainLogger.info('Could not get chainHash from nodes. Querying seedNodes for it...')
      this.mainLogger.debug(e)
      ({ chainHash } = await this._fetchCycleChainHash(seedNodes, chainStart, chainEnd, redundancy))
    }

    // Get verified cycle chain
    let cycleChain
    try {
      ({ cycleChain } = await this._fetchVerifiedCycleChain(nodes, chainHash, chainStart, chainEnd))
    } catch (e) {
      this.mainLogger.info('Could not get verified cycleChain from nodes. Querying seedNodes for it...')
      this.mainLogger.debug(e)
      ({ cycleChain } = await this._fetchVerifiedCycleChain(seedNodes, chainHash, chainStart, chainEnd))
    }

    return { cycleChain }
  }

  _validateJoinRequest (joinRequest) {
    // TODO: implement actual validation
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
    await this.network.tell(allNodes, 'join', joinRequest)
    return true
  }

  async discoverNetwork () {
    // Check if our time is synced to network time server
    let timeSynced = await this._checkTimeSynced(this.timeServer)
    if (!timeSynced) throw new Error('Local time out of sync with time server.')

    // Check if we are first seed node
    const seedNodes = await this._getSeedNodes()
    const isFirstSeed = this._checkIfFirstSeedNode(seedNodes)
    if (isFirstSeed) {
      this.mainLogger.info('You are the first seed node!')
    } else {
      this.mainLogger.info('You are not the first seed node...')
    }

    // Check if we need to rejoin
    const rejoin = await this._checkRejoin()
    if (rejoin) {
      this.mainLogger.info('Server needs to rejoin...')
      this.mainLogger.debug('Clearing P2P state...')
      await this.state.clear()
      await this.storage.setProperty('externalIp', this.getIpInfo().externalIp)
      await this.storage.setProperty('externalPort', this.getIpInfo().externalPort)
      await this.storage.setProperty('internalIp', this.getIpInfo().internalIp)
      await this.storage.setProperty('internalPort', this.getIpInfo().internalPort)
      if (isFirstSeed) {
        this.mainLogger.debug('Rejoining network...')

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
        await this.state.setNodeStatus(this.id, 'active')

        // This is also for testing purposes
        console.log('Server ready!')

        return true
      }
      const nodeId = await this._join()
      if (!nodeId) {
        this.mainLogger.info('Unable to join network. Shutting down...')
        return false
      }
      this.mainLogger.info('Successfully joined the network!')
      this._setNodeId(nodeId)
      // const testResponse = await this.network.ask({ internalIp: '127.0.0.1', internalPort: 9005 }, 'test2')
      // console.log(JSON.stringify(testResponse))
      return true
    }
    // If we made it this far, we need to sync to the network

    // TODO: need to make it robust when resync implemented,
    // ---   currently system would never resync if we were only
    // ---   seed node in the network

    // If you are first node, there is nothing to sync to
    if (isFirstSeed) {
      this.mainLogger.info('No rejoin required, starting new cycle...')
      this.state.startCycles()
      return true
    }

    // If not first seed, we need to sync to network
    this.mainLogger.info('Syncing to network...')
    // TODO: add resyncing
    this.mainLogger.debug('Unable to resync... TODO: implement resyncing.')
    return false
  }
}

// From: https://stackoverflow.com/a/12646864
function shuffleArray (array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]]
  }
}

module.exports = P2P
